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
      [btn("💳 Atur Pembayaran / QRIS", { callback_data: "admin:payment" }, "primary")],
      [btn("👥 Kelola Admin", { callback_data: "admin:admins" })],
      [btn("👥 Set Grup Live Chat Admin", { callback_data: "admin:group" })],
      [btn("⚙️ Fitur Tampilan (Tombol/Tabel)", { callback_data: "admin:features" })],
    ],
  };
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
};
