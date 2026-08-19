import { Router } from "express";
import { db } from "../db.js";
import { requireTelegramAuth } from "../telegramAuth.js";
import { approveOrder, rejectOrder } from "../orderService.js";
import { bot } from "../bot.js";

const router = Router();

router.use(requireTelegramAuth);

function requireAdmin(req, res, next) {
  const user = db.prepare("SELECT * FROM users WHERE telegram_id = ?").get(req.tgUser.id);
  if (!user?.is_admin) return res.status(403).json({ error: "Khusus admin" });
  next();
}

router.use(requireAdmin);

router.get("/admin/orders", (req, res) => {
  const status = req.query.status || "pending";
  const orders = db
    .prepare(
      `SELECT o.id, o.status, o.payment_name AS paymentName, o.note, o.created_at,
              p.name AS productName, p.price,
              u.telegram_id AS userId, u.username, u.first_name AS userFirstName
       FROM orders o
       JOIN products p ON p.id = o.product_id
       JOIN users u ON u.telegram_id = o.user_id
       WHERE o.status = ?
       ORDER BY o.created_at DESC`
    )
    .all(status);
  res.json({ orders });
});

router.post("/admin/orders/:id/decide", async (req, res) => {
  const orderId = Number(req.params.id);
  const { action } = req.body || {};
  if (!["approve", "reject"].includes(action)) {
    return res.status(400).json({ error: "action harus 'approve' atau 'reject'" });
  }

  try {
    const result =
      action === "approve" ? approveOrder(orderId, req.tgUser.id) : rejectOrder(orderId, req.tgUser.id);

    const message =
      action === "approve"
        ? `🎉 Order #${orderId} untuk "${result.productName}" telah *disetujui*!\nLangganan aktif sampai ${result.expiresAt}.`
        : `Order #${orderId} untuk "${result.productName}" *ditolak*. Silakan hubungi admin jika ini keliru.`;

    bot.api
      .sendMessage(result.userId, message, { parse_mode: "Markdown" })
      .catch((err) => console.error("[admin] gagal notif user:", err.message));

    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

export default router;
