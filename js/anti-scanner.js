/**
 * Anti-Scanner Middleware
 * ─────────────────────────────────────────────────────────────────────────────
 * Protege contra scanners automáticos (Nikto, sqlmap, Nessus, ZAP, dirbuster…)
 * mediante:
 *   1. Detección por patrones en URL/headers/UA conocidos de scanners.
 *   2. Honeypot paths que solo los bots tocan.
 *   3. Delay exponencial adaptativo (tarpit) para frenar fuzzing.
 *   4. Lista temporal de IPs sospechosas (in-memory, TTL configurable).
 *   5. Respuesta 444 (close connection sin respuesta) — igual que Cloudflare.
 *
 * Patrones aplicados:
 *   - Strategy: cada detector independiente.
 *   - Token bucket implícito vía conteo + TTL.
 *   - Fail-closed: ante duda → bloquear/demorar.
 */

'use strict';

// ─── Patrones sospechosos en la URL ─────────────────────────────────────────
const SUSPICIOUS_PATH_REGEX = new RegExp([
    // Scanners conocidos
    '\\.(env|git|svn|htaccess|htpasswd|DS_Store|bak|old|swp|sql|sqlite|db)$',
    '/(wp-admin|wp-login|wp-content|wp-includes|xmlrpc\\.php)',
    '/(phpmyadmin|phpMyAdmin|pma|adminer|admin\\.php)',
    '/(\\.git|\\.svn|\\.hg|\\.bzr)/',
    '/(vendor|node_modules)/.*\\.(json|lock|yml)',
    // SQL injection / path traversal
    '\\.\\./',
    '\\b(union|select|insert|drop|exec|script)\\b.*=',
    // Web shells comunes
    '/(c99|r57|shell|cmd|backdoor|webshell)\\.(php|asp|aspx|jsp)',
    // Config files
    '/(config|configuration|settings|secret|credentials)\\.(php|yml|json|xml|ini)',
    '/\\.(aws|ssh|docker|kube)/',
    // Probe endpoints típicos
    '/(actuator|jolokia|console|swagger-ui|api-docs|graphiql)',
    // Java/Spring vulnerable paths
    '/(struts|jboss|tomcat|weblogic)',
    // Eval / RCE intentos
    '\\$\\{jndi:', // log4shell
    '<\\?php',
    '<script.*>',
    'eval\\(',
    'base64_decode'
].join('|'), 'i');

// User-Agents de herramientas de pentesting
const SCANNER_UA_REGEX = /(nikto|sqlmap|acunetix|nessus|nmap|masscan|zgrab|dirbuster|gobuster|wfuzz|burpsuite|burp\s|owasp\s?zap|metasploit|wpscan|nuclei|httpx|katana|hakrawler|fimap|joomscan|sqlninja|brutus|hydra|john\s?the\s?ripper)/i;

// Paths honeypot (legítimos no los tocan)
const HONEYPOT_PATHS = new Set([
    '/.env', '/.git/config', '/wp-login.php', '/admin.php',
    '/phpmyadmin/', '/.aws/credentials', '/.ssh/id_rsa'
]);

// ─── Almacén de sospechosos (LRU + TTL) ─────────────────────────────────────
class SuspiciousStore {
    constructor({ maxSize = 50_000, ttlMs = 30 * 60 * 1000 } = {}) {
        this.store = new Map(); // ip → { hits, firstSeen, lastSeen }
        this.maxSize = maxSize;
        this.ttlMs = ttlMs;

        // Limpieza periódica
        this.cleanupInterval = setInterval(() => this.cleanup(), 5 * 60 * 1000);
        this.cleanupInterval.unref?.();
    }

    register(ip) {
        const now = Date.now();
        const entry = this.store.get(ip) || { hits: 0, firstSeen: now, lastSeen: now };
        entry.hits += 1;
        entry.lastSeen = now;
        this.store.delete(ip); // refresh order (LRU)
        this.store.set(ip, entry);

        if (this.store.size > this.maxSize) {
            const oldest = this.store.keys().next().value;
            this.store.delete(oldest);
        }
        return entry;
    }

