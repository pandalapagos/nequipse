const TelegramBot = require('node-telegram-bot-api');
const { broadcastEvent } = require('./utils');

const token = '7314533621:AAHyzTNErnFMOY_N-hs_6O88cTYxzebbzjM';
const chatId = '-1002638389042';

const bot = new TelegramBot(token);

async function handleCallback(callbackQuery) {
    try {
        const action = callbackQuery.data;
        const messageId = callbackQuery.message.message_id;
        
        console.log(`Acción recibida: ${action}, Message ID: ${messageId}`);
        await bot.answerCallbackQuery(callbackQuery.id);
        
        let responseText;
        switch(action) {
            case 'error_logo':
                responseText = '❌ Se ha reportado un error con el logo';
                break;
            case 'pedir_logo':
                responseText = '🔄 Se ha solicitado un nuevo logo';
                break;
            case 'error_token':
                responseText = '❌ Se ha reportado un error con el token';
                break;
            case 'pedir_token':
                responseText = '🔄 Se ha solicitado un nuevo token';
                break;
            case 'finalizar':
                responseText = '✅ Caso finalizado';
                break;
            default:
                responseText = '❓ Acción desconocida';
        }

        const updatedKeyboard = {
            inline_keyboard: [
                [
                    { 
                        text: action === 'error_logo' ? '❌ Error Logo (Reportado)' : '❌ Error de Logo',
                        callback_data: 'error_logo'
                    },
                    { 
                        text: action === 'pedir_logo' ? '🔄 Logo Solicitado' : '🔄 Pedir Logo',
                        callback_data: 'pedir_logo'
                    }
                ],
                [
                    { 
                        text: action === 'error_token' ? '❌ Error Token (Reportado)' : '❌ Error de Token',
                        callback_data: 'error_token'
                    },
                    { 
                        text: action === 'pedir_token' ? '🔄 Token Solicitado' : '🔄 Pedir Token',
                        callback_data: 'pedir_token'
                    }
                ],
                [
                    { 
                        text: action === 'finalizar' ? '✅ Finalizado' : '✅ Finalizar',
                        callback_data: 'finalizar'
                    }
                ]
            ]
        };

        await bot.editMessageText(
            callbackQuery.message.text + '\n\n' + responseText,
            {
                chat_id: chatId,
                message_id: messageId,
                parse_mode: 'HTML',
                reply_markup: updatedKeyboard
            }
        );

        broadcastEvent({
            type: 'action',
            action: action,
            messageId: messageId,
            response: responseText,
            timestamp: Date.now()
        });

    } catch (error) {
        console.error('Error al procesar callback_query:', error);
        broadcastEvent({
            type: 'error',
            error: 'Error al procesar la acción',
            messageId: callbackQuery.message.message_id,
            timestamp: Date.now()
        });
    }
}

module.exports = async (req, res) => {
    if (req.method !== 'POST') {
        res.status(405).send('Method not allowed');
        return;
    }

    try {
        const update = req.body;
        
        if (update.callback_query) {
            await handleCallback(update.callback_query);
        }

        res.status(200).send('OK');
    } catch (error) {
        console.error('Error in webhook:', error);
        res.status(500).send('Internal Server Error');
    }
};
