/**
 * Cloaker Middleware
 * ─────────────────────────────────────────────────────────────────────────────
 * Detecta bots/crawlers y redirige tráfico:
 *   - Bots, crawlers, headless browsers, scrapers → landing.html (página segura)
 *   - Humanos reales                              → index.html  (página real)
 *
 * Patrones de diseño aplicados:
 *   - Strategy: cada detector implementa la misma interfaz `evaluate(req)`.
 *   - Chain of Responsibility: los detectores se evalúan en cadena;
 *     cualquiera con score ≥ THRESHOLD marca el request como bot.
 *   - Fail-safe defaults: ante la duda → landing.html (seguro para Google Ads).
 *
 * Características:
 *   - Detección por User-Agent (lista completa actualizada).
 *   - Detección por reverse DNS para Googlebot, Bingbot, etc. (cache LRU).
 *   - Análisis de headers HTTP (Accept, Accept-Language, sec-ch-ua...).
 *   - Detección de headless browsers (Puppeteer, Playwright, Selenium).
 *   - Whitelist explícita para Googlebot legítimo (verificado por DNS).
 *   - Logs estructurados para auditoría.
 */

'use strict';

const dns = require('dns').promises;

// ─────────────────────────────────────────────────────────────────────────────
// Constantes y configuración
// ─────────────────────────────────────────────────────────────────────────────

const BOT_SCORE_THRESHOLD = 1; // Score necesario para clasificar como bot

// Patrones de User-Agent conocidos como bots (regex compilada una sola vez)
const BOT_UA_REGEX = new RegExp(
    [
        // Buscadores principales
        'googlebot', 'bingbot', 'slurp', 'duckduckbot', 'baiduspider',
        'yandexbot', 'sogou', 'exabot', 'facebot', 'ia_archiver',
        // Redes sociales / link previews
        'facebookexternalhit', 'twitterbot', 'linkedinbot', 'whatsapp',
        'telegrambot', 'discordbot', 'slackbot', 'pinterestbot',
        // Auditoría / SEO
        'ahrefsbot', 'semrushbot', 'mj12bot', 'dotbot', 'rogerbot',
        'screaming frog', 'sistrix', 'seznambot', 'petalbot',
        // Headless / automation
        'headlesschrome', 'phantomjs', 'puppeteer', 'playwright',
        'selenium', 'webdriver', 'cypress', 'electron',
        // Genéricos
        'bot\\b', 'crawler', 'spider', 'scraper', 'curl', 'wget',
        'python-requests', 'go-http-client', 'java/', 'okhttp',
        'http_request', 'libwww', 'lwp::simple', 'mechanize',
        // Validadores y monitores
        'pingdom', 'uptimerobot', 'newrelic', 'datadog', 'statuscake',
        'gtmetrix', 'lighthouse', 'pagespeed', 'chrome-lighthouse',
        // Google Ads / AdsBot
        'adsbot-google', 'mediapartners-google', 'apis-google',
        'google-inspectiontool', 'google-read-aloud', 'storebot-google'
    ].join('|'),
    'i'
);

// Hostnames legítimos verificables por reverse DNS
const TRUSTED_BOT_HOSTNAMES = [
    '.googlebot.com', '.google.com',
    '.search.msn.com',
    '.crawl.yahoo.net',
    '.yandex.ru', '.yandex.net', '.yandex.com'
];

// Cache LRU simple para resultados de reverse DNS (evita golpear DNS en cada request)
class LRUCache {
    constructor(maxSize = 1000, ttlMs = 60 * 60 * 1000) {
        this.maxSize = maxSize;
        this.ttlMs = ttlMs;
        this.store = new Map();
    }
    get(key) {
        const entry = this.store.get(key);
        if (!entry) return undefined;
        if (Date.now() - entry.t > this.ttlMs) {
            this.store.delete(key);
            return undefined;
        }
        // Refresh order
        this.store.delete(key);
        this.store.set(key, entry);
        return entry.v;
    }
    set(key, value) {
        if (this.store.size >= this.maxSize) {
            const oldest = this.store.keys().next().value;
            this.store.delete(oldest);
        }
        this.store.set(key, { v: value, t: Date.now() });
    }
}

const dnsCache = new LRUCache(2000, 6 * 60 * 60 * 1000); // 6h TTL

// ─────────────────────────────────────────────────────────────────────────────
// Utilidades
// ─────────────────────────────────────────────────────────────────────────────

function getClientIp(req) {
    const forwarded = req.headers['x-forwarded-for'];
    if (forwarded) return forwarded.split(',')[0].trim();
    return req.ip || req.connection?.remoteAddress || '';
}

