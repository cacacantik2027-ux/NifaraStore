// bot.js — entry point Nifara Store Bot.
require("dotenv").config();
const TelegramBot = require("node-telegram-bot-api");
const db = require("./db");
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
  await bot.sendMessage(msg.chat.id, `✅ User ${newId} sekarang menjadi admin.`);
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
    // ---- Menu customer ----
    if (data === "menu:main") return cust.showMainMenu(bot, chatId, messageId);
    if (data === "menu:catalog") return cust.showCatalogCategories(bot, chatId, messageId);
    if (data === "menu:order") return cust.showCatalogCategories(bot, chatId, messageId);
    if (data === "menu:contact") return cust.showContactAdmin(bot, chatId, messageId);
    if (data === "menu:payment") return cust.showPaymentMethods(bot, chatId, messageId);

    if (data.startsWith("cat:")) {
      const catId = data.split(":")[1];
      return cust.showCategoryPricelist(bot, chatId, messageId, catId);
    }
    if (data.startsWith("order:")) {
      const [, catId, prodId] = data.split(":");
      return cust.askOrderConfirmation(bot, chatId, messageId, catId, prodId);
    }
    if (data.startsWith("confirm:")) {
      const [, catId, prodId] = data.split(":");
      return cust.confirmOrder(bot, chatId, messageId, catId, prodId, q.from);
    }
    if (data.startsWith("adminorder:")) {
      if (!db.isAdmin(userId)) return;
      const [, action, orderId] = data.split(":");
      const label = action === "accept" ? "✅ diterima" : "❌ ditolak";
      return bot.editMessageText(q.message.text + `\n\n— Pesanan ${label} oleh admin.`, {
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
      if (action === "categories") return adm.showCategoriesAdmin(bot, chatId, messageId);
      if (action === "cat") return adm.showCategoryDetailAdmin(bot, chatId, messageId, parts[2]);
      if (action === "cat_add") return adm.askNewCategoryName(bot, chatId, userId, messageId);
      if (action === "cat_del") { adm.deleteCategory(parts[2]); return adm.showCategoriesAdmin(bot, chatId, messageId); }
      if (action === "prod_add") return adm.askNewProduct(bot, chatId, userId, messageId, parts[2]);
      if (action === "prod") return adm.showProductDetailAdmin(bot, chatId, messageId, parts[2], parts[3]);
      if (action === "prod_price") return adm.askNewPrice(bot, chatId, userId, messageId, parts[2], parts[3]);
      if (action === "prod_del") { adm.deleteProduct(parts[2], parts[3]); return adm.showCategoryDetailAdmin(bot, chatId, messageId, parts[2]); }
      if (action === "payment") return adm.showPaymentAdmin(bot, chatId, messageId);
      if (action === "qris_img") return adm.askQrisImage(bot, chatId, userId, messageId);
      if (action === "qris_note") return adm.askQrisNote(bot, chatId, userId, messageId);
      if (action === "bank") return adm.askBankInfo(bot, chatId, userId, messageId);
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
  const session = adm.getSession(userId);
  if (!session) return; // bukan input admin, abaikan (mis. bukti transfer, chat biasa, dll)
  if (!db.isAdmin(userId)) return;

  const chatId = msg.chat.id;

  if (session.step === "await_welcome_text" && msg.text) {
    db.update((s) => (s.welcome.text = msg.text));
    adm.clearSession(userId);
    return bot.sendMessage(chatId, "✅ Pesan sambutan berhasil diperbarui.");
  }

  if (session.step === "await_new_category" && msg.text) {
    adm.addCategory(msg.text.trim());
    adm.clearSession(userId);
    return bot.sendMessage(chatId, `✅ Kategori "${msg.text.trim()}" ditambahkan.`);
  }

  if (session.step === "await_new_product" && msg.text) {
    const parts = msg.text.split("|").map((s) => s.trim());
    const [name, price, note] = parts;
    if (!name || !price || isNaN(Number(price))) {
      return bot.sendMessage(chatId, "Format salah. Contoh: `Private 1 Bulan | 55000 | Full akses`", { parse_mode: "Markdown" });
    }
    adm.addProduct(session.catId, name, price, note);
    adm.clearSession(userId);
    return bot.sendMessage(chatId, `✅ Produk "${name}" ditambahkan.`);
  }

  if (session.step === "await_new_price" && msg.text) {
    if (isNaN(Number(msg.text.trim()))) {
      return bot.sendMessage(chatId, "Harga harus berupa angka. Contoh: `30000`", { parse_mode: "Markdown" });
    }
    adm.updatePrice(session.catId, session.prodId, msg.text.trim());
    adm.clearSession(userId);
    return bot.sendMessage(chatId, "✅ Harga berhasil diperbarui.");
  }

  if (session.step === "await_qris_image" && msg.photo) {
    const fileId = msg.photo[msg.photo.length - 1].file_id;
    db.update((s) => (s.payment.qrisFileId = fileId));
    adm.clearSession(userId);
    return bot.sendMessage(chatId, "✅ Gambar QRIS berhasil disimpan.");
  }

  if (session.step === "await_qris_note" && msg.text) {
    db.update((s) => (s.payment.qrisNote = msg.text));
    adm.clearSession(userId);
    return bot.sendMessage(chatId, "✅ Catatan QRIS berhasil diperbarui.");
  }

  if (session.step === "await_bank_info" && msg.text) {
    db.update((s) => (s.payment.bankTransfer = msg.text));
    adm.clearSession(userId);
    return bot.sendMessage(chatId, "✅ Info transfer bank berhasil diperbarui.");
  }
});

bot.on("polling_error", (err) => console.error("polling_error:", err.message));
