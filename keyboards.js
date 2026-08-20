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
  const { catalogInfo } = db.get();
  const catalogLabel = (catalogInfo && catalogInfo.buttonLabel) || "📋 Katalog & Pricelist";
  return {
    inline_keyboard: [
      [btn(catalogLabel, { callback_data: "menu:catalog" }, "primary")],
      [btn("🛒 Order Sekarang", { callback_data: "menu:order" }, "success")],
      [btn("💬 Hubungi Admin", { callback_data: "menu:contact" })],
      [btn("💳 Cara Pembayaran", { callback_data: "menu:payment" })],
    ],
  };
}

// Halaman "Katalog & Pricelist": TIDAK menampilkan tombol harga. Setiap
// produk (dari semua kategori) muncul sebagai satu tombol berisi nama
// produknya saja. Kalau ada lebih dari satu kategori, nama kategori
// ditampilkan sebagai tombol judul non-aktif (callback_data "noop") di atas
// produk-produk kategori tersebut, supaya daftarnya tetap rapi terkelompok.
function catalogProductsKeyboard() {
  const { categories } = db.get();
  const catsWithProducts = categories.filter((c) => c.products.length > 0);
  const rows = [];
  const showCategoryHeaders = catsWithProducts.length > 1;

  catsWithProducts.forEach((cat) => {
    if (showCategoryHeaders) {
      rows.push([btn(`— ${cat.name} —`, { callback_data: "noop" })]);
    }
    cat.products.forEach((p) => {
      rows.push([btn(p.name, { callback_data: `catprod:${cat.id}:${p.id}` })]);
    });
  });

  rows.push(backButton());
  return { inline_keyboard: rows };
}

// Halaman detail satu produk (dibuka dari catalogProductsKeyboard): hanya
// tombol Order Sekarang (lanjut ke alur konfirmasi pesanan yang sudah ada)
// dan Kembali (balik ke daftar tombol nama produk, bukan ke menu utama).
function catalogProductDetailKeyboard(catId, productId) {
  return {
    inline_keyboard: [
      [btn("🛒 Order Sekarang", { callback_data: `order:${catId}:${productId}` }, "success")],
      backButton("menu:catalog"),
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
  return {
    inline_keyboard: [
      [btn("🛒 Order Sekarang", { callback_data: `ordercat:${catId}` }, "success")],
      backButton("menu:catalog"),
    ],
  };
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
      [btn("📋 Kelola Katalog & Pricelist", { callback_data: "admin:catalog" }, "primary")],
      [btn("🗂 Kelola Kategori & Produk", { callback_data: "admin:categories" }, "primary")],
      [btn("💳 Atur Metode Pembayaran", { callback_data: "admin:payment" }, "primary")],
      [btn("👥 Kelola Admin", { callback_data: "admin:admins" })],
      [btn("👥 Set Grup Live Chat Admin", { callback_data: "admin:group" })],
      [btn("⚙️ Fitur Tampilan (Tombol/Tabel)", { callback_data: "admin:features" })],
    ],
  };
}

// Admin: halaman kelola katalog & pricelist (nama tombol, deskripsi, foto)
function adminCatalogInfoKeyboard(hasPhoto) {
  const rows = [
    [btn("✏️ Ubah Nama Tombol", { callback_data: "admin:catalog_label" })],
    [btn("📝 Ubah Deskripsi", { callback_data: "admin:catalog_desc" })],
    [btn(hasPhoto ? "🖼 Ganti Foto" : "🖼 Tambah Foto", { callback_data: "admin:catalog_img" })],
  ];
  if (hasPhoto) {
    rows.push([btn("🗑 Hapus Foto", { callback_data: "admin:catalog_imgdel" }, "danger")]);
  }
  rows.push(backButton("admin:main"));
  return { inline_keyboard: rows };
}

// ---------- PAYMENT METHODS ----------

// Susun daftar tombol jadi baris berisi 2 tombol per baris (sejajar
// dua-dua), baris terakhir bisa berisi 1 tombol kalau jumlahnya ganjil.
function chunkButtonsInPairs(buttons) {
  const rows = [];
  for (let i = 0; i < buttons.length; i += 2) {
    rows.push(buttons.slice(i, i + 2));
  }
  return rows;
}

// Customer: pilih metode pembayaran untuk sebuah pesanan spesifik
function paymentMethodsKeyboard(orderId) {
  const { paymentMethods } = db.get();
  const buttons = (paymentMethods || []).map((m) =>
    btn(`💳 ${m.name}`, { callback_data: `pay:${orderId}:${m.id}` }, "primary")
  );
  const rows = chunkButtonsInPairs(buttons);
  rows.push(backButton());
  return { inline_keyboard: rows };
}

// Customer: lihat info metode pembayaran secara umum (tanpa order aktif).
// Cukup menampilkan nama-nama metode sebagai teks (lihat customer.js),
// jadi keyboard-nya hanya berisi tombol kembali.
function paymentMethodsInfoKeyboard() {
  return { inline_keyboard: [backButton()] };
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
  chunkButtonsInPairs,
  mainMenuKeyboard,
  catalogProductsKeyboard,
  catalogProductDetailKeyboard,
  backButton,
  categoryListKeyboard,
  categoryProductsKeyboard,
  orderConfirmKeyboard,
  adminOrderActionsKeyboard,
  adminMainKeyboard,
  adminCatalogInfoKeyboard,
  paymentMethodsKeyboard,
  paymentMethodsInfoKeyboard,
  adminPaymentListKeyboard,
  adminPaymentDetailKeyboard,
};
