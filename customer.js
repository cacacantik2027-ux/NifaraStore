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

  // Minta customer pilih metode pembayaran (bisa lebih dari satu metode
  // tersedia: QRIS 1, QRIS 2, Bank, Dana, dll — admin yang atur di panel)
  await sendPaymentMethodChoices(bot, chatId, orderId, product);

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

async function sendPaymentMethodChoices(bot, chatId, orderId, product) {
  const { paymentMethods } = db.get();
  if (!paymentMethods || paymentMethods.length === 0) {
    return bot.sendMessage(chatId, "⚠️ Admin belum mengatur metode pembayaran. Silakan hubungi admin manual dulu ya.");
  }
  const text =
    `💳 *Pilih Metode Pembayaran*\n\n` +
    `Pesanan: #${orderId}\n` +
    `Total: *${db.formatRupiah(product.price)}*\n\n` +
    `Tap salah satu metode di bawah untuk melihat cara bayarnya:`;
  await bot.sendMessage(chatId, text, {
    parse_mode: "Markdown",
    reply_markup: kb.paymentMethodsKeyboard(orderId),
  });
}

async function sendPaymentInfo(bot, chatId, orderId, pmId) {
  const { paymentMethods, categories } = db.get();
  const pm = (paymentMethods || []).find((m) => m.id === pmId);
  if (!pm) return;

  const order = orders.get(Number(orderId));
  let caption = `💳 *Pembayaran Pesanan #${orderId} — ${pm.name}*\n\n`;
  if (order) {
    const cat = categories.find((c) => c.id === order.catId);
    const product = cat && cat.products.find((p) => p.id === order.productId);
    if (product) caption += `Total: *${db.formatRupiah(product.price)}*\n\n`;
  }
  caption +=
    `${pm.note || "Admin belum mengisi catatan untuk metode ini."}\n\n` +
    `Setelah bayar, kirim bukti transfer/screenshot ke chat ini ya, admin akan verifikasi.`;

  if (pm.imageFileId) {
    await bot.sendPhoto(chatId, pm.imageFileId, { caption, parse_mode: "Markdown" });
  } else {
    await bot.sendMessage(chatId, caption, { parse_mode: "Markdown" });
  }
}

async function showPaymentMethodInfo(bot, chatId, messageId, pmId) {
  const { paymentMethods } = db.get();
  const pm = (paymentMethods || []).find((m) => m.id === pmId);
  if (!pm) return;
  const text = `💳 *${pm.name}*\n\n${pm.note || "Admin belum mengisi catatan untuk metode ini."}`;

  // Hapus pesan menu lama, kirim pesan baru (biar gambar QRIS tampil rapi kalau ada)
  await bot.deleteMessage(chatId, messageId).catch(() => {});
  if (pm.imageFileId) {
    await bot.sendPhoto(chatId, pm.imageFileId, {
      caption: text, parse_mode: "Markdown",
      reply_markup: { inline_keyboard: [kb.backButton()] },
    });
  } else {
    await bot.sendMessage(chatId, text, {
      parse_mode: "Markdown",
      reply_markup: { inline_keyboard: [kb.backButton()] },
    });
  }
}

async function contactAdmin(bot, chatId, messageId, user) {
  const { adminGroupId, storeName } = db.get();

  if (!adminGroupId) {
    const text = "💬 Admin belum mengatur live chat. Silakan tunggu, kami akan segera menghubungi.";
    return bot.editMessageText(text, {
      chat_id: chatId,
      message_id: messageId,
      reply_markup: { inline_keyboard: [kb.backButton()] },
    }).catch(() => {});
  }

  const text =
    "✅ *Anda terhubung Live Chat dengan admin*\n\n" +
    "Silakan tulis pertanyaan atau pesanmu di sini, admin akan segera membalas.";
  await bot.editMessageText(text, {
    chat_id: chatId,
    message_id: messageId,
    parse_mode: "Markdown",
    reply_markup: { inline_keyboard: [kb.backButton()] },
  }).catch(() => {
    bot.sendMessage(chatId, text, {
      parse_mode: "Markdown",
      reply_markup: { inline_keyboard: [kb.backButton()] },
    });
  });

  // Beri tahu admin di grup live chat bahwa ada pengguna yang menghubungi
  const username = user.username ? "@" + user.username : user.first_name;
  const groupText =
    `📞 *Live Chat Baru*\n\n` +
    `Toko: ${storeName}\n` +
    `Dari: ${username} (id: ${user.id})\n\n` +
    `Pengguna ini telah menghubungi Anda melalui tombol *Hubungi Admin*.`;
  await bot.sendMessage(adminGroupId, groupText, { parse_mode: "Markdown" })
    .catch((e) => console.warn("Gagal kirim notifikasi live chat ke grup admin:", e.message));
}

async function showPaymentMethods(bot, chatId, messageId) {
  const { paymentMethods } = db.get();
  if (!paymentMethods || paymentMethods.length === 0) {
    return bot.editMessageText("💳 Admin belum mengatur metode pembayaran.", {
      chat_id: chatId,
      message_id: messageId,
      reply_markup: { inline_keyboard: [kb.backButton()] },
    }).catch(() => {});
  }
  const text = "💳 *Metode Pembayaran Tersedia*\n\nTap salah satu untuk lihat detail cara bayarnya:";
  await bot.editMessageText(text, {
    chat_id: chatId,
    message_id: messageId,
    parse_mode: "Markdown",
    reply_markup: kb.paymentMethodsInfoKeyboard(),
  }).catch(() => {});
}

module.exports = {
  sendWelcome,
  showMainMenu,
  showCatalogCategories,
  showCategoryPricelist,
  askOrderConfirmation,
  confirmOrder,
  sendPaymentInfo,
  showPaymentMethodInfo,
  contactAdmin,
  showPaymentMethods,
  orders,
};
