'use strict';
const fs = require('fs');
const TelegramBot = require('node-telegram-bot-api');
const { TOKEN, WEBAPP_URL } = require('./config');

if (!TOKEN || TOKEN === 'PASTE_YOUR_TOKEN_HERE') {
  console.error('ERROR: Token bot belum dikonfigurasikan. Buka config.js dan masukkan token Telegram Anda.');
  process.exit(1);
}

const bot = new TelegramBot(TOKEN, { polling: true });

// Map to keep pending delete timeouts for messages the bot hasn't responded to
const pendingDeletes = new Map();
const DEFAULT_DELETE_TIMEOUT_MS = 30 * 1000; // 30 seconds

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

// --- Simple persistent storage for registered users ---
const USERS_FILE = './users.json';
let users = {};
try {
  if (fs.existsSync(USERS_FILE)) {
    users = JSON.parse(fs.readFileSync(USERS_FILE, 'utf8') || '{}');
  } else {
    users = {};
  }
} catch (err) {
  console.warn('Peringatan: gagal membaca users.json, mulai dengan data kosong.', err);
  users = {};
}
function saveUsers() {
  try {
    fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2), 'utf8');
  } catch (err) {
    console.error('Gagal menyimpan users.json:', err);
  }
}

// --- Conversation state for ongoing registration ---
const userStates = new Map(); // key: chatId -> { step, data }

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

  // Handle Web App responses (Telegram Web App dapat mengirim data ke bot via web_app_data)
  try {
    if (msg && msg.web_app_data && msg.web_app_data.data) {
      const data = msg.web_app_data.data; // string sent from Web App
      // contoh: data === 'ad_shown'
      if (data === 'ad_shown') {
        // user sudah menonton iklan / web app menandakan selesai -> lanjut ke proses login
        sendBotReply(msg.chat.id, '✅ Terima kasih. Iklan selesai ditayangkan. Silakan lanjutkan proses login.', {}, msg.message_id)
          .catch(() => {});
        // Di sini Anda bisa memulai flow login (mengirim prompt username/password, atau membuka webapp login lagi)
      } else if (data === 'ad_cancelled') {
        sendBotReply(msg.chat.id, '⛔ Anda membatalkan menonton iklan. Login dibatalkan.', {}, msg.message_id)
          .catch(() => {});
      } else {
        // kebijakan: terima data lain jika Anda definisikan
        sendBotReply(msg.chat.id, `📨 WebApp mengirim data: ${data}`, {}, msg.message_id)
          .catch(() => {});
      }
    }
  } catch (err) {
    // ignore parsing errors
  }

  // Handle registration steps if user is in the middle of the form
  const chatId = msg.chat.id;
  if (!msg.text) return; // only text input handled here

  const state = userStates.get(chatId);
  if (!state) return; // not in a form flow

  const text = msg.text.trim();

  if (state.step === 'enter_name') {
    // Validate: only letters and spaces (allow Indonesian characters)
    if (!/^[\p{L} ]+$/u.test(text)) {
      sendBotReply(chatId, '❌ Nama tidak valid. Masukkan hanya huruf dan spasi. Contoh: <b>Agus Budiman</b>', { parse_mode: 'HTML' }, msg.message_id)
        .catch(() => {});
      return;
    }
    state.data.account_name = text;
    state.step = 'enter_account';
    sendBotReply(chatId, '💳 Silakan masukkan <b>No Rekening</b> (hanya angka). Contoh: 1234567890', { parse_mode: 'HTML' }, msg.message_id)
      .catch(() => {});
    return;
  }

  if (state.step === 'enter_account') {
    // Validate: only digits
    if (!/^\d+$/.test(text)) {
      sendBotReply(chatId, '❌ Nomor rekening tidak valid. Masukkan hanya angka tanpa spasi atau tanda lain.', { parse_mode: 'HTML' }, msg.message_id)
        .catch(() => {});
      return;
    }
    state.data.account_number = text;

    // Prepare confirmation
    const payload = state.data;
    const summary = `<b>✅ Konfirmasi Pendaftaran</b>\n\n` +
      `🏦 <b>Bank:</b> ${payload.bank}\n` +
      `👤 <b>Nama di Rekening:</b> ${payload.account_name}\n` +
      `💳 <b>No Rekening:</b> ${payload.account_number}\n\n` +
      `Tekan <b>Konfirmasi</b> untuk menyelesaikan pendaftaran.`;
    const confirmKeyboard = {
      reply_markup: {
        inline_keyboard: [
          [{ text: '✅ Konfirmasi', callback_data: 'confirm_register' }, { text: '❌ Batal', callback_data: 'cancel_register' }]
        ]
      },
      parse_mode: 'HTML'
    };
    sendBotReply(chatId, summary, confirmKeyboard, msg.message_id)
      .catch(() => {});
    state.step = 'confirm';
    return;
  }
});

