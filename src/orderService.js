import { db } from "./db.js";

export function createOrder({ userId, productId, paymentName, note }) {
  const product = db.prepare("SELECT * FROM products WHERE id = ? AND active = 1").get(productId);
  if (!product) throw new Error("Produk tidak ditemukan atau sudah tidak aktif");
  if (!paymentName || !paymentName.trim()) throw new Error("Nama pengirim transfer wajib diisi");

  const info = db
    .prepare(
      `INSERT INTO orders (user_id, product_id, payment_name, note, status)
       VALUES (?, ?, ?, ?, 'pending')`
    )
    .run(userId, productId, paymentName.trim(), note || null);

  return { orderId: info.lastInsertRowid, product };
}

export function getOrderDetailForNotify(orderId) {
  const row = db
    .prepare(
      `SELECT o.id, o.payment_name AS paymentName, o.note,
              p.name AS productName, p.price,
              u.telegram_id AS userId, u.username, u.first_name AS userFirstName
       FROM orders o
       JOIN products p ON p.id = o.product_id
       JOIN users u ON u.telegram_id = o.user_id
       WHERE o.id = ?`
    )
    .get(orderId);
  return row;
}

function addDays(date, days) {
  const d = new Date(date);
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

export const approveOrder = db.transaction((orderId, adminId) => {
  const order = db.prepare("SELECT * FROM orders WHERE id = ?").get(orderId);
  if (!order) throw new Error("Order tidak ditemukan");
  if (order.status !== "pending") throw new Error("Order sudah diproses sebelumnya");

  const product = db.prepare("SELECT * FROM products WHERE id = ?").get(order.product_id);

  // Kalau user masih punya langganan aktif untuk produk ini, perpanjang dari expiresAt lama.
  const existing = db
    .prepare(
      `SELECT * FROM subscriptions WHERE user_id = ? AND product_id = ? AND active = 1 AND expires_at > datetime('now')`
    )
    .get(order.user_id, order.product_id);

  const base = existing ? new Date(existing.expires_at) : new Date();
  const expiresAt = addDays(base, product.duration_days).toISOString();

  db.prepare(
    `INSERT INTO subscriptions (user_id, product_id, order_id, expires_at, active)
     VALUES (?, ?, ?, ?, 1)`
  ).run(order.user_id, order.product_id, order.id, expiresAt);

  db.prepare(
    `UPDATE orders SET status = 'approved', decided_at = datetime('now'), decided_by = ? WHERE id = ?`
  ).run(adminId, orderId);

  return {
    userId: order.user_id,
    productName: product.name,
    expiresAt: new Date(expiresAt).toLocaleString("id-ID"),
  };
});

export const rejectOrder = db.transaction((orderId, adminId) => {
  const order = db.prepare("SELECT * FROM orders WHERE id = ?").get(orderId);
  if (!order) throw new Error("Order tidak ditemukan");
  if (order.status !== "pending") throw new Error("Order sudah diproses sebelumnya");

  const product = db.prepare("SELECT * FROM products WHERE id = ?").get(order.product_id);

  db.prepare(
    `UPDATE orders SET status = 'rejected', decided_at = datetime('now'), decided_by = ? WHERE id = ?`
  ).run(adminId, orderId);

  return { userId: order.user_id, productName: product.name };
});
