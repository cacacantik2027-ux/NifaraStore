import crypto from "node:crypto";
import { BOT_TOKEN } from "./config.js";

/**
 * Validasi initData yang dikirim oleh Telegram Mini App (Telegram.WebApp.initData).
 * Lihat: https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
 *
 * Return: parsed user object jika valid, atau null jika tidak valid / expired.
 */
export function validateInitData(initData, { maxAgeSeconds = 86400 } = {}) {
  if (!initData || !BOT_TOKEN) return null;

  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  if (!hash) return null;
  params.delete("hash");

  const dataCheckArr = [];
  for (const [key, value] of [...params.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    dataCheckArr.push(`${key}=${value}`);
  }
  const dataCheckString = dataCheckArr.join("\n");

  const secretKey = crypto.createHmac("sha256", "WebAppData").update(BOT_TOKEN).digest();
  const computedHash = crypto.createHmac("sha256", secretKey).update(dataCheckString).digest("hex");

  if (computedHash !== hash) return null;

  const authDate = Number(params.get("auth_date") || 0);
  if (maxAgeSeconds && Date.now() / 1000 - authDate > maxAgeSeconds) return null;

  const userRaw = params.get("user");
  if (!userRaw) return null;

  try {
    return JSON.parse(userRaw);
  } catch {
    return null;
  }
}

/**
 * Express middleware: membaca header X-Telegram-Init-Data, validasi, dan
 * menempelkan req.tgUser. Jika tidak valid, balas 401.
 */
export function requireTelegramAuth(req, res, next) {
  const initData = req.header("X-Telegram-Init-Data");
  const user = validateInitData(initData);
  if (!user) {
    return res.status(401).json({ error: "Unauthorized: initData tidak valid atau expired" });
  }
  req.tgUser = user;
  next();
}
