// customer.js — alur untuk pembeli/customer biasa.

const db = require("./db");
const kb = require("./keyboards");
const { sendPricelist, sendFullPricelist } = require("./pricetable");

// Nomor urut order sederhana, disimpan in-memory (cukup untuk skala kecil-menengah).
let orderCounter = 1000;
const orders = new Map(); // orderId -> { userId, chatId, catId, productId, username }

// Relay live chat customer <-> grup admin.
// Key = message_id pesan yang muncul DI GRUP ADMIN (baik hasil forward pesan
// customer, maupun notifikasi teks biasa), Value = info customer asal supaya
// saat admin me-reply pesan itu di grup, bot tahu balasan itu harus dikirim
// ke chat customer yang mana.
const relayMap = new Map(); // groupMessageId -> { chatId, userId, username }

function rememberRelay(groupMessageId, chatId, userId, username) {
  if (!groupMessageId) return;
  relayMap.set(groupMessageId, { chatId, userId, username });
}

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

// Halaman "Katalog & Pricelist": deskripsi/foto pembuka (opsional, diatur
// admin lewat Panel Admin → Kelola Katalog & Pricelist) lalu PRICELIST
// LENGKAP semua kategori & produk beserta harga — TANPA tombol per-produk.
// Customer memilih produk yang mau dibeli lewat live chat langsung dengan
// admin (tombol Order Sekarang) setelah melihat pricelist ini.
async function showCatalogList(bot, chatId, messageId) {
  const { categories, catalogInfo } = db.get();
  const catsWithProducts = categories.filter((c) => c.products.length > 0);

  // Hapus pesan menu lama, kirim pesan baru (biar foto/tabel tampil rapi)
  await bot.deleteMessage(chatId, messageId).catch(() => {});

  const introText = (catalogInfo && catalogInfo.description) || "";
  if (catalogInfo && catalogInfo.photoFileId) {
    await bot.sendPhoto(chatId, catalogInfo.photoFileId, {
      caption: introText || "📋 Katalog & Pricelist",
      parse_mode: "Markdown",
    }).catch(() => {});
  } else if (introText) {
    await bot.sendMessage(chatId, introText, { parse_mode: "Markdown" }).catch(() => {});
  }

  if (catsWithProducts.length === 0) {
    return bot.sendMessage(chatId, "Katalog belum diisi admin. Coba lagi nanti ya 🙏", {
      reply_markup: kb.catalogListKeyboard(),
    });
  }

  return sendFullPricelist(bot, chatId, categories, kb.catalogListKeyboard());
}

