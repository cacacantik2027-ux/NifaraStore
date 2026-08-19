import { Router } from "express";
import { db, upsertUser } from "../db.js";
import { requireTelegramAuth } from "../telegramAuth.js";
import { createOrder, getOrderDetailForNotify } from "../orderService.js";
import { notifyAdminsNewOrder } from "../bot.js";

const router = Router();

router.use(requireTelegramAuth);

// Info user saat ini (dipakai mini app untuk tahu apakah tampilkan tab Admin)
router.get("/me", (req, res) => {
  const user = upsertUser(req.tgUser);
  res.json({ user });
});

router.post("/orders", (req, res) => {
  const user = upsertUser(req.tgUser);
  const { productId, paymentName, note } = req.body || {};

  try {
    const { orderId } = createOrder({ userId: user.telegram_id, productId, paymentName, note });
    const detail = getOrderDetailForNotify(orderId);

    notifyAdminsNewOrder({ id: orderId, ...detail }).catch((err) =>
      console.error("[orders] gagal kirim notifikasi admin:", err.message)
    );

    res.json({ ok: true, orderId });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.get("/orders/mine", (req, res) => {
  const orders = db
    .prepare(
      `SELECT o.id, o.status, o.created_at, o.decided_at, o.payment_name,
              p.name AS productName, p.price
       FROM orders o JOIN products p ON p.id = o.product_id
       WHERE o.user_id = ?
       ORDER BY o.created_at DESC`
    )
    .all(req.tgUser.id);
  res.json({ orders });
});

router.get("/subscriptions/mine", (req, res) => {
  const subs = db
    .prepare(
      `SELECT s.id, s.expires_at, s.active,
              p.name AS productName, p.features
       FROM subscriptions s JOIN products p ON p.id = s.product_id
       WHERE s.user_id = ?
       ORDER BY s.expires_at DESC`
    )
    .all(req.tgUser.id)
    .map((s) => ({
      ...s,
      features: JSON.parse(s.features || "[]"),
      isExpired: new Date(s.expires_at) < new Date(),
    }));
  res.json({ subscriptions: subs });
});

export default router;
