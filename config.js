// Jangan commit token nyata ke repositori publik.
// Untuk keamanan, lebih baik gunakan environment variable.
// File ini menyediakan fallback bila environment variable tidak ada.
module.exports = {
  TOKEN: process.env.BOT_TOKEN || '8534902870:AAF1jcNBlkZWG-TIKWA5XkvCqu73hg66JTg'
};
