// db.js — penyimpanan sederhana berbasis file JSON.
// Semua isi bot (welcome, katalog, harga, grup admin, QRIS) disimpan di sini
// dan bisa diubah lewat panel admin di dalam bot (lihat admin.js).
//
// Lokasi folder data bisa diatur lewat env var DATA_DIR — ini penting saat
// deploy di Railway, karena filesystem Railway di-reset setiap redeploy
// KECUALI folder tersebut di-mount sebagai Volume. Set DATA_DIR ke path
// mount Volume-mu, misalnya "/app/data".
//
// Kalau DATA_DIR tidak diisi (mis. saat development di komputer sendiri),
// bot otomatis pakai folder project ini sendiri (tempat settings.json berada).

const fs = require("fs");
const path = require("path");

const DEFAULT_DATA_DIR = __dirname;
const DATA_DIR = process.env.DATA_DIR || DEFAULT_DATA_DIR;
const DATA_PATH = path.join(DATA_DIR, "settings.json");
const SEED_PATH = path.join(DEFAULT_DATA_DIR, "settings.json");

function ensureDataFileExists() {
  // Buat folder data kalau belum ada (Volume kosong di deploy pertama).
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  // Kalau settings.json belum ada di DATA_DIR (mis. Volume baru dipasang
  // pertama kali), salin dari settings.json bawaan project sebagai starter.
  if (!fs.existsSync(DATA_PATH)) {
    const seed = fs.existsSync(SEED_PATH)
      ? fs.readFileSync(SEED_PATH, "utf-8")
      : "{}";
    fs.writeFileSync(DATA_PATH, seed, "utf-8");
    console.log(`[db] settings.json belum ada, dibuat baru di: ${DATA_PATH}`);
  }
}

function load() {
  ensureDataFileExists();
  const raw = fs.readFileSync(DATA_PATH, "utf-8");
  return JSON.parse(raw);
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
