// Mapa para almacenar los mensajes y su historial
const messageStore = new Map();

// Función para almacenar un nuevo mensaje
function storeMessage(messageId, data) {
    messageStore.set(messageId, {
        originalMessage: data,
        actions: [],
        timestamp: Date.now()
    });
}

// Función para actualizar un mensaje existente
function updateMessage(messageId, action) {
    const message = messageStore.get(messageId);
    if (message) {
        message.actions.push({
            action,
            timestamp: Date.now()
        });
        return message;
    }
    return null;
}

// Función para obtener un mensaje
function getMessage(messageId) {
    return messageStore.get(messageId);
}

// Función para transmitir eventos SSE
function broadcastEvent(clients, event) {
    const eventString = `data: ${JSON.stringify(event)}\n\n`;
    const deadClients = new Set();

    clients.forEach(client => {
        try {
            client.write(eventString);
        } catch (error) {
            console.error('Error al enviar evento al cliente:', error);
            deadClients.add(client);
        }
    });

    // Limpiar clientes desconectados
    deadClients.forEach(client => clients.delete(client));
}

module.exports = {
    storeMessage,
    updateMessage,
    getMessage,
    broadcastEvent
};