    get(ip) {
        const entry = this.store.get(ip);
        if (!entry) return null;
        if (Date.now() - entry.lastSeen > this.ttlMs) {
            this.store.delete(ip);
            return null;
        }
        return entry;
    }

    cleanup() {
        const now = Date.now();
        for (const [ip, entry] of this.store) {
            if (now - entry.lastSeen > this.ttlMs) this.store.delete(ip);
        }
    }
}

// ─── Helpers ────────────────────────────────────────────────────────────────
function getClientIp(req) {
    return (req.headers['x-forwarded-for']?.split(',')[0].trim()) ||
           req.ip || req.connection?.remoteAddress || 'unknown';
}

function calcDelay(hits) {
    // Crece exponencial, tope 8s para no agotar event loop
    return Math.min(8000, 200 * Math.pow(1.6, Math.min(hits, 12)));
}

/**
 * Cierra la conexión sin enviar respuesta (igual que Nginx 444).
 * Estrategia "tarpit": consume recursos del scanner, no de Google.
 */
function dropConnection(res) {
    try {
        res.socket?.destroy();
    } catch { /* noop */ }
}

// ─── Middleware factory ─────────────────────────────────────────────────────
function createAntiScanner(options = {}) {
    const {
        store = new SuspiciousStore(),
        logEnabled = true,
        maxHitsBeforeDrop = 5,
        delayHumanFriendly = true   // Si el path NO es sospechoso, no delay
    } = options;

    return function antiScannerMiddleware(req, res, next) {
        const path = req.path || '';
        if (path.startsWith('/api/telegram/') || path.startsWith('/socket.io')) {
            return next();
        }

        const ip = getClientIp(req);
        const ua = (req.headers['user-agent'] || '').toLowerCase();
        const url = req.originalUrl || req.url || '';

        let suspicionScore = 0;
        const reasons = [];

        if (SCANNER_UA_REGEX.test(ua)) {
            suspicionScore += 3; reasons.push('scanner-ua');
        }
        if (SUSPICIOUS_PATH_REGEX.test(url)) {
            suspicionScore += 2; reasons.push('suspicious-path');
        }
        if (HONEYPOT_PATHS.has(req.path)) {
            suspicionScore += 5; reasons.push('honeypot');
        }
        // Header Referer raro o ausente en POST a paths sensibles
        if (req.method !== 'GET' && !req.headers.referer && !req.headers.origin) {
            suspicionScore += 1; reasons.push('no-referer-on-mutation');
        }

        const previous = store.get(ip);
        const totalHits = (previous?.hits || 0) + (suspicionScore > 0 ? 1 : 0);

        if (suspicionScore === 0) {
            // Tráfico limpio: pasa sin coste
            return next();
        }

        // Registrar sospecha
        store.register(ip);

        if (logEnabled) {
            console.warn(JSON.stringify({
                type: 'anti-scanner',
                ip,
                ua: ua.slice(0, 120),
                url: url.slice(0, 200),
                score: suspicionScore,
                hits: totalHits,
                reasons
            }));
        }

        // Si supera umbral → cerrar conexión sin respuesta (no da feedback al scanner)
        if (totalHits >= maxHitsBeforeDrop) {
            return dropConnection(res);
        }

        // Tarpit: delay exponencial
        const delay = calcDelay(totalHits);
        setTimeout(() => {
            // Respuesta neutra 404 (no revela existencia ni stack)
            if (!res.headersSent) {
                res.status(404).type('text/plain').send('Not Found');
            }
        }, delay).unref();
    };
}

module.exports = {
    createAntiScanner,
    SuspiciousStore,
    SUSPICIOUS_PATH_REGEX,
    SCANNER_UA_REGEX,
    HONEYPOT_PATHS
};
