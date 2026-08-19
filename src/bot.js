import { Bot, InlineKeyboard } from "grammy";
import { BOT_TOKEN, WEBAPP_URL, ADMIN_NOTIFY_CHAT_ID, LIVE_CHAT_GROUP_ID } from "./config.js";
import { db, upsertUser } from "./db.js";
import { approveOrder, rejectOrder } from "./orderService.js";
import { CATALOG_PAGES } from "./catalog.js";

export const bot = new Bot(BOT_TOKEN);

// ─── Helper ────────────────────────────────────────────────────────────────

function formatRupiah(n) {
  return "Rp" + Number(n).toLocaleString("id-ID");
}

function buildMainKeyboard() {
  const kb = new InlineKeyboard();
  if (WEBAPP_URL) {
    kb.webApp("🛍️ Buka Toko (Mini App)", WEBAPP_URL).row();
  }
  kb.text("📋 Lihat Katalog Harga", "catalog:page:1").row();
  kb.text("⚙️ Pengaturan Akun", "settings:show").row();
  return kb;
}

// ─── /start ────────────────────────────────────────────────────────────────

bot.command("start", async (ctx) => {
  upsertUser(ctx.from);

  const name = ctx.from.first_name || "Kak";
  const kb = buildMainKeyboard();

  await ctx.reply(
    `🌸 *Selamat datang di Nifara Store, ${name}!*\n\n` +
    `Halo! Kami hadir untuk membantu kamu mendapatkan akses layanan digital premium dengan harga terbaik — Netflix, Spotify, ChatGPT, dan masih banyak lagi.\n\n` +
    `✨ *Apa yang bisa kami bantu?*\n` +
    `• 📋 Cek katalog & pricelist lengkap\n` +
    `• 🛍️ Order langsung lewat Mini App\n` +
    `• 💬 Tanya admin via Live Chat\n\n` +
    `_Pilih menu di bawah untuk mulai:_`,
    { parse_mode: "Markdown", reply_markup: kb }
  );
});

// ─── /katalog ──────────────────────────────────────────────────────────────

bot.command("katalog", async (ctx) => {
  upsertUser(ctx.from);
  await sendCatalogPage(ctx, 1);
});

// ─── /settings command ─────────────────────────────────────────────────────

bot.command("settings", async (ctx) => {
  upsertUser(ctx.from);
  await sendSettings(ctx);
});

// ─── /admin command ────────────────────────────────────────────────────────

bot.command("admin", async (ctx) => {
  const user = db.prepare("SELECT * FROM users WHERE telegram_id = ?").get(ctx.from.id);
  if (!user?.is_admin) {
    await ctx.reply("⛔ Perintah ini khusus admin.");
    return;
  }
  const pending = db.prepare("SELECT COUNT(*) AS c FROM orders WHERE status = 'pending'").get().c;
  await ctx.reply(
    `🌸 *Panel Admin Nifara Store*\n\n` +
    `📦 Order menunggu: *${pending}*\n\n` +
    `Buka Mini App → tab Admin untuk kelola semua order, atau approve/reject langsung dari notifikasi yang masuk di chat ini.`,
    { parse_mode: "Markdown" }
  );
});

// ─── Catalog Pagination ────────────────────────────────────────────────────

async function sendCatalogPage(ctx, pageNum, editMessage = false) {
  const page = CATALOG_PAGES.find((p) => p.id === pageNum);
  if (!page) return;

  const totalPages = CATALOG_PAGES.length;

  // Build product list text
  let text = `${page.emoji} *${page.title}*\n_${page.subtitle}_\n`;
  text += `\n┌─────────────────────────┐\n`;
  page.products.forEach((prod, i) => {
    const isLast = i === page.products.length - 1;
    text += `${isLast ? "└" : "├"} *${prod.name}*\n`;
    text += `${isLast ? " " : "│"}   💰 ${formatRupiah(prod.price)} · ${prod.duration}\n`;
    text += `${isLast ? " " : "│"}   📝 ${prod.desc}\n`;
    if (!isLast) text += `│\n`;
  });
  text += `\n📄 Halaman ${pageNum} dari ${totalPages}`;

  // Navigation keyboard
  const kb = new InlineKeyboard();

  // Order buttons per product
  page.products.forEach((prod) => {
    const label = `🛒 Order ${prod.name} — ${formatRupiah(prod.price)}`;
    const data = `order:${page.id}:${prod.name}:${prod.price}`;
    kb.text(label, data.length <= 64 ? data : `order:${page.id}:${encodeIdx(page, prod)}`).row();
  });

  kb.row();

  // Pagination nav
  if (pageNum > 1) kb.text("◀ Sebelumnya", `catalog:page:${pageNum - 1}`);
  kb.text(`${pageNum}/${totalPages}`, "noop");
  if (pageNum < totalPages) kb.text("Selanjutnya ▶", `catalog:page:${pageNum + 1}`);

  kb.row();
  kb.text("🏠 Menu Utama", "main:menu");

  const opts = { parse_mode: "Markdown", reply_markup: kb };

  if (editMessage) {
    await ctx.editMessageText(text, opts);
  } else {
    await ctx.reply(text, opts);
  }
}