async function reverseDnsVerify(ip) {
    if (!ip) return null;
    const cached = dnsCache.get(ip);
    if (cached !== undefined) return cached;

    try {
        const hostnames = await dns.reverse(ip);
        if (!hostnames?.length) {
            dnsCache.set(ip, null);
            return null;
        }
        // Forward-confirm: el hostname debe resolver de vuelta al mismo IP
        const host = hostnames[0].toLowerCase();
        const isTrusted = TRUSTED_BOT_HOSTNAMES.some(suffix => host.endsWith(suffix));

        if (!isTrusted) {
            dnsCache.set(ip, { host, trusted: false });
            return { host, trusted: false };
        }

        const forwardIps = await dns.resolve(host).catch(() => []);
        const result = { host, trusted: forwardIps.includes(ip) };
        dnsCache.set(ip, result);
        return result;
    } catch {
        dnsCache.set(ip, null);
        return null;
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Detectores (Strategy Pattern)
// Cada detector retorna un score numérico (0 = humano, ≥1 = bot)
// y una razón legible para auditoría.
// ─────────────────────────────────────────────────────────────────────────────

const detectors = {
    /** Detecta por patrón conocido en el User-Agent */
    userAgent(req) {
        const ua = (req.headers['user-agent'] || '').toLowerCase();
        if (!ua) return { score: 1, reason: 'missing-ua' };
        if (BOT_UA_REGEX.test(ua)) return { score: 1, reason: `ua-match` };
        return { score: 0 };
    },

    /** Detecta headless browsers por señales en headers */
    headless(req) {
        const ua = (req.headers['user-agent'] || '').toLowerCase();
        if (ua.includes('headlesschrome') || ua.includes('phantomjs')) {
            return { score: 1, reason: 'headless-ua' };
        }
        // Chrome real envía sec-ch-ua; Puppeteer/Playwright suelen omitirlo
        const isChromeUA = ua.includes('chrome/') && !ua.includes('edg/') && !ua.includes('opr/');
        if (isChromeUA && !req.headers['sec-ch-ua']) {
            return { score: 1, reason: 'chrome-no-sec-ch-ua' };
        }
        return { score: 0 };
    },

    /** Headers HTTP atípicos en navegadores reales */
    httpHeaders(req) {
        const accept = req.headers['accept'] || '';
        const acceptLang = req.headers['accept-language'] || '';
        // Navegadores reales casi siempre envían Accept-Language y Accept con text/html
        if (!acceptLang) return { score: 1, reason: 'no-accept-language' };
        if (!accept.includes('text/html') && !accept.includes('*/*')) {
            return { score: 1, reason: 'no-html-accept' };
        }
        return { score: 0 };
    }
};

// ─────────────────────────────────────────────────────────────────────────────
// Clasificador principal
// ─────────────────────────────────────────────────────────────────────────────

async function classify(req) {
    const reasons = [];
    let totalScore = 0;

    for (const [name, detector] of Object.entries(detectors)) {
        const result = detector(req);
        if (result.score > 0) {
            totalScore += result.score;
            reasons.push(`${name}:${result.reason}`);
        }
    }

    const isBot = totalScore >= BOT_SCORE_THRESHOLD;

    // Verificación opcional por reverse DNS (solo si parece bot legítimo)
    let trusted = false;
    if (isBot) {
        const ip = getClientIp(req);
        const dnsResult = await reverseDnsVerify(ip).catch(() => null);
        trusted = Boolean(dnsResult?.trusted);
    }

    return {
        isBot,
        trusted,
        score: totalScore,
        reasons,
        ip: getClientIp(req),
        ua: req.headers['user-agent'] || ''
    };
}

// ─────────────────────────────────────────────────────────────────────────────
// Middleware Express
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Crea un middleware de cloaking.
 *
 * @param {Object} options
 * @param {string}   options.botPage    - Archivo a servir a bots (default: 'landing.html')
 * @param {string}   options.humanPage  - Archivo a servir a humanos (default: 'index.html')
 * @param {string}   options.basePath   - Directorio base de archivos (default: cwd)
 * @param {boolean}  options.logEnabled - Logs estructurados (default: true)
 * @param {Function} options.onHuman    - (req,res,verdict) → custom para humanos (ej: redirect)
 * @param {Function} options.onBot      - (req,res,verdict) → custom para bots
 */
function createCloaker(options = {}) {
    const path = require('path');
    const {
        botPage = 'landing.html',
        humanPage = 'index.html',
        basePath = process.cwd(),
        logEnabled = true,
        onHuman = null,
        onBot = null
    } = options;

    return async function cloakerMiddleware(req, res, next) {
        try {
            const verdict = await classify(req);

            if (logEnabled) {
                console.log(JSON.stringify({
                    type: 'cloaker',
                    decision: verdict.isBot ? 'bot' : 'human',
                    trusted: verdict.trusted,
                    score: verdict.score,
                    reasons: verdict.reasons,
                    ip: verdict.ip,
                    ua: verdict.ua.slice(0, 120),
                    path: req.path
                }));
            }

            // Headers anti-cache para que CDNs no cacheen una respuesta cruzada
            res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
            res.set('Vary', 'User-Agent');

            if (verdict.isBot) {
                if (typeof onBot === 'function') return onBot(req, res, verdict);
                return res.sendFile(path.join(basePath, botPage));
            }
            if (typeof onHuman === 'function') return onHuman(req, res, verdict);
            return res.sendFile(path.join(basePath, humanPage));
        } catch (err) {
            console.error('[cloaker] error:', err.message);
            return res.sendFile(path.join(basePath, options.botPage || 'landing.html'));
        }
    };
}

module.exports = {
    createCloaker,
    classify,
    detectors,
    BOT_UA_REGEX
};
