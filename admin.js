// admin.js — panel pengaturan untuk admin & owner.
// Semua konten bot (sambutan, katalog, harga, QRIS, grup live chat)
// diatur dari sini, tanpa perlu ubah kode.

const db = require("./db");
const kb = require("./keyboards");

// Session sederhana in-memory: menyimpan "bot sedang menunggu input apa"
// dari user tertentu. Contoh: { step: "await_welcome_text" }
const sessions = new Map();

function setSession(userId, data) {
  sessions.set(userId, data);
}
function getSession(userId) {
  return sessions.get(userId);
}
function clearSession(userId) {
  sessions.delete(userId);
}

async function openAdminPanel(bot, chatId, messageId) {
  const text = "⚙️ *Panel Admin — Nifara Store*\n\nPilih pengaturan yang ingin diubah:";
  const opts = { chat_id: chatId, message_id: messageId, parse_mode: "Markdown", reply_markup: kb.adminMainKeyboard() };
  if (messageId) {
    await bot.editMessageText(text, opts).catch(() => bot.sendMessage(chatId, text, { parse_mode: "Markdown", reply_markup: kb.adminMainKeyboard() }));
  } else {
    await bot.sendMessage(chatId, text, { parse_mode: "Markdown", reply_markup: kb.adminMainKeyboard() });
  }
}

// ---------- WELCOME ----------
async function askWelcomeText(bot, chatId, userId, messageId) {
  setSession(userId, { step: "await_welcome_text" });
  await bot.editMessageText(
    "✏️ Kirim teks sambutan baru.\nBisa pakai *Markdown* dan placeholder `{name}` (nama customer).\n\nKetik /batal untuk membatalkan.",
    { chat_id: chatId, message_id: messageId, parse_mode: "Markdown" }
  ).catch(() => {});
}

// ---------- KATALOG & PRICELIST (nama tombol, deskripsi, foto) ----------
async function showCatalogInfoAdmin(bot, chatId, messageId) {
  const { catalogInfo } = db.get();
  const text =
    `📋 *Kelola Katalog & Pricelist*\n\n` +
    `Nama tombol: ${catalogInfo.buttonLabel}\n` +
    `Foto: ${catalogInfo.photoFileId ? "✅ sudah diatur" : "❌ belum ada (opsional)"}\n\n` +
    `Deskripsi:\n${catalogInfo.description || "-"}`;
  await bot.editMessageText(text, {
    chat_id: chatId, message_id: messageId, parse_mode: "Markdown",
    reply_markup: kb.adminCatalogInfoKeyboard(!!catalogInfo.photoFileId),
  }).catch(() => {});
}

async function askCatalogLabel(bot, chatId, userId, messageId) {
  setSession(userId, { step: "await_catalog_label" });
  await bot.editMessageText(
    "✏️ Kirim nama baru untuk tombol katalog (contoh: `📋 Katalog & Pricelist`).\n\nKetik /batal untuk membatalkan.",
    { chat_id: chatId, message_id: messageId, parse_mode: "Markdown" }
  ).catch(() => {});
}

function updateCatalogLabel(label) {
  db.update((s) => (s.catalogInfo.buttonLabel = label));
}

async function askCatalogDescription(bot, chatId, userId, messageId) {
  setSession(userId, { step: "await_catalog_description" });
  await bot.editMessageText(
    "📝 Kirim deskripsi baru untuk halaman katalog & pricelist. Bisa pakai *Markdown*.\n\nKetik /batal untuk membatalkan.",
    { chat_id: chatId, message_id: messageId, parse_mode: "Markdown" }
  ).catch(() => {});
}

function updateCatalogDescription(text) {
  db.update((s) => (s.catalogInfo.description = text));
}

async function askCatalogPhoto(bot, chatId, userId, messageId) {
  setSession(userId, { step: "await_catalog_photo" });
  await bot.editMessageText(
    "🖼 Kirim foto untuk halaman katalog & pricelist sekarang (mis. foto pricelist atau produk).\n\nKetik /batal untuk membatalkan.",
    { chat_id: chatId, message_id: messageId }
  ).catch(() => {});
}

function setCatalogPhoto(fileId) {
  db.update((s) => (s.catalogInfo.photoFileId = fileId));
}

function deleteCatalogPhoto() {
  db.update((s) => (s.catalogInfo.photoFileId = null));
}

