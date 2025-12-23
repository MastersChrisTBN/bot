const fs = require('fs');
const TelegramBot = require('node-telegram-bot-api');
const { TOKEN } = require('./config');

if (!TOKEN || TOKEN === 'PASTE_YOUR_TOKEN_HERE') {
  console.error('ERROR: Token bot belum dikonfigurasikan. Buka config.js dan masukkan token Telegram Anda.');
  process.exit(1);
}

const bot = new TelegramBot(TOKEN, { polling: true });

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
  bot.sendMessage(chatId, welcomeText, welcomeKeyboard)
    .catch(err => console.error('Gagal mengirim pesan /start:', err));
});

bot.on('callback_query', (callbackQuery) => {
  const action = callbackQuery.data;
  const msg = callbackQuery.message;
  const chatId = msg.chat.id;

  // Jawab callback agar UI tombol tidak loading terus
  bot.answerCallbackQuery(callbackQuery.id)
    .catch(() => { /* ignore */ });

  if (action === 'daftar') {
    bot.sendMessage(chatId, 'Terima kasih. Proses pendaftaran akan dimulai. (placeholder)')
      .catch(err => console.error('Gagal mengirim pesan daftar:', err));
  } else if (action === 'login') {
    bot.sendMessage(chatId, 'Silakan masukkan detail login Anda. (placeholder)')
      .catch(err => console.error('Gagal mengirim pesan login:', err));
  } else {
    bot.sendMessage(chatId, 'Aksi tidak dikenali.')
      .catch(err => console.error('Gagal mengirim pesan aksi tidak dikenali:', err));
  }
});

bot.on('polling_error', (error) => {
  console.error('Polling error:', error);
});
