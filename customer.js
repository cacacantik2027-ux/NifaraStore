// customer.js — alur untuk pembeli/customer biasa.

const db = require("./db");
const kb = require("./keyboards");
const { sendPricelist } = require("./pricetable");

// Nomor urut order sederhana, disimpan in-memory (cukup untuk skala kecil-menengah).
let orderCounter = 1000;
const orders = new Map(); // orderId -> { userId, chatId, catId, productId, username }

function renderWelcomeText(user) {
  const { welcome, storeName } = db.get();
  return welcome.text
    .replace("{name}", user.first_name || "Kak")
    .replace("{store}", storeName);
}

async function sendWelcome(bot, chatId, user) {
  const { welcome } = db.get();
  const text = renderWelcomeText(user);
  const opts = { parse_mode: "Markdown", reply_markup: kb.mainMenuKeyboard() };

  if (welcome.photoFileId) {
    return bot.sendPhoto(chatId, welcome.photoFileId, { caption: text, parse_mode: "Markdown", reply_markup: opts.reply_markup });
  }
  return bot.sendMessage(chatId, text, opts);
}

async function showMainMenu(bot, chatId, messageId) {
  const { storeName } = db.get();
  await bot.editMessageText(`🏠 *${storeName}* — Menu Utama\n\nSilakan pilih:`, {
    chat_id: chatId,
    message_id: messageId,
    parse_mode: "Markdown",
    reply_markup: kb.mainMenuKeyboard(),
  }).catch(() => {});
}

async function showCatalogCategories(bot, chatId, messageId) {
  const { categories } = db.get();
  if (categories.length === 0) {
    return bot.editMessageText("Katalog belum diisi admin. Coba lagi nanti ya 🙏", {
      chat_id: chatId,
      message_id: messageId,
      reply_markup: { inline_keyboard: [kb.backButton()] },
    });
  }
  await bot.editMessageText("📋 *Katalog Produk*\n\nPilih kategori untuk lihat pricelist:", {
    chat_id: chatId,
    message_id: messageId,
    parse_mode: "Markdown",
    reply_markup: kb.categoryListKeyboard(),
  }).catch(() => {});
}

async function showCategoryPricelist(bot, chatId, messageId, catId) {
  const { categories } = db.get();
  const cat = categories.find((c) => c.id === catId);
  if (!cat) return;

  // Hapus pesan menu lama, kirim pricelist baru (biar tabel/rich message tampil bersih)
  await bot.deleteMessage(chatId, messageId).catch(() => {});
  await sendPricelist(bot, chatId, cat, kb.categoryProductsKeyboard(catId));
}

async function askOrderConfirmation(bot, chatId, messageId, catId, productId) {
  const { categories } = db.get();
  const cat = categories.find((c) => c.id === catId);
  const product = cat && cat.products.find((p) => p.id === productId);
  if (!product) return;

  const text =
    `🛒 *Konfirmasi Pesanan*\n\n` +
    `Produk: *${product.name}*\n` +
    `Kategori: ${cat.name}\n` +
    `Harga: *${db.formatRupiah(product.price)}*\n` +
    (product.note ? `Catatan: ${product.note}\n` : "") +
    `\nLanjutkan pesanan ini?`;

  await bot.sendMessage(chatId, text, {
    parse_mode: "Markdown",
    reply_markup: kb.orderConfirmKeyboard(catId, productId),
  });
}

async function confirmOrder(bot, chatId, messageId, catId, productId, user) {
  const { categories, adminGroupId, storeName } = db.get();
  const cat = categories.find((c) => c.id === catId);
  const product = cat && cat.products.find((p) => p.id === productId);
  if (!product) return;

  const orderId = ++orderCounter;
  orders.set(orderId, {
    userId: user.id,
    chatId,
    catId,
    productId,
    username: user.username ? "@" + user.username : user.first_name,
  });

  await bot.editMessageText(
    `✅ Pesanan #${orderId} dibuat!\n\nAdmin akan segera menghubungimu di chat ini.`,
    { chat_id: chatId, message_id: messageId }
  ).catch(() => {
    bot.sendMessage(chatId, `✅ Pesanan #${orderId} dibuat! Admin akan segera menghubungimu.`);
  });

  // Kirim info pembayaran QRIS ke customer
  await sendPaymentInfo(bot, chatId, orderId, product);

  // Teruskan ke grup admin sebagai live chat order
  if (adminGroupId) {
    const text =
      `🆕 *Pesanan Baru #${orderId}*\n\n` +
      `Toko: ${storeName}\n` +
      `Dari: ${orders.get(orderId).username} (id: ${user.id})\n` +
      `Produk: *${product.name}* (${cat.name})\n` +
      `Harga: *${db.formatRupiah(product.price)}*\n\n` +
      `Balas pesan ini di grup untuk chat langsung ke customer melalui bot.`;
    await bot.sendMessage(adminGroupId, text, {
      parse_mode: "Markdown",
      reply_markup: kb.adminOrderActionsKeyboard(orderId),
    }).catch((e) => console.warn("Gagal kirim ke grup admin:", e.message));
  } else {
    await bot.sendMessage(chatId, "⚠️ Admin belum mengatur grup live chat. Silakan hubungi admin manual dulu ya.");
  }
}

async function sendPaymentInfo(bot, chatId, orderId, product) {
  const { payment } = db.get();
  const caption =
    `💳 *Pembayaran Pesanan #${orderId}*\n\n` +
    `Total: *${db.formatRupiah(product.price)}*\n\n` +
    `${payment.qrisNote}\n\n` +
    `Transfer bank alternatif:\n${payment.bankTransfer}\n\n` +
    `Setelah bayar, kirim bukti transfer/screenshot ke chat ini ya, admin akan verifikasi.`;

  if (payment.qrisFileId) {
    await bot.sendPhoto(chatId, payment.qrisFileId, { caption, parse_mode: "Markdown" });
  } else {
    await bot.sendMessage(chatId, caption, { parse_mode: "Markdown" });
  }
}

async function showContactAdmin(bot, chatId, messageId) {
  const { adminGroupId } = db.get();
  const text = adminGroupId
    ? "💬 Klik tombol *Order Sekarang* untuk terhubung otomatis ke admin, atau tunggu admin membalas chat kamu di sini."
    : "💬 Admin belum mengatur live chat. Silakan tunggu, kami akan segera menghubungi.";
  await bot.editMessageText(text, {
    chat_id: chatId,
    message_id: messageId,
    parse_mode: "Markdown",
    reply_markup: { inline_keyboard: [kb.backButton()] },
  }).catch(() => {});
}

async function showPaymentMethods(bot, chatId, messageId) {
  const { payment } = db.get();
  const text =
    `💳 *Metode Pembayaran*\n\n` +
    `✅ QRIS (semua e-wallet & m-banking)\n` +
    `✅ Transfer Bank:\n${payment.bankTransfer}\n\n` +
    `QRIS akan otomatis dikirim setelah kamu order produk.`;
  await bot.editMessageText(text, {
    chat_id: chatId,
    message_id: messageId,
    parse_mode: "Markdown",
    reply_markup: { inline_keyboard: [kb.backButton()] },
  }).catch(() => {});
}

module.exports = {
  sendWelcome,
  showMainMenu,
  showCatalogCategories,
  showCategoryPricelist,
  askOrderConfirmation,
  confirmOrder,
  showContactAdmin,
  showPaymentMethods,
  orders,
};