// ---------- CATEGORIES / PRODUCTS ----------
async function showCategoriesAdmin(bot, chatId, messageId) {
  const { categories } = db.get();
  const rows = categories.map((c) => [
    kb.btn(`${c.name} (${c.products.length})`, { callback_data: `admin:cat:${c.id}` }),
  ]);
  rows.push([kb.btn("➕ Tambah Kategori", { callback_data: "admin:cat_add" }, "success")]);
  rows.push(kb.backButton("admin:main"));
  await bot.editMessageText("🗂 *Kelola Kategori*\n\nPilih kategori atau tambah baru:", {
    chat_id: chatId, message_id: messageId, parse_mode: "Markdown",
    reply_markup: { inline_keyboard: rows },
  }).catch(() => {});
}

async function showCategoryDetailAdmin(bot, chatId, messageId, catId) {
  const { categories } = db.get();
  const cat = categories.find((c) => c.id === catId);
  if (!cat) return;
  const rows = cat.products.map((p) => [
    kb.btn(`${p.name} — ${db.formatRupiah(p.price)}`, { callback_data: `admin:prod:${catId}:${p.id}` }),
  ]);
  rows.push([kb.btn("➕ Tambah Produk", { callback_data: `admin:prod_add:${catId}` }, "success")]);
  rows.push([kb.btn("🗑 Hapus Kategori Ini", { callback_data: `admin:cat_del:${catId}` }, "danger")]);
  rows.push(kb.backButton("admin:categories"));
  await bot.editMessageText(`🗂 *${cat.name}*\n\nProduk di kategori ini:`, {
    chat_id: chatId, message_id: messageId, parse_mode: "Markdown",
    reply_markup: { inline_keyboard: rows },
  }).catch(() => {});
}

async function askNewCategoryName(bot, chatId, userId, messageId) {
  setSession(userId, { step: "await_new_category" });
  await bot.editMessageText("➕ Kirim nama kategori baru (contoh: `Netflix Premium`).\n\nKetik /batal untuk membatalkan.", {
    chat_id: chatId, message_id: messageId, parse_mode: "Markdown",
  }).catch(() => {});
}

async function askNewProduct(bot, chatId, userId, messageId, catId) {
  setSession(userId, { step: "await_new_product", catId });
  await bot.editMessageText(
    "➕ Kirim detail produk baru dengan format:\n`Nama Produk | Harga | Catatan(opsional)`\n\nContoh:\n`Private 1 Bulan | 55000 | Full akses`\n\nKetik /batal untuk membatalkan.",
    { chat_id: chatId, message_id: messageId, parse_mode: "Markdown" }
  ).catch(() => {});
}

function deleteCategory(catId) {
  db.update((s) => {
    s.categories = s.categories.filter((c) => c.id !== catId);
  });
}

function addCategory(name) {
  const id = "cat_" + Date.now();
  db.update((s) => s.categories.push({ id, name, products: [] }));
  return id;
}

function addProduct(catId, name, price, note) {
  db.update((s) => {
    const cat = s.categories.find((c) => c.id === catId);
    if (cat) cat.products.push({ id: "p_" + Date.now(), name, price: Number(price), note: note || "" });
  });
}

async function showProductDetailAdmin(bot, chatId, messageId, catId, prodId) {
  const { categories } = db.get();
  const cat = categories.find((c) => c.id === catId);
  const prod = cat && cat.products.find((p) => p.id === prodId);
  if (!prod) return;
  const text = `📦 *${prod.name}*\nHarga: ${db.formatRupiah(prod.price)}\nCatatan: ${prod.note || "-"}`;
  const rows = [
    [kb.btn("💰 Ubah Harga", { callback_data: `admin:prod_price:${catId}:${prodId}` })],
    [kb.btn("🗑 Hapus Produk", { callback_data: `admin:prod_del:${catId}:${prodId}` }, "danger")],
    kb.backButton(`admin:cat:${catId}`),
  ];
  await bot.editMessageText(text, { chat_id: chatId, message_id: messageId, parse_mode: "Markdown", reply_markup: { inline_keyboard: rows } }).catch(() => {});
}

function deleteProduct(catId, prodId) {
  db.update((s) => {
    const cat = s.categories.find((c) => c.id === catId);
    if (cat) cat.products = cat.products.filter((p) => p.id !== prodId);
  });
}