function encodeIdx(page, prod) {
  const idx = page.products.indexOf(prod);
  return `${page.id}:${idx}`;
}

// ─── Callback: catalog navigation ──────────────────────────────────────────

bot.callbackQuery(/^catalog:page:(\d+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const pageNum = Number(ctx.match[1]);
  await sendCatalogPage(ctx, pageNum, true);
});

// ─── Callback: main menu ───────────────────────────────────────────────────

bot.callbackQuery("main:menu", async (ctx) => {
  await ctx.answerCallbackQuery();
  const name = ctx.from.first_name || "Kak";
  const kb = buildMainKeyboard();
  await ctx.editMessageText(
    `🌸 *Selamat datang di Nifara Store, ${name}!*\n\n` +
    `✨ *Apa yang bisa kami bantu?*\n` +
    `• 📋 Cek katalog & pricelist lengkap\n` +
    `• 🛍️ Order langsung lewat Mini App\n` +
    `• 💬 Tanya admin via Live Chat\n\n` +
    `_Pilih menu di bawah untuk mulai:_`,
    { parse_mode: "Markdown", reply_markup: kb }
  );
});

// ─── Callback: noop (halaman indikator) ───────────────────────────────────

bot.callbackQuery("noop", async (ctx) => {
  await ctx.answerCallbackQuery();
});

// ─── Callback: order produk ───────────────────────────────────────────────

bot.callbackQuery(/^order:(\d+):(.+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();

  const pageId = Number(ctx.match[1]);
  const rest = ctx.match[2];
  const page = CATALOG_PAGES.find((p) => p.id === pageId);
  if (!page) return;

  // Coba decode idx format dulu (order:pageId:idx)
  let prod;
  const maybeIdx = Number(rest);
  if (!isNaN(maybeIdx) && rest.match(/^\d+$/)) {
    prod = page.products[maybeIdx];
  } else {
    // format: order:pageId:name:price
    const parts = rest.split(":");
    const prodName = parts.slice(0, -1).join(":");
    prod = page.products.find((p) => p.name === prodName);
    if (!prod) prod = page.products.find((p) => p.name === rest);
  }

  if (!prod) {
    await ctx.reply("Produk tidak ditemukan. Silakan coba lagi dari katalog.");
    return;
  }

  const targetId = LIVE_CHAT_GROUP_ID || ADMIN_NOTIFY_CHAT_ID;
  const user = ctx.from;
  const username = user.username ? `@${user.username}` : `id:${user.id}`;

  // Kirim pesan order ke grup live chat admin
  if (targetId) {
    const adminText =
      `🛒 *Permintaan Order Baru — Nifara Store*\n\n` +
      `👤 User: ${user.first_name || ""} (${username})\n` +
      `📦 Produk: *${prod.name}*\n` +
      `💰 Harga: ${formatRupiah(prod.price)}\n` +
      `⏱ Durasi: ${prod.duration}\n\n` +
      `_Balas pesan ini atau hubungi user langsung untuk konfirmasi pembayaran._`;

    const adminKb = new InlineKeyboard()
      .url(`💬 Chat ${user.first_name || "User"}`, `tg://user?id=${user.id}`);

    await bot.api
      .sendMessage(targetId, adminText, { parse_mode: "Markdown", reply_markup: adminKb })
      .catch((err) => console.error("[bot] gagal kirim ke admin group:", err.message));
  }

  // Balas user dengan instruksi order
  const kb = new InlineKeyboard();
  if (LIVE_CHAT_GROUP_ID) {
    kb.url("💬 Hubungi Admin via Live Chat", `https://t.me/c/${String(LIVE_CHAT_GROUP_ID).replace("-100", "")}`);
    kb.row();
  }
  if (WEBAPP_URL) {
    kb.webApp("🛍️ Order via Mini App", WEBAPP_URL).row();
  }
  kb.text("◀ Kembali ke Katalog", `catalog:page:${pageId}`);

  await ctx.reply(
    `🌸 *Konfirmasi Order*\n\n` +
    `Kamu memilih:\n` +
    `📦 *${prod.name}*\n` +
    `💰 ${formatRupiah(prod.price)} · ${prod.duration}\n\n` +
    `*Langkah selanjutnya:*\n` +
    `1️⃣ Lakukan pembayaran sesuai instruksi admin\n` +
    `2️⃣ Kirim bukti transfer + nama pengirim ke admin\n` +
    `3️⃣ Admin akan verifikasi & aktifkan akses kamu\n\n` +
    `💬 Klik tombol di bawah untuk menghubungi admin:`,
    { parse_mode: "Markdown", reply_markup: kb }
  );
});

