// keyboards.js
//
// Helper untuk bikin inline keyboard, termasuk dukungan field `style`
// (warna tombol) yang ditambahkan Telegram di Bot API 9.4 / 9 Feb 2026.
// Nilai yang valid: "primary" (biru, aksi utama), "success" (hijau, aksi
// positif), "danger" (merah, aksi destruktif). Kalau tidak diisi -> netral.
//
// PENTING: field ini masih baru per Februari 2026. Tidak semua versi
// aplikasi Telegram di device pengguna mungkin sudah merender warnanya —
// kalau versi appnya belum update, tombol akan tetap tampil normal (netral)
// tanpa error, jadi aman untuk dipasang sekarang.

const db = require("./db");

/**
 * @param {string} text        Teks tombol
 * @param {object} rest        callback_data / url / dsb (format InlineKeyboardButton biasa)
 * @param {"primary"|"success"|"danger"|null} styleType
 */
function btn(text, rest, styleType = null) {
  const button = { text, ...rest };
  const { features } = db.get();
  if (styleType && features.useButtonStyle) {
    button.style = styleType; // string langsung: "primary" | "success" | "danger"
  }
  return button;
}

function mainMenuKeyboard() {
  return {
    inline_keyboard: [
      [btn("📋 Katalog & Pricelist", { callback_data: "menu:catalog" }, "primary")],
      [btn("🛒 Order Sekarang", { callback_data: "menu:order" }, "success")],
      [btn("💬 Hubungi Admin", { callback_data: "menu:contact" })],
      [btn("💳 Cara Pembayaran", { callback_data: "menu:payment" })],
    ],
  };
}

function backButton(target = "menu:main") {
  return [btn("⬅️ Kembali", { callback_data: target })];
}

function categoryListKeyboard() {
  const { categories } = db.get();
  const rows = categories.map((c) => [
    btn(c.name, { callback_data: `cat:${c.id}` }),
  ]);
  rows.push(backButton());
  return { inline_keyboard: rows };
}

function categoryProductsKeyboard(catId) {
  const { categories } = db.get();
  const cat = categories.find((c) => c.id === catId);
  const rows = (cat ? cat.products : []).map((p) => [
    btn(`🛒 Order: ${p.name}`, { callback_data: `order:${catId}:${p.id}` }, "success"),
  ]);
  rows.push(backButton("menu:catalog"));
  return { inline_keyboard: rows };
}

function orderConfirmKeyboard(catId, productId) {
  return {
    inline_keyboard: [
      [btn("✅ Ya, Pesan Sekarang", { callback_data: `confirm:${catId}:${productId}` }, "success")],
      [btn("❌ Batal", { callback_data: "menu:catalog" }, "danger")],
    ],
  };
}

function adminOrderActionsKeyboard(orderId) {
  return {
    inline_keyboard: [
      [
        btn("✅ Terima & Proses", { callback_data: `adminorder:accept:${orderId}` }, "success"),
        btn("❌ Tolak", { callback_data: `adminorder:reject:${orderId}` }, "danger"),
      ],
    ],
  };
}

function adminMainKeyboard() {
  return {
    inline_keyboard: [
      [btn("✏️ Ubah Pesan Sambutan", { callback_data: "admin:welcome" }, "primary")],
      [btn("🗂 Kelola Kategori & Produk", { callback_data: "admin:categories" }, "primary")],
      [btn("💳 Atur Metode Pembayaran", { callback_data: "admin:payment" }, "primary")],
      [btn("👥 Kelola Admin", { callback_data: "admin:admins" })],
      [btn("👥 Set Grup Live Chat Admin", { callback_data: "admin:group" })],
      [btn("⚙️ Fitur Tampilan (Tombol/Tabel)", { callback_data: "admin:features" })],
    ],
  };
}

// ---------- PAYMENT METHODS ----------

// Customer: pilih metode pembayaran untuk sebuah pesanan spesifik
function paymentMethodsKeyboard(orderId) {
  const { paymentMethods } = db.get();
  const rows = (paymentMethods || []).map((m) => [
    btn(`💳 ${m.name}`, { callback_data: `pay:${orderId}:${m.id}` }, "primary"),
  ]);
  rows.push(backButton());
  return { inline_keyboard: rows };
}

// Customer: lihat info metode pembayaran secara umum (tanpa order aktif)
function paymentMethodsInfoKeyboard() {
  const { paymentMethods } = db.get();
  const rows = (paymentMethods || []).map((m) => [
    btn(`💳 ${m.name}`, { callback_data: `paymethodinfo:${m.id}` }),
  ]);
  rows.push(backButton());
  return { inline_keyboard: rows };
}

// Admin: daftar semua metode pembayaran
function adminPaymentListKeyboard() {
  const { paymentMethods } = db.get();
  const rows = (paymentMethods || []).map((m) => [
    btn(`${m.name}${m.imageFileId ? " 🖼" : ""}`, { callback_data: `admin:pay:${m.id}` }),
  ]);
  rows.push([btn("➕ Tambah Metode Pembayaran", { callback_data: "admin:pay_add" }, "success")]);
  rows.push(backButton("admin:main"));
  return { inline_keyboard: rows };
}

// Admin: detail satu metode pembayaran
function adminPaymentDetailKeyboard(pmId, hasImage) {
  const rows = [
    [btn("✏️ Ubah Nama", { callback_data: `admin:pay_name:${pmId}` })],
    [btn("📝 Ubah Catatan/Instruksi", { callback_data: `admin:pay_note:${pmId}` })],
    [btn(hasImage ? "🖼 Ganti Gambar" : "🖼 Upload Gambar (opsional)", { callback_data: `admin:pay_img:${pmId}` })],
  ];
  if (hasImage) {
    rows.push([btn("🗑 Hapus Gambar", { callback_data: `admin:pay_imgdel:${pmId}` })]);
  }
  rows.push([btn("🗑 Hapus Metode Ini", { callback_data: `admin:pay_del:${pmId}` }, "danger")]);
  rows.push(backButton("admin:payment"));
  return { inline_keyboard: rows };
}

module.exports = {
  btn,
  mainMenuKeyboard,
  backButton,
  categoryListKeyboard,
  categoryProductsKeyboard,
  orderConfirmKeyboard,
  adminOrderActionsKeyboard,
  adminMainKeyboard,
  paymentMethodsKeyboard,
  paymentMethodsInfoKeyboard,
  adminPaymentListKeyboard,
  adminPaymentDetailKeyboard,
};