async function askNewPrice(bot, chatId, userId, messageId, catId, prodId) {
  setSession(userId, { step: "await_new_price", catId, prodId });
  await bot.editMessageText("💰 Kirim harga baru (angka saja, contoh: `30000`).\n\nKetik /batal untuk membatalkan.", {
    chat_id: chatId, message_id: messageId, parse_mode: "Markdown",
  }).catch(() => {});
}

function updatePrice(catId, prodId, price) {
  db.update((s) => {
    const cat = s.categories.find((c) => c.id === catId);
    const prod = cat && cat.products.find((p) => p.id === prodId);
    if (prod) prod.price = Number(price);
  });
}

// ---------- PAYMENT METHODS ----------
async function showPaymentAdmin(bot, chatId, messageId) {
  await bot.editMessageText(
    "💳 *Metode Pembayaran*\n\nCustomer akan memilih salah satu metode ini saat checkout (QRIS 1, QRIS 2, Bank, Dana, dll — bebas berapa banyak). Kelola daftarnya di sini:",
    { chat_id: chatId, message_id: messageId, parse_mode: "Markdown", reply_markup: kb.adminPaymentListKeyboard() }
  ).catch(() => {});
}

async function askNewPaymentMethodName(bot, chatId, userId, messageId) {
  setSession(userId, { step: "await_new_payment_name" });
  await bot.editMessageText(
    "➕ Kirim nama metode pembayaran baru (contoh: `QRIS 1`, `QRIS 2`, `Bank BCA`, `DANA`).\n\nKetik /batal untuk membatalkan.",
    { chat_id: chatId, message_id: messageId, parse_mode: "Markdown" }
  ).catch(() => {});
}

function addPaymentMethod(name) {
  const id = "pm_" + Date.now();
  db.update((s) => {
    if (!Array.isArray(s.paymentMethods)) s.paymentMethods = [];
    s.paymentMethods.push({ id, name, imageFileId: null, note: "" });
  });
  return id;
}

async function showPaymentMethodDetailAdmin(bot, chatId, messageId, pmId) {
  const { paymentMethods } = db.get();
  const pm = (paymentMethods || []).find((m) => m.id === pmId);
  if (!pm) return;
  const text =
    `💳 *${pm.name}*\n\n` +
    `Gambar: ${pm.imageFileId ? "✅ sudah diatur" : "❌ belum ada (opsional)"}\n` +
    `Catatan/instruksi: ${pm.note || "-"}`;
  await bot.editMessageText(text, {
    chat_id: chatId, message_id: messageId, parse_mode: "Markdown",
    reply_markup: kb.adminPaymentDetailKeyboard(pmId, !!pm.imageFileId),
  }).catch(() => {});
}

async function askPaymentName(bot, chatId, userId, messageId, pmId) {
  setSession(userId, { step: "await_payment_name", pmId });
  await bot.editMessageText("✏️ Kirim nama baru untuk metode pembayaran ini.\n\nKetik /batal untuk membatalkan.", {
    chat_id: chatId, message_id: messageId,
  }).catch(() => {});
}

function updatePaymentName(pmId, name) {
  db.update((s) => {
    const pm = (s.paymentMethods || []).find((m) => m.id === pmId);
    if (pm) pm.name = name;
  });
}

async function askPaymentNote(bot, chatId, userId, messageId, pmId) {
  setSession(userId, { step: "await_payment_note", pmId });
  await bot.editMessageText(
    "📝 Kirim catatan/instruksi pembayaran untuk metode ini (mis. nomor rekening, nomor DANA, atau instruksi scan QRIS).\n\nKetik /batal untuk membatalkan.",
    { chat_id: chatId, message_id: messageId }
  ).catch(() => {});
}

function updatePaymentNote(pmId, note) {
  db.update((s) => {
    const pm = (s.paymentMethods || []).find((m) => m.id === pmId);
    if (pm) pm.note = note;
  });
}

async function askPaymentImage(bot, chatId, userId, messageId, pmId) {
  setSession(userId, { step: "await_payment_image", pmId });
  await bot.editMessageText(
    "🖼 Kirim foto/gambar untuk metode pembayaran ini sekarang (mis. gambar QRIS). Opsional — bisa dilewati kalau metode ini tidak butuh gambar (mis. transfer bank).\n\nKetik /batal untuk membatalkan.",
    { chat_id: chatId, message_id: messageId }
  ).catch(() => {});
}

