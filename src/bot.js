import { Bot, InlineKeyboard } from "grammy";
import { BOT_TOKEN, WEBAPP_URL, ADMIN_NOTIFY_CHAT_ID } from "./config.js";
import { db, upsertUser } from "./db.js";
import { approveOrder, rejectOrder } from "./orderService.js";

export const bot = new Bot(BOT_TOKEN);

bot.command("start", async (ctx) => {
  upsertUser(ctx.from);

  if (!WEBAPP_URL) {
    await ctx.reply(
      "Selamat datang di Nifara Store 🌸\n\nBoutique ini hampir siap, hanya menunggu admin " +
        "menyelesaikan pengaturan WEBAPP_URL. Silakan kembali sebentar lagi ya."
    );
    return;
  }

  const keyboard = new InlineKeyboard().webApp("🌸 Masuk ke Nifara Store", WEBAPP_URL);

  await ctx.reply(
    `Selamat datang, ${ctx.from.first_name || "Kak"} 🌸\n\n` +
      "*Nifara Store* — butik fitur & langganan premium untukmu.\n" +
      "Tekan tombol di bawah untuk menjelajah koleksi, memesan, dan memantau langgananmu.",
    { reply_markup: keyboard, parse_mode: "Markdown" }
  );
});

bot.command("admin", async (ctx) => {
  const user = db.prepare("SELECT * FROM users WHERE telegram_id = ?").get(ctx.from.id);
  if (!user?.is_admin) {
    await ctx.reply("Perintah ini khusus admin.");
    return;
  }
  const pending = db
    .prepare("SELECT COUNT(*) AS c FROM orders WHERE status = 'pending'")
    .get().c;
  await ctx.reply(
    `Panel admin Nifara Store 🌸\n- Order menunggu: ${pending}\n\nBuka Mini App lalu tab "Admin" untuk kelola order, ` +
      "atau approve/reject langsung dari notifikasi order yang masuk di chat ini."
  );
});

// Tombol Approve/Reject yang dikirim ke chat admin saat ada order baru
bot.callbackQuery(/^(approve|reject):(\d+)$/, async (ctx) => {
  const [, action, orderIdStr] = ctx.match;
  const orderId = Number(orderIdStr);

  const admin = db.prepare("SELECT * FROM users WHERE telegram_id = ?").get(ctx.from.id);
  if (!admin?.is_admin) {
    await ctx.answerCallbackQuery({ text: "Kamu bukan admin.", show_alert: true });
    return;
  }

  try {
    const result =
      action === "approve" ? approveOrder(orderId, ctx.from.id) : rejectOrder(orderId, ctx.from.id);

    await ctx.answerCallbackQuery({ text: action === "approve" ? "Order disetujui 🌸" : "Order ditolak" });
    await ctx.editMessageReplyMarkup(); // hapus tombol setelah diputuskan
    await ctx.editMessageText(
      ctx.msg.text + `\n\n${action === "approve" ? "🌸 DISETUJUI" : "✕ DITOLAK"} oleh @${ctx.from.username || ctx.from.id}`
    );

    // Notifikasi ke user
    const message =
      action === "approve"
        ? `🌸 Order #${orderId} untuk "${result.productName}" di *Nifara Store* telah disetujui!\nLangganan aktif sampai ${result.expiresAt}.`
        : `Order #${orderId} untuk "${result.productName}" di *Nifara Store* ditolak. Silakan hubungi admin jika ini keliru.`;

    await bot.api.sendMessage(result.userId, message, { parse_mode: "Markdown" });
  } catch (err) {
    await ctx.answerCallbackQuery({ text: `Gagal: ${err.message}`, show_alert: true });
  }
});

export async function notifyAdminsNewOrder(order) {
  if (!ADMIN_NOTIFY_CHAT_ID) return;

  const keyboard = new InlineKeyboard()
    .text("✅ Approve", `approve:${order.id}`)
    .text("❌ Reject", `reject:${order.id}`);

  const text =
    `🌸 *Order baru — Nifara Store* #${order.id}\n` +
    `Produk: ${order.productName}\n` +
    `Harga: Rp${order.price.toLocaleString("id-ID")}\n` +
    `User: ${order.userFirstName || ""} (@${order.username || "-"}, id: ${order.userId})\n` +
    `Nama pengirim transfer: *${order.paymentName}*\n` +
    (order.note ? `Catatan: ${order.note}\n` : "") +
    `\nCocokkan nama di atas dengan mutasi rekening/QRIS, lalu Approve atau Reject.`;

  await bot.api.sendMessage(ADMIN_NOTIFY_CHAT_ID, text, {
    parse_mode: "Markdown",
    reply_markup: keyboard,
  });
}
