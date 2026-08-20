// bot.js — entry point Nifara Store Bot.
require("dotenv").config();
const TelegramBot = require("node-telegram-bot-api");
const db = require("./db");
const kb = require("./keyboards");
const cust = require("./customer");
const adm = require("./admin");

const TOKEN = process.env.BOT_TOKEN;
if (!TOKEN) {
  console.error("❌ BOT_TOKEN belum diisi di file .env");
  process.exit(1);
}

// Seed owner dari .env kalau settings.json masih kosong (setup pertama kali)
const envOwners = (process.env.OWNER_IDS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
if (envOwners.length) {
  db.update((s) => {
    envOwners.forEach((id) => {
      if (!s.ownerIds.includes(id)) s.ownerIds.push(id);
    });
  });
}

const bot = new TelegramBot(TOKEN, { polling: true });
console.log("🤖 Nifara Store Bot berjalan...");

// Jaring pengaman: jangan sampai satu error tak tertangani (mis. Telegram
// menolak sebuah request API) mematikan seluruh proses bot dan memicu
// crash-loop di Railway. Cukup log saja, bot tetap jalan.
process.on("unhandledRejection", (err) => {
  console.error("unhandledRejection:", err && err.message ? err.message : err);
});
process.on("uncaughtException", (err) => {
  console.error("uncaughtException:", err && err.message ? err.message : err);
});

// ---------------------------------------------------------------------
// COMMANDS
// ---------------------------------------------------------------------

bot.onText(/^\/start$/, async (msg) => {
  await cust.sendWelcome(bot, msg.chat.id, msg.from);
});

bot.onText(/^\/admin$/, async (msg) => {
  const userId = msg.from.id;
  if (!db.isAdmin(userId)) {
    return bot.sendMessage(msg.chat.id, "⛔️ Kamu tidak punya akses admin.");
  }
  await adm.openAdminPanel(bot, msg.chat.id, null);
});

bot.onText(/^\/batal$/, async (msg) => {
  adm.clearSession(msg.from.id);
  await bot.sendMessage(msg.chat.id, "Dibatalkan.");
});

// Dipakai admin di DALAM grup untuk menyimpan grup itu sebagai live chat admin
bot.onText(/^\/setgroup$/, async (msg) => {
  if (msg.chat.type === "private") {
    return bot.sendMessage(msg.chat.id, "Perintah ini harus dijalankan di dalam grup admin, bukan chat pribadi.");
  }
  if (!db.isAdmin(msg.from.id)) {
    return bot.sendMessage(msg.chat.id, "⛔️ Hanya admin/owner yang boleh mengatur ini.");
  }
  adm.setAdminGroup(msg.chat.id);
  await bot.sendMessage(msg.chat.id, `✅ Grup ini sekarang jadi grup live chat admin (ID: ${msg.chat.id}).`);
});

bot.onText(/^\/addadmin (\d+)$/, async (msg, match) => {
  if (!db.isOwner(msg.from.id)) {
    return bot.sendMessage(msg.chat.id, "⛔️ Hanya owner yang boleh menambah admin.");
  }
  const newId = match[1];
  db.update((s) => {
    if (!s.adminIds.includes(newId)) s.adminIds.push(newId);
  });
  await bot.sendMessage(msg.chat.id, `✅ User ${newId} sekarang menjadi admin.`, {
    reply_markup: { inline_keyboard: [kb.backButton("admin:admins")] },
  });
});

// ---------------------------------------------------------------------
// CALLBACK QUERY ROUTER (semua tombol inline)
// ---------------------------------------------------------------------

bot.on("callback_query", async (q) => {
  const chatId = q.message.chat.id;
  const messageId = q.message.message_id;
  const userId = q.from.id;
  const data = q.data;
  bot.answerCallbackQuery(q.id).catch(() => {});

  try {
    // Tombol judul kategori (kalau ada elemen non-aktif lain di masa depan)
    if (data === "noop") return;

    // ---- Menu customer ----
    if (data === "menu:main") return cust.showMainMenu(bot, chatId, messageId);
    if (data === "menu:catalog") return cust.showCatalogList(bot, chatId, messageId);
    if (data === "menu:catalogorder") return cust.orderFromCatalog(bot, chatId, messageId, q.from);
    if (data === "menu:order") return cust.showCatalogCategories(bot, chatId, messageId);
    if (data === "menu:contact") return cust.contactAdmin(bot, chatId, messageId, q.from);
    if (data === "menu:payment") return cust.showPaymentMethods(bot, chatId, messageId);

    if (data.startsWith("cat:")) {
      const catId = data.split(":")[1];
      return cust.showCategoryPricelist(bot, chatId, messageId, catId);
    }
    if (data.startsWith("ordercat:")) {
      const catId = data.split(":")[1];
      return cust.askOrderFromCategory(bot, chatId, messageId, catId);
    }
    if (data.startsWith("order:")) {
      const [, catId, prodId] = data.split(":");
      return cust.askOrderConfirmation(bot, chatId, messageId, catId, prodId);
    }
    if (data.startsWith("confirm:")) {
      const [, catId, prodId] = data.split(":");
      return cust.confirmOrder(bot, chatId, messageId, catId, prodId, q.from);
    }
    if (data.startsWith("pay:")) {
      const [, orderId, pmId] = data.split(":");
      return cust.sendPaymentInfo(bot, chatId, orderId, pmId);
    }
    if (data.startsWith("paymethodinfo:")) {
      const pmId = data.split(":")[1];
      return cust.showPaymentMethodInfo(bot, chatId, messageId, pmId);
    }
    if (data.startsWith("adminorder:")) {
      if (!db.isAdmin(userId)) return;
      const [, action, orderIdStr] = data.split(":");
      const orderId = Number(orderIdStr);
      const label = action === "accept" ? "✅ diterima" : "❌ ditolak";

      const order = cust.orders.get(orderId);
      if (order) {
        order.status = action === "accept" ? "accepted" : "rejected";
        const customerText = action === "accept"
          ? `✅ Pembayaran untuk Pesanan #${orderId} sudah diverifikasi admin. Pesananmu sedang diproses ya!`
          : `❌ Bukti transfer untuk Pesanan #${orderId} belum bisa diverifikasi. Silakan hubungi admin untuk info lebih lanjut.`;
        bot.sendMessage(order.chatId, customerText).catch(() => {});
      }

      // Edit caption kalau ini pesan foto (bukti transfer), atau teks biasa kalau bukan.
      const newCaption = (q.message.caption || q.message.text || "") + `\n\n— Pesanan ${label} oleh admin.`;
      if (q.message.photo) {
        return bot.editMessageCaption(newCaption, {
          chat_id: chatId, message_id: messageId, parse_mode: "Markdown",
        }).catch(() => {});
      }
      return bot.editMessageText(newCaption, {
        chat_id: chatId, message_id: messageId,
      }).catch(() => {});
    }

    // ---- Panel admin (proteksi akses di setiap cabang) ----
    if (data.startsWith("admin:")) {
      if (!db.isAdmin(userId)) return;
      const parts = data.split(":");
      const action = parts[1];

      if (action === "main") return adm.openAdminPanel(bot, chatId, messageId);
      if (action === "welcome") return adm.askWelcomeText(bot, chatId, userId, messageId);
      if (action === "catalog") return adm.showCatalogInfoAdmin(bot, chatId, messageId);
      if (action === "catalog_label") return adm.askCatalogLabel(bot, chatId, userId, messageId);
      if (action === "catalog_desc") return adm.askCatalogDescription(bot, chatId, userId, messageId);
      if (action === "catalog_img") return adm.askCatalogPhoto(bot, chatId, userId, messageId);
      if (action === "catalog_imgdel") { adm.deleteCatalogPhoto(); return adm.showCatalogInfoAdmin(bot, chatId, messageId); }
      if (action === "categories") return adm.showCategoriesAdmin(bot, chatId, messageId);
      if (action === "cat") return adm.showCategoryDetailAdmin(bot, chatId, messageId, parts[2]);
      if (action === "cat_add") return adm.askNewCategoryName(bot, chatId, userId, messageId);
      if (action === "cat_del") { adm.deleteCategory(parts[2]); return adm.showCategoriesAdmin(bot, chatId, messageId); }
      if (action === "prod_add") return adm.askNewProduct(bot, chatId, userId, messageId, parts[2]);
      if (action === "prod") return adm.showProductDetailAdmin(bot, chatId, messageId, parts[2], parts[3]);
      if (action === "prod_price") return adm.askNewPrice(bot, chatId, userId, messageId, parts[2], parts[3]);
      if (action === "prod_del") { adm.deleteProduct(parts[2], parts[3]); return adm.showCategoryDetailAdmin(bot, chatId, messageId, parts[2]); }
      if (action === "payment") return adm.showPaymentAdmin(bot, chatId, messageId);
      if (action === "pay_add") return adm.askNewPaymentMethodName(bot, chatId, userId, messageId);
      if (action === "pay") return adm.showPaymentMethodDetailAdmin(bot, chatId, messageId, parts[2]);
      if (action === "pay_name") return adm.askPaymentName(bot, chatId, userId, messageId, parts[2]);
      if (action === "pay_note") return adm.askPaymentNote(bot, chatId, userId, messageId, parts[2]);
      if (action === "pay_img") return adm.askPaymentImage(bot, chatId, userId, messageId, parts[2]);
      if (action === "pay_imgdel") { adm.deletePaymentImage(parts[2]); return adm.showPaymentMethodDetailAdmin(bot, chatId, messageId, parts[2]); }
      if (action === "pay_del") { adm.deletePaymentMethod(parts[2]); return adm.showPaymentAdmin(bot, chatId, messageId); }
      if (action === "group") return adm.askAdminGroup(bot, chatId, userId, messageId);
      if (action === "admins") return adm.showAdminsAdmin(bot, chatId, messageId);
      if (action === "features") return adm.showFeaturesAdmin(bot, chatId, messageId);
      if (action === "toggle_style") { adm.toggleFeature("useButtonStyle"); return adm.showFeaturesAdmin(bot, chatId, messageId); }
      if (action === "toggle_richtable") { adm.toggleFeature("useRichTable"); return adm.showFeaturesAdmin(bot, chatId, messageId); }
    }
  } catch (err) {
    console.error("callback_query error:", err);
  }
});

// ---------------------------------------------------------------------
// TEXT / PHOTO INPUT — dipakai untuk melanjutkan sesi admin (mis. "kirim harga baru")
// ---------------------------------------------------------------------

bot.on("message", async (msg) => {
  if (msg.text && msg.text.startsWith("/")) return; // command sudah ditangani onText
  const userId = msg.from.id;
  const chatId = msg.chat.id;

  // ---- Pesan datang dari GRUP (bukan chat pribadi) ----
  // Ini termasuk grup live chat admin. Kalau pesan ini adalah balasan
  // (reply) admin ke pesan yang berasal dari customer, teruskan ke
  // customer terkait. Pesan grup tidak diproses sebagai sesi admin/bukti
  // transfer, jadi berhenti di sini.
  if (msg.chat.type !== "private") {
    await cust.relayAdminReplyToCustomer(bot, msg).catch((e) => {
      console.error("relayAdminReplyToCustomer error:", e);
    });
    return;
  }

  const session = adm.getSession(userId);

  // Kalau ini foto dan bukan sedang dalam sesi input admin (mis. admin lagi
  // upload gambar metode pembayaran), coba proses sebagai bukti transfer
  // customer. Di sinilah tombol approve/reject baru dikirim ke grup admin.
  if (!session && msg.photo) {
    const fileId = msg.photo[msg.photo.length - 1].file_id;
    const handled = await cust.receivePaymentProof(bot, chatId, fileId, msg.from).catch((e) => {
      console.error("receivePaymentProof error:", e);
      return false;
    });
    if (handled) return;
  }

  if (!session) {
    // Bukan input admin dan bukan bukti transfer -> anggap ini pesan live
    // chat dari customer (teks, foto, dokumen, dll) dan teruskan ke grup
    // admin. Kalau si pengirim kebetulan admin/owner yang sedang tidak
    // dalam sesi apa pun, jangan diteruskan supaya tidak muncul sebagai
    // "pesan customer" di grup.
    if (!db.isAdmin(userId)) {
      await cust.forwardCustomerMessageToAdmin(bot, msg, msg.from).catch((e) => {
        console.error("forwardCustomerMessageToAdmin error:", e);
      });
    }
    return;
  }
  if (!db.isAdmin(userId)) return;

  if (session.step === "await_welcome_text" && msg.text) {
    db.update((s) => (s.welcome.text = msg.text));
    adm.clearSession(userId);
    return bot.sendMessage(chatId, "✅ Pesan sambutan berhasil diperbarui.", {
      reply_markup: { inline_keyboard: [kb.backButton("admin:main")] },
    });
  }

  if (session.step === "await_catalog_label" && msg.text) {
    adm.updateCatalogLabel(msg.text.trim());
    adm.clearSession(userId);
    return bot.sendMessage(chatId, "✅ Nama tombol katalog berhasil diperbarui.", {
      reply_markup: { inline_keyboard: [kb.backButton("admin:catalog")] },
    });
  }

  if (session.step === "await_catalog_description" && msg.text) {
    adm.updateCatalogDescription(msg.text);
    adm.clearSession(userId);
    return bot.sendMessage(chatId, "✅ Deskripsi katalog berhasil diperbarui.", {
      reply_markup: { inline_keyboard: [kb.backButton("admin:catalog")] },
    });
  }

  if (session.step === "await_catalog_photo" && msg.photo) {
    const fileId = msg.photo[msg.photo.length - 1].file_id;
    adm.setCatalogPhoto(fileId);
    adm.clearSession(userId);
    return bot.sendMessage(chatId, "✅ Foto katalog berhasil disimpan.", {
      reply_markup: { inline_keyboard: [kb.backButton("admin:catalog")] },
    });
  }

  if (session.step === "await_new_category" && msg.text) {
    adm.addCategory(msg.text.trim());
    adm.clearSession(userId);
    return bot.sendMessage(chatId, `✅ Kategori "${msg.text.trim()}" ditambahkan.`, {
      reply_markup: { inline_keyboard: [kb.backButton("admin:categories")] },
    });
  }

  if (session.step === "await_new_product" && msg.text) {
    const parts = msg.text.split("|").map((s) => s.trim());
    const [name, price, note] = parts;
    if (!name || !price || isNaN(Number(price))) {
      return bot.sendMessage(chatId, "Format salah. Contoh: `Private 1 Bulan | 55000 | Full akses`", { parse_mode: "Markdown" });
    }
    const catId = session.catId;
    adm.addProduct(catId, name, price, note);
    adm.clearSession(userId);
    return bot.sendMessage(chatId, `✅ Produk "${name}" ditambahkan.`, {
      reply_markup: { inline_keyboard: [kb.backButton(`admin:cat:${catId}`)] },
    });
  }

  if (session.step === "await_new_price" && msg.text) {
    if (isNaN(Number(msg.text.trim()))) {
      return bot.sendMessage(chatId, "Harga harus berupa angka. Contoh: `30000`", { parse_mode: "Markdown" });
    }
    const { catId, prodId } = session;
    adm.updatePrice(catId, prodId, msg.text.trim());
    adm.clearSession(userId);
    return bot.sendMessage(chatId, "✅ Harga berhasil diperbarui.", {
      reply_markup: { inline_keyboard: [kb.backButton(`admin:prod:${catId}:${prodId}`)] },
    });
  }

  if (session.step === "await_new_payment_name" && msg.text) {
    adm.addPaymentMethod(msg.text.trim());
    adm.clearSession(userId);
    return bot.sendMessage(chatId, `✅ Metode pembayaran "${msg.text.trim()}" ditambahkan. Buka lagi untuk atur catatan/gambar.`, {
      reply_markup: { inline_keyboard: [kb.backButton("admin:payment")] },
    });
  }

  if (session.step === "await_payment_name" && msg.text) {
    const { pmId } = session;
    adm.updatePaymentName(pmId, msg.text.trim());
    adm.clearSession(userId);
    return bot.sendMessage(chatId, "✅ Nama metode pembayaran berhasil diperbarui.", {
      reply_markup: { inline_keyboard: [kb.backButton(`admin:pay:${pmId}`)] },
    });
  }

  if (session.step === "await_payment_note" && msg.text) {
    const { pmId } = session;
    adm.updatePaymentNote(pmId, msg.text);
    adm.clearSession(userId);
    return bot.sendMessage(chatId, "✅ Catatan/instruksi pembayaran berhasil diperbarui.", {
      reply_markup: { inline_keyboard: [kb.backButton(`admin:pay:${pmId}`)] },
    });
  }

  if (session.step === "await_payment_image" && msg.photo) {
    const { pmId } = session;
    const fileId = msg.photo[msg.photo.length - 1].file_id;
    adm.setPaymentImage(pmId, fileId);
    adm.clearSession(userId);
    return bot.sendMessage(chatId, "✅ Gambar metode pembayaran berhasil disimpan.", {
      reply_markup: { inline_keyboard: [kb.backButton(`admin:pay:${pmId}`)] },
    });
  }
});

bot.on("polling_error", (err) => console.error("polling_error:", err.message));
