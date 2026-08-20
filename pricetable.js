// pricetable.js
//
// Render tabel pricelist. Ada 2 mode:
//
// 1) TEKS MONOSPACE (default, "useRichTable": false di settings)
//    Dikirim sebagai HTML <pre>, pasti tampil rapi di SEMUA versi Telegram
//    yang beredar sekarang. Ini mode paling aman dipakai produksi.
//
// 2) RICH TABLE (eksperimental, "useRichTable": true)
//    Memakai method sendRichMessage + block "table" yang baru ditambahkan
//    Telegram di Bot API 10.1 (11 Juni 2026). Method ini BELUM dibungkus
//    library node-telegram-bot-api (masih terlalu baru), jadi kita panggil
//    langsung ke HTTPS API Telegram. Aktifkan hanya kalau kamu sudah
//    mengecek dukungan Bot API terbaru & user Telegram-mu sudah update,
//    karena field/format detailnya masih bisa berubah di sisi Telegram.

const https = require("https");
const db = require("./db");

function buildMonospaceTable(cat) {
  const rows = cat.products.map((p) => [
    p.name,
    db.formatRupiah(p.price),
    p.note || "",
  ]);
  const header = ["Produk", "Harga", "Ket"];
  const all = [header, ...rows];
  const widths = [0, 1, 2].map((i) =>
    Math.max(...all.map((r) => String(r[i]).length))
  );
  const line = (r) =>
    r.map((cell, i) => String(cell).padEnd(widths[i])).join("  ");
  const sep = widths.map((w) => "-".repeat(w)).join("  ");

  const text =
    `📋 <b>${escapeHtml(cat.name)}</b>\n\n` +
    `<pre>${escapeHtml(line(header))}\n${sep}\n` +
    rows.map((r) => escapeHtml(line(r))).join("\n") +
    `</pre>`;

  return text;
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// Kirim pricelist ke chat. Otomatis pilih mode sesuai settings.
async function sendPricelist(bot, chatId, cat, replyMarkup) {
  const { features } = db.get();

  if (!features.useRichTable) {
    return bot.sendMessage(chatId, buildMonospaceTable(cat), {
      parse_mode: "HTML",
      reply_markup: replyMarkup,
    });
  }

  try {
    await sendRichTable(bot, chatId, cat, replyMarkup);
  } catch (err) {
    // Fallback otomatis ke tabel teks kalau Rich Message gagal
    // (mis. server Bot API lokal belum mendukung method ini).
    console.warn(
      "[pricetable] sendRichMessage gagal, fallback ke tabel teks:",
      err.message
    );
    return bot.sendMessage(chatId, buildMonospaceTable(cat), {
      parse_mode: "HTML",
      reply_markup: replyMarkup,
    });
  }
}

// Panggilan langsung ke Bot API (bukan lewat library) karena
// sendRichMessage + RichBlockTable belum ada wrapper resminya.
function sendRichTable(bot, chatId, cat, replyMarkup) {
  const token = bot.token;
  const rows = cat.products.map((p) => [
    { text: [{ type: "bold", text: p.name }] },
    { text: [{ type: "text", text: db.formatRupiah(p.price) }] },
    { text: [{ type: "text", text: p.note || "-" }] },
  ]);

  const payload = {
    chat_id: chatId,
    rich_message: {
      blocks: [
        { type: "section_heading", text: [{ type: "text", text: cat.name }] },
        {
          type: "table",
          header: [
            { text: [{ type: "bold", text: "Produk" }] },
            { text: [{ type: "bold", text: "Harga" }] },
            { text: [{ type: "bold", text: "Ket" }] },
          ],
          rows,
        },
      ],
    },
    reply_markup: replyMarkup,
  };

  return httpsPostJson(
    `/bot${token}/sendRichMessage`,
    payload
  );
}

function httpsPostJson(pathname, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = https.request(
      {
        hostname: "api.telegram.org",
        path: pathname,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(data),
        },
      },
      (res) => {
        let chunks = "";
        res.on("data", (c) => (chunks += c));
        res.on("end", () => {
          const parsed = JSON.parse(chunks);
          if (!parsed.ok) return reject(new Error(parsed.description));
          resolve(parsed.result);
        });
      }
    );
    req.on("error", reject);
    req.write(data);
    req.end();
  });
}

// Gabungan tabel monospace untuk SEMUA kategori sekaligus (dipakai halaman
// "Katalog & Pricelist" utama, bukan per-kategori).
function buildFullMonospaceTable(categories) {
  const catsWithProducts = categories.filter((c) => c.products.length > 0);
  if (catsWithProducts.length === 0) {
    return "Katalog belum diisi admin. Coba lagi nanti ya 🙏";
  }
  return catsWithProducts.map((cat) => buildMonospaceTable(cat)).join("\n\n");
}

// Kirim pricelist LENGKAP (semua kategori) ke chat. Otomatis pilih mode
// sesuai settings, sama seperti sendPricelist tapi untuk seluruh katalog.
async function sendFullPricelist(bot, chatId, categories, replyMarkup) {
  const { features } = db.get();
  const text = buildFullMonospaceTable(categories);

  if (!features.useRichTable) {
    return bot.sendMessage(chatId, text, {
      parse_mode: "HTML",
      reply_markup: replyMarkup,
    });
  }

  try {
    await sendFullRichTable(bot, chatId, categories, replyMarkup);
  } catch (err) {
    console.warn(
      "[pricetable] sendRichMessage (katalog penuh) gagal, fallback ke tabel teks:",
      err.message
    );
    return bot.sendMessage(chatId, text, {
      parse_mode: "HTML",
      reply_markup: replyMarkup,
    });
  }
}

function sendFullRichTable(bot, chatId, categories, replyMarkup) {
  const token = bot.token;
  const catsWithProducts = categories.filter((c) => c.products.length > 0);
  const blocks = [];
  catsWithProducts.forEach((cat) => {
    blocks.push({ type: "section_heading", text: [{ type: "text", text: cat.name }] });
    blocks.push({
      type: "table",
      header: [
        { text: [{ type: "bold", text: "Produk" }] },
        { text: [{ type: "bold", text: "Harga" }] },
        { text: [{ type: "bold", text: "Ket" }] },
      ],
      rows: cat.products.map((p) => [
        { text: [{ type: "bold", text: p.name }] },
        { text: [{ type: "text", text: db.formatRupiah(p.price) }] },
        { text: [{ type: "text", text: p.note || "-" }] },
      ]),
    });
  });

  const payload = { chat_id: chatId, rich_message: { blocks }, reply_markup: replyMarkup };
  return httpsPostJson(`/bot${token}/sendRichMessage`, payload);
}

module.exports = { sendPricelist, buildMonospaceTable, sendFullPricelist, buildFullMonospaceTable };
