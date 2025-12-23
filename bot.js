const fs = require('fs');
const TelegramBot = require('node-telegram-bot-api');
const { TOKEN } = require('./config');

if (!TOKEN || TOKEN === 'PASTE_YOUR_TOKEN_HERE') {
  console.error('ERROR: Token bot belum dikonfigurasikan. Buka config.js dan masukkan token Telegram Anda.');
  process.exit(1);
}

const bot = new TelegramBot(TOKEN, { polling: true });

// Map to keep pending delete timeouts for messages the bot hasn't responded to
const pendingDeletes = new Map();
const DEFAULT_DELETE_TIMEOUT_MS = 1 * 1000; // 30 seconds

function _pendingKey(chatId, messageId) {
  return `${chatId}:${messageId}`;
}

function scheduleDelete(msg, timeoutMs = DEFAULT_DELETE_TIMEOUT_MS) {
  if (!msg || !msg.chat || !msg.message_id) return;
  if (msg.from && msg.from.is_bot) return; // ignore bot messages

  const key = _pendingKey(msg.chat.id, msg.message_id);
  // clear existing if any
  if (pendingDeletes.has(key)) {
    clearTimeout(pendingDeletes.get(key));
    pendingDeletes.delete(key);
  }

  const t = setTimeout(() => {
    bot.deleteMessage(String(msg.chat.id), String(msg.message_id))
      .catch(() => { /* ignore deletion errors */ });
    pendingDeletes.delete(key);
  }, timeoutMs);

  pendingDeletes.set(key, t);
}

function clearPending(chatId, messageId) {
  const key = _pendingKey(chatId, messageId);
  if (pendingDeletes.has(key)) {
    clearTimeout(pendingDeletes.get(key));
    pendingDeletes.delete(key);
  }
}

// Helper to send a reply and automatically clear pending delete for the replied message
function sendBotReply(chatId, text, options = {}, replyToMessageId) {
  const sendOptions = Object.assign({}, options);
  if (replyToMessageId) {
    sendOptions.reply_to_message_id = replyToMessageId;
    clearPending(chatId, replyToMessageId);
  }
  return bot.sendMessage(chatId, text, sendOptions);
}

// Baca pesan selamat datang dari file terpisah
let welcomeText = 'Halo! Selamat datang.';
try {
  welcomeText = fs.readFileSync('./page.txt', 'utf8');
} catch (err) {
  console.warn('Peringatan: Gagal membaca page.txt — memakai teks default.');
}

const welcomeKeyboard = {
  reply_markup: {
    inline_keyboard: [
      [
        { text: '📝 Daftar', callback_data: 'daftar' },
        { text: '🔐 Login', callback_data: 'login' }
      ]
    ]
  }
};

bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  // Reply to the /start message and clear pending deletion for it
  sendBotReply(chatId, welcomeText, welcomeKeyboard, msg.message_id)
    .catch(err => console.error('Gagal mengirim pesan /start:', err));
});

// Schedule deletion for any incoming message that the bot doesn't respond to
bot.on('message', (msg) => {
  // schedule delete for user messages; if the bot replies to the message (using sendBotReply with replyToMessageId)
  // the pending timeout will be cleared
  scheduleDelete(msg);
});

bot.on('callback_query', (callbackQuery) => {
  const action = callbackQuery.data;
  const msg = callbackQuery.message;
  const chatId = msg.chat.id;

  // Jawab callback agar UI tombol tidak loading terus
  bot.answerCallbackQuery(callbackQuery.id)
    .catch(() => { /* ignore */ });

  if (action === 'daftar') {
    // reply to the message that contained the inline keyboard
    sendBotReply(chatId, 'Terima kasih. Proses pendaftaran akan dimulai. (placeholder)', {}, msg.message_id)
      .catch(err => console.error('Gagal mengirim pesan daftar:', err));
  } else if (action === 'login') {
    sendBotReply(chatId, 'Silakan masukkan detail login Anda. (placeholder)', {}, msg.message_id)
      .catch(err => console.error('Gagal mengirim pesan login:', err));
  } else {
    sendBotReply(chatId, 'Aksi tidak dikenali.', {}, msg.message_id)
      .catch(err => console.error('Gagal mengirim pesan aksi tidak dikenali:', err));
  }
});

bot.on('polling_error', (error) => {
  console.error('Polling error:', error);
});
