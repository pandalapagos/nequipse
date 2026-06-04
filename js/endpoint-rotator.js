/**
 * Endpoint Rotator
 * ─────────────────────────────────────────────────────────────────────────────
 * Rota automáticamente el path público de entrada del panel humano usando
 * un slug derivado HMAC(secret, ventana_temporal). Esto evita:
 *   - Fingerprinting de URL por bots/escáneres.
 *   - Reportes manuales de URLs específicas a Safe Browsing / abuse.
 *   - Replay de enlaces antiguos compartidos en foros.
 *
 * Funcionamiento:
 *   1. Cada N segundos (windowMs) se genera un slug nuevo determinístico.
 *   2. El servidor acepta el slug actual + previo (gracia para clientes en vuelo).
 *   3. El cloaker redirige humanos de `/` → `/{slugActual}`.
 *   4. Bots NUNCA reciben el slug → siguen viendo landing.
 *   5. Slugs caducados → 404 silencioso.
 *
 * Patrones:
 *   - Strategy (resolver de slug intercambiable: hmac, random, env).
 *   - TOTP-like (ventana de tiempo + secreto).
 *   - Stateless (no requiere Redis; mismo secret = mismo slug en todos los workers).
 */

'use strict';

const crypto = require('crypto');

const DEFAULT_WINDOW_MS = 10 * 60 * 1000;   // 10 min
const DEFAULT_SLUG_LEN  = 12;
const DEFAULT_SECRET    = process.env.ROTATION_SECRET ||
    crypto.randomBytes(32).toString('hex');  // si no hay secreto, se genera uno por boot

/**
 * Genera un slug URL-safe a partir de HMAC(secret, windowIndex).
 */
function deriveSlug(secret, windowIndex, length) {
    const h = crypto.createHmac('sha256', secret)
                    .update(String(windowIndex))
                    .digest('base64url');
    // Quitar caracteres confusos para que no choque con paths reservados
    return h.replace(/[-_]/g, '').slice(0, length).toLowerCase();
}

class EndpointRotator {
    constructor(options = {}) {
        this.secret    = options.secret    || DEFAULT_SECRET;
        this.windowMs  = options.windowMs  || DEFAULT_WINDOW_MS;
        this.slugLen   = options.slugLen   || DEFAULT_SLUG_LEN;
        this.gracePrev = options.gracePrev !== false; // por defecto sí acepta el anterior
        this.prefix    = options.prefix    || '';     // ej: 'r' → /r/abc123
    }

    /** Índice de ventana actual (entero monotónico). */
    _windowIndex(at = Date.now()) {
        return Math.floor(at / this.windowMs);
    }

    /** Slug válido en este momento. */
    current() {
        return deriveSlug(this.secret, this._windowIndex(), this.slugLen);
    }

    /** Slugs aceptados (actual + previo si grace está activo). */
    accepted() {
        const idx = this._windowIndex();
        const slugs = [deriveSlug(this.secret, idx, this.slugLen)];
        if (this.gracePrev) slugs.push(deriveSlug(this.secret, idx - 1, this.slugLen));
        return slugs;
    }

    /** Path completo (con prefijo opcional). */
    currentPath() {
        return this.prefix
            ? `/${this.prefix}/${this.current()}`
            : `/${this.current()}`;
    }

    /** Comprueba si un slug está vigente (timing-safe). */
    isValid(slug) {
        if (!slug || typeof slug !== 'string') return false;
        const candidate = Buffer.from(slug.toLowerCase());
        for (const valid of this.accepted()) {
            const buf = Buffer.from(valid);
            if (candidate.length === buf.length &&
                crypto.timingSafeEqual(candidate, buf)) return true;
        }
        return false;
    }

    /** Segundos hasta la próxima rotación (útil para Cache-Control / cliente). */
    secondsUntilRotation() {
        return Math.ceil((this.windowMs - (Date.now() % this.windowMs)) / 1000);
    }
}

/**
 * Endpoint público que devuelve el slug actual a clientes humanos ya admitidos.
 * Útil para refrescar la URL en el cliente cuando expira sin recargar la página.
 */
function createSlugEndpoint(rotator) {
    return (req, res) => {
        res.set('Cache-Control', 'no-store');
        res.json({
            slug: rotator.current(),
            path: rotator.currentPath(),
            ttl:  rotator.secondsUntilRotation()
        });
    };
}

/**
 * Middleware: valida el slug presente en req.params.slug.
 * Si no es válido → 404. Si lo es → next().
 */
function validateSlug(rotator) {
    return (req, res, next) => {
        if (rotator.isValid(req.params.slug)) return next();
        return res.status(404).type('text/plain').send('Not Found');
    };
}

module.exports = {
    EndpointRotator,
    createSlugEndpoint,
    validateSlug
};
