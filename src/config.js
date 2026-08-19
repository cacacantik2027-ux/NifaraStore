import "dotenv/config";

export const BOT_TOKEN = process.env.BOT_TOKEN || "";
export const ADMIN_TELEGRAM_IDS = (process.env.ADMIN_TELEGRAM_IDS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
export const ADMIN_NOTIFY_CHAT_ID = process.env.ADMIN_NOTIFY_CHAT_ID || ADMIN_TELEGRAM_IDS[0];
export const LIVE_CHAT_GROUP_ID = process.env.LIVE_CHAT_GROUP_ID || "";
export const WEBAPP_URL = process.env.WEBAPP_URL || "";
export const PAYMENT_INSTRUCTIONS =
  process.env.PAYMENT_INSTRUCTIONS || "Hubungi admin untuk info pembayaran.";
export const PORT = process.env.PORT || 3000;
export const BOT_MODE = process.env.BOT_MODE || "polling";

if (!BOT_TOKEN) {
  console.warn("[config] BOT_TOKEN belum di-set. Isi file .env terlebih dahulu (lihat .env.example).");
}