// Helper: show dashboard for a registered user
function showDashboard(chatId, user) {
  const text = `<b>📊 Dashboard</b>\n\n` +
    `<b>Nama Lengkap:</b> ${user.account_name}\n` +
    `<b>Bank:</b> ${user.bank}\n` +
    `<b>Saldo:</b> Rp ${Number(user.balance || 0).toLocaleString('id-ID')}\n\n` +
    `Gunakan saldo untuk membeli, deposit, atau withdraw.`;
  const keyboard = {
    reply_markup: {
      inline_keyboard: [
        [{ text: '💰 Deposit', callback_data: 'deposit' }, { text: '💸 Withdraw', callback_data: 'withdraw' }],
        [{ text: '🛒 Beli', callback_data: 'buy' }, { text: '🔁 Perbarui Profil', callback_data: 'update_profile' }]
      ]
    },
    parse_mode: 'HTML'
  };
  return sendBotReply(chatId, text, keyboard).catch(() => {});
}

bot.on('callback_query', (callbackQuery) => {
  const action = callbackQuery.data;
  const msg = callbackQuery.message;
  const chatId = msg.chat.id;

  // Jawab callback agar UI tombol tidak loading terus
  bot.answerCallbackQuery(callbackQuery.id)
    .catch(() => { /* ignore */ });

  if (action === 'daftar') {
    // Jika user sudah terdaftar, tawarkan dashboard
    const uid = String(chatId);
    if (users[uid]) {
      sendBotReply(chatId, 'Anda sudah terdaftar. Membuka dashboard Anda...', {}, msg.message_id)
        .then(() => showDashboard(chatId, users[uid]))
        .catch(err => console.error('Gagal membuka dashboard:', err));
      return;
    }

    // Mulai alur pendaftaran: tampilkan judul dan pilih bank
    const title = `<b>Form Register Pazz 4D</b>\n\n` +
      `📝 Silakan pilih <b>Nama Bank</b> terlebih dahulu:`;
    const bankOptions = ['Mandiri', 'BRI', 'BCA', 'DANAMON', 'BSI', 'BNI', 'CIMB', 'DANA', 'GOPAY'];
    // buat inline keyboard bank dengan icon 🏦 pada setiap tombol
    const bankButtons = bankOptions.map(b => [{ text: `🏦 ${b}`, callback_data: `bank:${b}` }]);
    // keyboard layout: 2 per baris if possible
    const inlineKeyboard = [];
    for (let i = 0; i < bankButtons.length; i += 2) {
      if (bankButtons[i + 1]) inlineKeyboard.push([bankButtons[i][0], bankButtons[i + 1][0]]);
      else inlineKeyboard.push([bankButtons[i][0]]);
    }
    inlineKeyboard.push([{ text: '❌ Batal', callback_data: 'cancel_register' }]);

    const keyboard = {
      reply_markup: {
        inline_keyboard: inlineKeyboard
      },
      parse_mode: 'HTML'
    };

    // initialize state
    userStates.set(chatId, { step: 'choose_bank', data: {} });
    sendBotReply(chatId, title, keyboard, msg.message_id)
      .catch(err => console.error('Gagal memulai pendaftaran:', err));
    return;
  } else if (action && action.startsWith('bank:')) {
    const bank = action.split(':')[1];
    const state = userStates.get(chatId);
    if (!state || state.step !== 'choose_bank') {
      // ignore or prompt to start register
      sendBotReply(chatId, 'Silakan klik 📝 Daftar untuk memulai pendaftaran.', {}, msg.message_id)
        .catch(() => {});
      return;
    }
    state.data.bank = bank;
    state.step = 'enter_name';
    // ask for account name
    sendBotReply(chatId, '👤 Silakan masukkan <b>Nama di Rekening</b> (hanya huruf dan spasi). Contoh: Agus Budiman', { parse_mode: 'HTML' }, msg.message_id)
      .catch(() => {});
    return;
  } else if (action === 'confirm_register') {
    const state = userStates.get(chatId);
    if (!state || state.step !== 'confirm') {
      sendBotReply(chatId, 'Tidak ada pendaftaran untuk dikonfirmasi. Silakan ulangi proses pendaftaran.', {}, msg.message_id)
        .catch(() => {});
      return;
    }
    // Save user
    const uid = String(chatId);
    const newUser = {
      bank: state.data.bank,
      account_name: state.data.account_name,
      account_number: state.data.account_number,
      balance: 0
    };
    users[uid] = newUser;
    saveUsers();
    userStates.delete(chatId);

    // send confirmation message
    const confirmText = `<b>🎉 Pendaftaran Berhasil!</b>\n\n` +
      `Terima kasih, <b>${newUser.account_name}</b>.\n` +
      `Bank: ${newUser.bank}\n` +
      `No Rekening: ${newUser.account_number}\n\n` +
      `Saldo awal Anda adalah <b>Rp 0</b>.`;
    sendBotReply(chatId, confirmText, { parse_mode: 'HTML' }, msg.message_id)
      .then(() => showDashboard(chatId, newUser))
      .catch(err => console.error('Gagal mengirim konfirmasi pendaftaran:', err));
    return;
  } else if (action === 'cancel_register') {
    userStates.delete(chatId);
    sendBotReply(chatId, '⛔ Pendaftaran dibatalkan.', {}, msg.message_id)
      .catch(() => {});
    return;
  } else if (action === 'login') {
    // Tampilkan tombol yang membuka Telegram Web App untuk menayangkan iklan sebelum login
    const webAppUrl = WEBAPP_URL || 'https://your-host.example.com/webapp/ad.html';
    const keyboard = {
      reply_markup: {
        inline_keyboard: [
          [{ text: '▶️ Tonton Iklan untuk Login', web_app: { url: webAppUrl } }],
          [{ text: '❌ Batal', callback_data: 'cancel_login' }]
        ]
      }
    };
    sendBotReply(chatId, 'Sebelum login, mohon tonton video iklan singkat berikut (membuka web app).', keyboard, msg.message_id)
      .catch(err => console.error('Gagal mengirim tombol web app login:', err));
    return;
  } else if (action === 'cancel_login') {
    sendBotReply(chatId, '⛔ Login dibatalkan.', {}, msg.message_id)
      .catch(() => {});
    return;
  } else if (action === 'login') {
    sendBotReply(chatId, '🔐 Fitur login belum diimplementasikan. Silakan gunakan /start lalu Daftar jika belum terdaftar.', {}, msg.message_id)
      .catch(() => {});
    return;
  }

  // Dashboard actions for registered users
  const uid = String(chatId);
  const user = users[uid];
  if (!user) {
    // If not registered, prompt to register
    if (action === 'deposit' || action === 'withdraw' || action === 'buy' || action === 'update_profile') {
      sendBotReply(chatId, 'Anda belum terdaftar. Silakan klik 📝 Daftar terlebih dahulu.', {}, msg.message_id)
        .catch(() => {});
      return;
    }
  } else {
    if (action === 'deposit') {
      // Placeholder deposit flow
      sendBotReply(chatId, '💰 Deposit: fitur deposit akan datang. (placeholder)', {}, msg.message_id)
        .catch(() => {});
      return;
    } else if (action === 'withdraw') {
      sendBotReply(chatId, '💸 Withdraw: fitur withdraw akan datang. (placeholder)', {}, msg.message_id)
        .catch(() => {});
      return;
    } else if (action === 'buy') {
      sendBotReply(chatId, '🛒 Beli: fitur pembelian akan datang. (placeholder)', {}, msg.message_id)
        .catch(() => {});
      return;
    } else if (action === 'update_profile') {
      // simple placeholder to allow re-opening registration to change info
      userStates.set(chatId, { step: 'choose_bank', data: {} });
      sendBotReply(chatId, '🔁 Memperbarui profil. Silakan pilih bank baru atau batalkan.', {
        reply_markup: {
          inline_keyboard: [
            [{ text: '🏦 Mandiri', callback_data: 'bank:Mandiri' }, { text: '🏦 BRI', callback_data: 'bank:BRI' }],
            [{ text: '🏦 BCA', callback_data: 'bank:BCA' }, { text: '🏦 DANAMON', callback_data: 'bank:DANAMON' }],
            [{ text: '❌ Batal', callback_data: 'cancel_register' }]
          ]
        }
      }, msg.message_id).catch(() => {});
      return;
    } else if (action === 'open_dashboard' || action === 'view_dashboard') {
      showDashboard(chatId, user).catch(() => {});
      return;
    }
  }

  // Fallback for unknown action
  sendBotReply(chatId, 'Aksi tidak dikenali.', {}, msg.message_id)
    .catch(err => console.error('Gagal mengirim pesan aksi tidak dikenali:', err));
});

bot.on('polling_error', (error) => {
  console.error('Polling error:', error);
});
