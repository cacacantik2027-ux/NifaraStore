import Database from "better-sqlite3";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ADMIN_TELEGRAM_IDS } from "./config.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbPath = path.join(__dirname, "..", "store.db");

export const db = new Database(dbPath);
db.pragma("journal_mode = WAL");

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  telegram_id INTEGER PRIMARY KEY,
  username TEXT,
  first_name TEXT,
  is_admin INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  description TEXT,
  price INTEGER NOT NULL,
  duration_days INTEGER NOT NULL,
  features TEXT DEFAULT '[]',
  active INTEGER DEFAULT 1
);

CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  product_id INTEGER NOT NULL,
  payment_name TEXT NOT NULL,
  note TEXT,
  status TEXT DEFAULT 'pending', -- pending | approved | rejected
  created_at TEXT DEFAULT (datetime('now')),
  decided_at TEXT,
  decided_by INTEGER
);

CREATE TABLE IF NOT EXISTS subscriptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  product_id INTEGER NOT NULL,
  order_id INTEGER,
  expires_at TEXT NOT NULL,
  active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now'))
);
`);

// Seed contoh produk kalau tabel masih kosong
const productCount = db.prepare("SELECT COUNT(*) AS c FROM products").get().c;
if (productCount === 0) {
  const insert = db.prepare(`
    INSERT INTO products (name, description, price, duration_days, features)
    VALUES (@name, @description, @price, @duration_days, @features)
  `);
  const seed = db.transaction((items) => {
    for (const item of items) insert.run(item);
  });
  seed([
    {
      name: "Premium Mingguan",
      description: "Akses semua fitur premium selama 7 hari",
      price: 15000,
      duration_days: 7,
      features: JSON.stringify(["Fitur A", "Fitur B", "Tanpa iklan"]),
    },
    {
      name: "Premium Bulanan",
      description: "Akses semua fitur premium selama 30 hari",
      price: 45000,
      duration_days: 30,
      features: JSON.stringify(["Fitur A", "Fitur B", "Fitur C", "Tanpa iklan", "Prioritas support"]),
    },
    {
      name: "Premium Tahunan",
      description: "Akses semua fitur premium selama 365 hari, paling hemat",
      price: 400000,
      duration_days: 365,
      features: JSON.stringify(["Semua fitur premium", "Tanpa iklan", "Prioritas support", "Bonus fitur beta"]),
    },
  ]);
  console.log("[db] Seeded 3 contoh produk");
}

export function upsertUser(tgUser) {
  const isAdmin = ADMIN_TELEGRAM_IDS.includes(String(tgUser.id)) ? 1 : 0;
  db.prepare(
    `INSERT INTO users (telegram_id, username, first_name, is_admin)
     VALUES (@telegram_id, @username, @first_name, @is_admin)
     ON CONFLICT(telegram_id) DO UPDATE SET
       username=excluded.username,
       first_name=excluded.first_name,
       is_admin=excluded.is_admin`
  ).run({
    telegram_id: tgUser.id,
    username: tgUser.username || null,
    first_name: tgUser.first_name || null,
    is_admin: isAdmin,
  });
  return db.prepare("SELECT * FROM users WHERE telegram_id = ?").get(tgUser.id);
}