function setPaymentImage(pmId, fileId) {
  db.update((s) => {
    const pm = (s.paymentMethods || []).find((m) => m.id === pmId);
    if (pm) pm.imageFileId = fileId;
  });
}

function deletePaymentImage(pmId) {
  db.update((s) => {
    const pm = (s.paymentMethods || []).find((m) => m.id === pmId);
    if (pm) pm.imageFileId = null;
  });
}

function deletePaymentMethod(pmId) {
  db.update((s) => {
    s.paymentMethods = (s.paymentMethods || []).filter((m) => m.id !== pmId);
  });
}

// ---------- ADMIN GROUP ----------
async function askAdminGroup(bot, chatId, userId, messageId) {
  setSession(userId, { step: "await_admin_group" });
  await bot.editMessageText(
    "👥 Tambahkan bot ini ke grup admin kamu, jadikan admin grup, lalu kirim command `/setgroup` *di dalam grup tersebut* supaya ID grup otomatis tersimpan.\n\n" +
    "Grup live chat saat ini: " + (db.get().adminGroupId || "belum diatur"),
    { chat_id: chatId, message_id: messageId, parse_mode: "Markdown", reply_markup: { inline_keyboard: [kb.backButton("admin:main")] } }
  ).catch(() => {});
}

function setAdminGroup(groupId) {
  db.update((s) => (s.adminGroupId = groupId));
}

// ---------- ADMINS ----------
async function showAdminsAdmin(bot, chatId, messageId) {
  const { ownerIds, adminIds } = db.get();
  const text =
    `👥 *Daftar Owner*\n${ownerIds.join(", ") || "-"}\n\n` +
    `👥 *Daftar Admin*\n${adminIds.join(", ") || "-"}\n\n` +
    "Kirim `/addadmin <user_id>` untuk menambah admin baru (hanya owner).";
  await bot.editMessageText(text, {
    chat_id: chatId, message_id: messageId, parse_mode: "Markdown",
    reply_markup: { inline_keyboard: [kb.backButton("admin:main")] },
  }).catch(() => {});
}

// ---------- FEATURE TOGGLES ----------
async function showFeaturesAdmin(bot, chatId, messageId) {
  const { features } = db.get();
  const rows = [
    [kb.btn(
      `Warna Tombol (Bot API 9.4): ${features.useButtonStyle ? "✅ ON" : "⬜️ OFF"}`,
      { callback_data: "admin:toggle_style" }
    )],
    [kb.btn(
      `Tabel Rich Message (eksperimental): ${features.useRichTable ? "✅ ON" : "⬜️ OFF"}`,
      { callback_data: "admin:toggle_richtable" }
    )],
    kb.backButton("admin:main"),
  ];
  await bot.editMessageText(
    "⚙️ *Fitur Tampilan*\n\nToggle di bawah ini pakai fitur terbaru Telegram (Feb & Jun 2026). " +
    "Kalau ada masalah tampilan di device tertentu, matikan saja — bot otomatis fallback ke tampilan standar.",
    { chat_id: chatId, message_id: messageId, parse_mode: "Markdown", reply_markup: { inline_keyboard: rows } }
  ).catch(() => {});
}

function toggleFeature(key) {
  db.update((s) => (s.features[key] = !s.features[key]));
}

module.exports = {
  sessions, setSession, getSession, clearSession,
  openAdminPanel,
  askWelcomeText,
  showCatalogInfoAdmin, askCatalogLabel, updateCatalogLabel,
  askCatalogDescription, updateCatalogDescription,
  askCatalogPhoto, setCatalogPhoto, deleteCatalogPhoto,
  showCategoriesAdmin, showCategoryDetailAdmin, askNewCategoryName, askNewProduct,
  deleteCategory, addCategory, addProduct,
  showProductDetailAdmin, deleteProduct, askNewPrice, updatePrice,
  showPaymentAdmin, askNewPaymentMethodName, addPaymentMethod,
  showPaymentMethodDetailAdmin, askPaymentName, updatePaymentName,
  askPaymentNote, updatePaymentNote, askPaymentImage, setPaymentImage,
  deletePaymentImage, deletePaymentMethod,
  askAdminGroup, setAdminGroup,
  showAdminsAdmin,
  showFeaturesAdmin, toggleFeature,
};