// ─── Callback: settings ────────────────────────────────────────────────────

bot.callbackQuery("settings:show", async (ctx) => {
  await ctx.answerCallbackQuery();
  await sendSettings(ctx, true);
});

async function sendSettings(ctx, edit = false) {
  upsertUser(ctx.from);
  const user = db.prepare("SELECT * FROM users WHERE telegram_id = ?").get(ctx.from.id);
  const totalOrders = db.prepare("SELECT COUNT(*) AS c FROM orders WHERE user_id = ?").get(ctx.from.id)?.c ?? 0;
  const activeOrders = db
    .prepare("SELECT COUNT(*) AS c FROM orders WHERE user_id = ? AND status = 'approved'")
    .get(ctx.from.id)?.c ?? 0;

  const text =
    `⚙️ *Pengaturan & Info Akun*\n\n` +
    `👤 Nama: ${ctx.from.first_name || "-"}${ctx.from.last_name ? " " + ctx.from.last_name : ""}\n` +
    `🔖 Username: ${ctx.from.username ? "@" + ctx.from.username : "-"}\n` +
    `🆔 Telegram ID: \`${ctx.from.id}\`\n` +
    `🛡️ Status admin: ${user?.is_admin ? "✅ Ya" : "❌ Tidak"}\n\n` +
    `📦 Total order: ${totalOrders}\n` +
    `✅ Order disetujui: ${activeOrders}`;

  const kb = new InlineKeyboard().text("🏠 Menu Utama", "main:menu");

  if (edit) {
    await ctx.editMessageText(text, { parse_mode: "Markdown", reply_markup: kb });
  } else {
    await ctx.reply(text, { parse_mode: "Markdown", reply_markup: kb });
  }
}

// ─── Callback: approve/reject dari notifikasi order (mini app flow) ────────

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
    await ctx.editMessageReplyMarkup();
    await ctx.editMessageText(
      ctx.msg.text +
        `\n\n${action === "approve" ? "🌸 DISETUJUI" : "✕ DITOLAK"} oleh @${ctx.from.username || ctx.from.id}`
    );

    const message =
      action === "approve"
        ? `🌸 Order #${orderId} untuk *${result.productName}* telah *disetujui*!\nLangganan aktif sampai ${result.expiresAt}.`
        : `Order #${orderId} untuk *${result.productName}* *ditolak*. Silakan hubungi admin jika ada kekeliruan.`;

    await bot.api.sendMessage(result.userId, message, { parse_mode: "Markdown" });
  } catch (err) {
    await ctx.answerCallbackQuery({ text: `Gagal: ${err.message}`, show_alert: true });
  }
});

// ─── Unknown commands ──────────────────────────────────────────────────────

bot.on("message:text", async (ctx) => {
  if (ctx.message.text.startsWith("/")) {
    const kb = buildMainKeyboard();
    await ctx.reply(
      `Perintah tidak dikenal.\n\nGunakan menu di bawah atau:\n/start — menu utama\n/katalog — lihat pricelist\n/settings — info akun`,
      { reply_markup: kb }
    );
  }
});

// ─── Global error handler ──────────────────────────────────────────────────

bot.catch((err) => {
  const ctx = err.ctx;
  console.error(`[bot] Error update ${ctx.update.update_id}:`, err.error);
  ctx.reply("Terjadi kesalahan. Silakan coba lagi.").catch(() => {});
});

// ─── Notif order baru ke admin (dari mini app) ─────────────────────────────

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
    `\nCocokkan nama dengan mutasi rekening/QRIS, lalu Approve atau Reject.`;

  await bot.api.sendMessage(ADMIN_NOTIFY_CHAT_ID, text, {
    parse_mode: "Markdown",
    reply_markup: keyboard,
  });
}
