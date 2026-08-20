// db.js — penyimpanan sederhana berbasis file JSON.
// Semua isi bot (welcome, katalog, harga, grup admin, QRIS) disimpan di sini
// dan bisa diubah lewat panel admin di dalam bot (lihat admin.js).
//
// PENTING — dua file yang beda fungsi, jangan sampai tertukar:
//   settings.example.json  → TEMPLATE/contoh bawaan project. Ini yang ikut
//                             di source code / GitHub. Aman untuk di-upload
//                             ulang kapan saja saat update kode — isinya
//                             tidak pernah dibaca ulang setelah bot pernah
//                             jalan sekali, jadi replace file ini TIDAK akan
//                             menimpa data toko yang sudah kamu input.
//   settings.json           → DATA LIVE toko kamu (hasil isi lewat /admin).
//                             Dibuat OTOMATIS oleh bot saat pertama kali
//                             jalan (disalin dari settings.example.json),
//                             lalu bot yang mengelola isinya sendiri.
//                             JANGAN pernah upload/timpa file ini manual —
//                             kalau kamu tidak sengaja meng-upload ulang
//                             settings.json versi lama/template, semua data
//                             yang sudah kamu input lewat /admin akan hilang
//                             tertimpa. Kalau mau update kode, cukup upload
//                             file .js dan settings.example.json saja.
//
// Lokasi folder data (tempat settings.json live disimpan) bisa diatur lewat
// env var DATA_DIR — ini penting saat deploy di Railway, karena filesystem
// Railway di-reset setiap redeploy KECUALI folder tersebut di-mount sebagai
// Volume. Set DATA_DIR ke path mount Volume-mu, misalnya "/app/data".
//
// Kalau DATA_DIR tidak diisi (mis. saat development di komputer sendiri),
// bot otomatis pakai folder project ini sendiri. Di Railway TANPA Volume +
// TANPA DATA_DIR, data akan reset setiap kali kamu redeploy (push kode
// baru) — bukan cuma saat file settings.json ketimpa, tapi karena seluruh
// filesystem container memang dibuat ulang dari nol oleh Railway. Ikuti
// README bagian 5 supaya ini tidak terjadi.

const fs = require("fs");
const path = require("path");

const DEFAULT_DATA_DIR = __dirname;
const DATA_DIR = process.env.DATA_DIR || DEFAULT_DATA_DIR;
const DATA_PATH = path.join(DATA_DIR, "settings.json");
// Seed SELALU diambil dari settings.example.json (template di source code),
// BUKAN dari settings.json — supaya data live tidak pernah bisa tertimpa
// ulang oleh file template, bahkan kalau seseorang tidak sengaja mengubah
// settings.example.json atau redeploy kodenya.
const SEED_PATH = path.join(DEFAULT_DATA_DIR, "settings.example.json");

if (!process.env.DATA_DIR) {
  console.warn(
    "[db] PERINGATAN: env var DATA_DIR belum diatur. Data toko (settings.json) " +
    "disimpan di folder project ini sendiri dan akan HILANG setiap kali platform " +
    "hosting kamu (mis. Railway) redeploy/rebuild container. Ikuti README bagian 5 " +
    "untuk setup Volume + DATA_DIR supaya data tidak hilang."
  );
}

function ensureDataFileExists() {
  // Buat folder data kalau belum ada (Volume kosong di deploy pertama).
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  // Kalau settings.json (data live) belum ada di DATA_DIR (mis. Volume baru
  // dipasang pertama kali, atau development lokal pertama kali), salin dari
  // settings.example.json sebagai starter. Setelah ini, settings.json TIDAK
  // PERNAH disentuh/ditimpa lagi oleh seed — murni dikelola lewat /admin.
  if (!fs.existsSync(DATA_PATH)) {
    const seed = fs.existsSync(SEED_PATH)
      ? fs.readFileSync(SEED_PATH, "utf-8")
      : "{}";
    fs.writeFileSync(DATA_PATH, seed, "utf-8");
    console.log(`[db] settings.json belum ada, dibuat baru di: ${DATA_PATH} (dari template settings.example.json)`);
  }
}

function load() {
  ensureDataFileExists();
  const raw = fs.readFileSync(DATA_PATH, "utf-8");
  const data = JSON.parse(raw);
  if (migrate(data)) {
    save(data);
  }
  return data;
}

// Migrasi struktur lama `payment: { qrisFileId, qrisNote, bankTransfer }`
// (satu metode saja) menjadi `paymentMethods: [...]` (banyak metode:
// QRIS 1, QRIS 2, Bank, Dana, dll). Dijalankan otomatis sekali saat file
// data lama pertama kali dibaca ulang setelah update kode ini.
function migrate(settings) {
  let changed = false;
  if (!settings.catalogInfo) {
    settings.catalogInfo = {
      buttonLabel: "📋 Katalog & Pricelist",
      description:
        "Cek katalog & pricelist produk kami di sini. Tap *Order Sekarang* untuk mulai pesan ya!",
      photoFileId: null,
    };
    changed = true;
  }
  if (!Array.isArray(settings.paymentMethods)) {
    settings.paymentMethods = [];
    if (settings.payment) {
      if (settings.payment.qrisFileId || settings.payment.qrisNote) {
        settings.paymentMethods.push({
          id: "pm_" + Date.now(),
          name: "QRIS",
          imageFileId: settings.payment.qrisFileId || null,
          note: settings.payment.qrisNote || "",
        });
      }
      if (settings.payment.bankTransfer) {
        settings.paymentMethods.push({
          id: "pm_" + (Date.now() + 1),
          name: "Transfer Bank",
          imageFileId: null,
          note: settings.payment.bankTransfer,
        });
      }
    }
    changed = true;
  }
  return changed;
}

function save(data) {
  fs.writeFileSync(DATA_PATH, JSON.stringify(data, null, 2), "utf-8");
}

// Cache in-memory, ditulis ulang ke disk setiap kali berubah.
let settings = load();

function get() {
  return settings;
}

function update(mutatorFn) {
  mutatorFn(settings);
  save(settings);
  return settings;
}

function isOwner(userId) {
  return settings.ownerIds.map(String).includes(String(userId));
}

function isAdmin(userId) {
  return (
    isOwner(userId) || settings.adminIds.map(String).includes(String(userId))
  );
}

function formatRupiah(n) {
  return "Rp" + Number(n).toLocaleString("id-ID");
}

module.exports = { get, update, isOwner, isAdmin, formatRupiah };