// Dipanggil saat customer tap "Order Sekarang" di halaman katalog &
// pricelist. Tidak terikat ke satu produk — customer menyebutkan sendiri
// produk yang mau dipesan lewat live chat, admin yang menindaklanjuti.
async function orderFromCatalog(bot, chatId, messageId, user) {
  const { adminGroupId, storeName } = db.get();

  const text =
    "✅ *Kamu terhubung Live Chat dengan admin*\n\n" +
    "Silakan sebutkan produk yang ingin kamu pesan dari pricelist di atas, admin akan segera membalas.";
  await bot.sendMessage(chatId, text, {
    parse_mode: "Markdown",
    reply_markup: { inline_keyboard: [kb.backButton()] },
  });

  if (!adminGroupId) {
    await bot.sendMessage(chatId, "⚠️ Admin belum mengatur grup live chat. Silakan tunggu, kami akan segera menghubungi.");
    return;
  }

  const username = user.username ? "@" + user.username : user.first_name;
  const groupText =
    `🛒 *Live Chat — Mau Order (dari Katalog)*\n\n` +
    `Toko: ${storeName}\n` +
    `Dari: ${username} (id: ${user.id})\n\n` +
    `Pengguna ini sudah lihat pricelist dan mau pesan. Tanyakan produk mana yang mereka mau.\n\n` +
    `💬 _Balas (reply) pesan ini, atau tunggu pesan customer masuk lalu balas pesan tersebut._`;
  const sentToGroup = await bot.sendMessage(adminGroupId, groupText, { parse_mode: "Markdown" })
    .catch((e) => { console.warn("Gagal kirim notifikasi live chat order (katalog) ke grup admin:", e.message); return null; });
  if (sentToGroup) {
    rememberRelay(sentToGroup.message_id, chatId, user.id, username);
  }
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

// Dipanggil saat customer tap "Order Sekarang" dari halaman pricelist kategori.
// Kalau kategori hanya punya 1 produk, langsung ke konfirmasi.
// Kalau lebih dari 1, tampilkan pilihan produk sebagai tombol inline.
async function askOrderFromCategory(bot, chatId, messageId, catId) {
  const { categories } = db.get();
  const cat = categories.find((c) => c.id === catId);
  if (!cat || cat.products.length === 0) {
    return bot.sendMessage(chatId, "⚠️ Kategori ini belum memiliki produk. Silakan hubungi admin.", {
      reply_markup: { inline_keyboard: [kb.backButton("menu:catalog")] },
    });
  }

  if (cat.products.length === 1) {
    // Hanya 1 produk → langsung ke konfirmasi
    return askOrderConfirmation(bot, chatId, messageId, catId, cat.products[0].id);
  }

  // Lebih dari 1 produk → tampilkan pilihan produk
  const rows = cat.products.map((p) => [
    kb.btn(
      `${p.name} — ${db.formatRupiah(p.price)}`,
      { callback_data: `order:${catId}:${p.id}` },
      "success"
    ),
  ]);
  rows.push(kb.backButton(`cat:${catId}`));

  const text =
    `🛒 *Pilih Produk — ${cat.name}*\n\n` +
    `Tap produk yang ingin kamu pesan:`;

  await bot.sendMessage(chatId, text, {
    parse_mode: "Markdown",
    reply_markup: { inline_keyboard: rows },
  });
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
    // Status order: "awaiting_proof" -> menunggu customer kirim bukti transfer.
    // Tombol approve/reject admin BARU muncul setelah status jadi "proof_sent".
    status: "awaiting_proof",
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

  // Teruskan info pesanan baru ke grup admin (TANPA tombol approve/reject —
  // tombol itu baru dikirim setelah customer mengirim bukti transfer, lihat
  // receivePaymentProof()).
  if (adminGroupId) {
    const text =
      `🆕 *Pesanan Baru #${orderId}*\n\n` +
      `Toko: ${storeName}\n` +
      `Dari: ${orders.get(orderId).username} (id: ${user.id})\n` +
      `Produk: *${product.name}* (${cat.name})\n` +
      `Harga: *${db.formatRupiah(product.price)}*\n\n` +
      `⏳ Menunggu customer kirim bukti transfer. Tombol approve akan muncul otomatis setelah bukti diterima.\n\n` +
      `💬 _Balas (reply) pesan ini untuk chat langsung dengan customer._`;
    const sentToGroup = await bot.sendMessage(adminGroupId, text, { parse_mode: "Markdown" })
      .catch((e) => { console.warn("Gagal kirim ke grup admin:", e.message); return null; });
    if (sentToGroup) {
      rememberRelay(sentToGroup.message_id, chatId, user.id, orders.get(orderId).username);
    }
  } else {
    await bot.sendMessage(chatId, "⚠️ Admin belum mengatur grup live chat. Silakan hubungi admin manual dulu ya.");
  }
}

// Cari pesanan milik chat ini yang masih menunggu bukti transfer (ambil
// yang paling baru kalau ada lebih dari satu).
function findOrderAwaitingProof(chatId) {
  let found = null;
  for (const [orderId, order] of orders) {
    if (order.chatId === chatId && order.status === "awaiting_proof") {
      if (!found || orderId > found.orderId) found = { orderId, order };
    }
  }
  return found;
}

// Dipanggil saat customer mengirim foto ke bot. Kalau foto ini cocok
// dengan pesanan yang sedang menunggu bukti transfer, teruskan ke grup
// admin LENGKAP dengan tombol approve/reject, dan baru di titik inilah
// sistem approve muncul. Return true kalau foto berhasil diproses sebagai
// bukti transfer (supaya caller tahu tidak perlu diproses sebagai hal lain).
async function receivePaymentProof(bot, chatId, photoFileId, user) {
  const { adminGroupId, categories, storeName } = db.get();
  const found = findOrderAwaitingProof(chatId);
  if (!found) return false;

  const { orderId, order } = found;
  order.status = "proof_sent";

  const cat = categories.find((c) => c.id === order.catId);
  const product = cat && cat.products.find((p) => p.id === order.productId);

  await bot.sendMessage(chatId, `✅ Bukti transfer untuk Pesanan #${orderId} diterima. Admin akan segera memverifikasi.`);

  if (!adminGroupId) return true;

  const caption =
    `📸 *Bukti Transfer — Pesanan #${orderId}*\n\n` +
    `Toko: ${storeName}\n` +
    `Dari: ${order.username} (id: ${user.id})\n` +
    (product ? `Produk: *${product.name}* (${cat.name})\nHarga: *${db.formatRupiah(product.price)}*\n\n` : "\n") +
    `Silakan verifikasi lalu tekan tombol di bawah:`;

  await bot.sendPhoto(adminGroupId, photoFileId, {
    caption,
    parse_mode: "Markdown",
    reply_markup: kb.adminOrderActionsKeyboard(orderId),
  }).catch((e) => console.warn("Gagal kirim bukti transfer ke grup admin:", e.message));

  return true;
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
    `Pengguna ini telah menghubungi Anda melalui tombol *Hubungi Admin*.\n\n` +
    `💬 _Balas (reply) pesan ini, atau tunggu pesan customer masuk lalu balas pesan tersebut._`;
  const sentToGroup = await bot.sendMessage(adminGroupId, groupText, { parse_mode: "Markdown" })
    .catch((e) => { console.warn("Gagal kirim notifikasi live chat ke grup admin:", e.message); return null; });
  if (sentToGroup) {
    rememberRelay(sentToGroup.message_id, chatId, user.id, username);
  }
}

// ---------------------------------------------------------------------
// LIVE CHAT: pesan customer <-> admin
// ---------------------------------------------------------------------

// Dipanggil untuk setiap pesan pribadi dari customer (teks/foto/dst) yang
// bukan input sesi admin dan bukan bukti transfer. Meneruskan pesan asli
// (forward) ke grup admin, lalu menyimpan mapping supaya kalau admin
// me-reply pesan hasil forward itu di grup, balasannya bisa dikirim balik
// ke customer yang bersangkutan.
async function forwardCustomerMessageToAdmin(bot, msg, user) {
  const { adminGroupId } = db.get();
  if (!adminGroupId) return false;

  const username = user.username ? "@" + user.username : (user.first_name || "Customer");

  try {
    // PENTING: pakai copyMessage, BUKAN forwardMessage. forwardMessage
    // menyertakan atribut "Forwarded from <akun customer>", dan Telegram
    // mengizinkan pengguna mengaktifkan setelan privasi yang MEMBLOKIR bot
    // meneruskan pesan mereka lewat forwardMessage — request-nya gagal
    // (biasanya error "MESSAGE_ID_INVALID"/"have no rights") tanpa terlihat
    // oleh customer maupun admin, sehingga chat customer seolah tidak
    // pernah sampai ke admin. copyMessage menyalin ISI pesan (teks, foto,
    // dokumen, dll) tanpa label "Forwarded from" sama sekali, jadi tidak
    // kena batasan privasi ini — persis cara kerja bot livegram di
    // Telegram, dan sekaligus tidak membocorkan akun Telegram customer ke
    // grup admin.
    const copied = await bot.copyMessage(adminGroupId, msg.chat.id, msg.message_id);
    const groupMessageId = copied.message_id;
    rememberRelay(groupMessageId, msg.chat.id, user.id, username);

    // Kirim juga pesan info kecil supaya kalau admin scroll ke atas, jelas
    // pesan ini dari siapa. Info dilekatkan sebagai reply ke pesan yang
    // disalin biar rapi, dan reply admin ke pesan info ini pun tetap
    // ke-detect balik ke customer yang sama.
    const infoMsg = await bot.sendMessage(
      adminGroupId,
      `💬 Pesan di atas dari *${username}* (id: ${user.id}).\n_Balas (reply) pesan ini atau pesan di atas untuk membalas customer._`,
      { parse_mode: "Markdown", reply_to_message_id: groupMessageId }
    ).catch(() => null);
    if (infoMsg) rememberRelay(infoMsg.message_id, msg.chat.id, user.id, username);

    return true;
  } catch (e) {
    console.warn("Gagal meneruskan pesan customer ke grup admin:", e.message);
    // Fallback terakhir: kalau copyMessage tetap gagal (mis. tipe pesan
    // yang memang tidak didukung Telegram untuk disalin) tapi isinya teks,
    // tetap kirim sebagai teks biasa supaya pesan customer tidak hilang.
    if (msg.text) {
      const fallback = await bot.sendMessage(
        adminGroupId,
        `💬 *${username}* (id: ${user.id}):\n${msg.text}`,
        { parse_mode: "Markdown" }
      ).catch(() => null);
      if (fallback) {
        rememberRelay(fallback.message_id, msg.chat.id, user.id, username);
        return true;
      }
    }
    return false;
  }
}

// Dipanggil untuk setiap pesan yang masuk di grup admin. Kalau pesan itu
// me-reply salah satu pesan yang tercatat di relayMap (baik hasil forward
// pesan customer, notifikasi order baru, maupun notifikasi live chat baru),
// teruskan isi balasan admin itu ke chat pribadi customer terkait.
// Return true kalau berhasil diteruskan sebagai balasan live chat.
async function relayAdminReplyToCustomer(bot, msg) {
  const { adminGroupId } = db.get();
  if (!adminGroupId) return false;
  if (String(msg.chat.id) !== String(adminGroupId)) return false; // grup lain, abaikan
  if (!msg.reply_to_message) return false;

  const info = relayMap.get(msg.reply_to_message.message_id);
  if (!info) return false;

  try {
    // copyMessage bisa meneruskan teks, foto, dokumen, stiker, dll apa adanya.
    await bot.copyMessage(info.chatId, msg.chat.id, msg.message_id);
  } catch (e) {
    console.warn("Gagal kirim balasan admin ke customer:", e.message);
    // Fallback: kalau copyMessage gagal (mis. tipe pesan tak didukung) tapi
    // ada teks, coba kirim sebagai teks biasa saja.
    if (msg.text) {
      await bot.sendMessage(info.chatId, msg.text).catch(() => {});
    } else {
      return false;
    }
  }

  // Supaya customer bisa membalas lagi dan tetap nyambung ke admin yang
  // sama, catat juga pesan balasan admin ini sebagai titik relay.
  rememberRelay(msg.message_id, info.chatId, info.userId, info.username);
  return true;
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
  // Cukup tampilkan nama-nama metode pembayaran yang tersedia (tanpa
  // tombol per-metode). Detail cara bayar/gambar tetap muncul otomatis
  // saat customer sudah order dan memilih metode pembayarannya.
  const list = paymentMethods.map((m) => `• ${m.name}`).join("\n");
  const text = `💳 *Metode Pembayaran Tersedia*\n\n${list}`;
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
  showCatalogList,
  orderFromCatalog,
  showCatalogCategories,
  showCategoryPricelist,
  askOrderFromCategory,
  askOrderConfirmation,
  confirmOrder,
  sendPaymentInfo,
  showPaymentMethodInfo,
  contactAdmin,
  showPaymentMethods,
  receivePaymentProof,
  forwardCustomerMessageToAdmin,
  relayAdminReplyToCustomer,
  orders,
};
