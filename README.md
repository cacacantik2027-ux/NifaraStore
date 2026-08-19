# Nifara Store — Telegram Bot + Mini App

Bot Telegram untuk jualan fitur & langganan premium. Seluruh alur — lihat katalog,
order, cek status tiket, cek langganan aktif, sampai panel admin — ada di dalam
**Mini App** (Telegram WebApp) yang dibuka lewat tombol di bot. Pembayaran dilakukan
**manual**: user isi nama pengirim transfer/QRIS saat checkout, admin cocokkan
manual dengan mutasi, lalu Approve/Reject langsung dari chat Telegram atau dari
tab Admin di Mini App.

## Struktur project

```
telegram-store-bot/
├── src/
│   ├── server.js        # Express server + start bot
│   ├── bot.js            # Logika bot: /start, notifikasi admin, tombol approve/reject
│   ├── config.js         # Baca variabel dari .env
│   ├── db.js              # SQLite schema + seed 3 contoh produk
│   ├── orderService.js    # Logika bikin order, approve, reject, perpanjang langganan
│   ├── telegramAuth.js    # Validasi initData Mini App (keamanan)
│   └── routes/
│       ├── products.js    # GET /api/products
│       ├── orders.js       # /api/me, /api/orders, /api/orders/mine, /api/subscriptions/mine
│       └── admin.js        # /api/admin/orders, /api/admin/orders/:id/decide
└── public/webapp/          # Mini App (frontend): index.html, style.css, app.js
```

## 1. Setup awal

1. Buat bot baru lewat [@BotFather](https://t.me/BotFather) → catat **BOT_TOKEN**.
2. Cek Telegram ID kamu sendiri lewat [@userinfobot](https://t.me/userinfobot).
3. Copy `.env.example` jadi `.env`, lalu isi:
   - `BOT_TOKEN` — token dari BotFather
   - `ADMIN_TELEGRAM_IDS` — id Telegram owner/admin, pisah koma kalau lebih dari satu
   - `ADMIN_NOTIFY_CHAT_ID` — ke mana notifikasi order baru dikirim (bisa id admin sendiri, atau id grup khusus admin)
   - `PAYMENT_INSTRUCTIONS` — teks info transfer/QRIS yang tampil ke user saat checkout
   - `WEBAPP_URL` — **diisi belakangan**, lihat langkah 3
4. Install dependency:
   ```bash
   npm install
   ```

## 2. Jalankan bot (development)

```bash
npm start
```

Bot langsung jalan dengan mode `polling` (tidak perlu domain publik untuk bot-nya).
Server Express juga jalan di `http://localhost:3000` — folder `public/webapp` di-serve
di path `/webapp`.

## 3. Deploy Mini App (WAJIB HTTPS)

Telegram Mini App **harus** dibuka lewat URL HTTPS publik. Ada 2 opsi:

**A. Semua jadi satu (paling gampang):** deploy seluruh project ini (server + webapp)
ke hosting yang kasih HTTPS otomatis, misalnya Railway, Render, atau Fly.io.
Setelah dapat domain publik, contoh `https://kios-langganan.up.railway.app`, isi:
```
WEBAPP_URL=https://kios-langganan.up.railway.app/webapp
```
lalu restart service.

**B. Development lokal pakai tunnel:** jalankan `npm start` di lokal, lalu buka
tunnel HTTPS ke port 3000 misalnya dengan `ngrok http 3000` atau `cloudflared tunnel
--url http://localhost:3000`. Pakai URL yang diberikan sebagai `WEBAPP_URL` (+ `/webapp`).

Setelah `WEBAPP_URL` diisi, restart bot. Kirim `/start` ke bot → tombol **"🛒 Buka Toko"**
akan muncul dan membuka Mini App.

> Opsional: daftarkan Mini App resmi lewat @BotFather → `/newapp` supaya bisa juga
> diakses dari menu profil bot, bukan cuma tombol inline.

## 4. Alur pemakaian

**User:**
1. `/start` di bot → tekan "Buka Toko"
2. Tab **Katalog** → pilih produk → **Order**
3. Modal checkout muncul: info pembayaran manual + form isi nama pengirim transfer
4. Kirim order → status masuk **Tiket Saya** sebagai "Pending"
5. Setelah admin approve, user dapat notifikasi otomatis dari bot + langganan muncul aktif di tab **Langganan**

**Admin:**
- Setiap order baru otomatis masuk sebagai pesan ke `ADMIN_NOTIFY_CHAT_ID` lengkap
  dengan nama pengirim transfer, dan tombol inline **Approve/Reject** langsung di chat.
- Bisa juga kelola dari Mini App: tab **Admin** (muncul otomatis kalau id Telegram
  kamu ada di `ADMIN_TELEGRAM_IDS`) → filter Pending/Disetujui/Ditolak → tombol Approve/Reject.
- Approve otomatis menghitung `expires_at` (kalau user masih punya langganan aktif
  untuk produk yang sama, masa aktifnya diperpanjang, bukan ditimpa).

## 5. Kelola produk

Untuk sekarang, produk diisi lewat seed di `src/db.js` (3 contoh: Mingguan/Bulanan/Tahunan).
Cara paling cepat menambah/mengubah produk: edit langsung tabel `products` di file
`store.db` pakai tool seperti [DB Browser for SQLite](https://sqlitebrowser.org/), atau
tambahkan endpoint admin `POST /api/admin/products` kalau butuh dikelola dari Mini App
juga (belum ada di starter ini, gampang ditambahkan mengikuti pola `routes/admin.js`).

## 6. Keamanan

- Semua endpoint `/api/orders*`, `/api/me`, `/api/admin/*` memvalidasi header
  `X-Telegram-Init-Data` menggunakan HMAC sesuai `BOT_TOKEN` (`src/telegramAuth.js`).
  Request tanpa initData valid dari Telegram akan ditolak (401), jadi Mini App ini
  tidak bisa diakses sembarangan dari luar Telegram.
- Endpoint admin (`routes/admin.js`) dobel-cek: initData valid **dan** `is_admin = 1`
  di database (otomatis di-set kalau id Telegram ada di `ADMIN_TELEGRAM_IDS`).
- Jangan commit file `.env` atau `store.db` ke git (sudah ada di `.gitignore`).

## 7. Yang bisa dikembangkan lagi

- Tambah endpoint kelola produk (CRUD) dari tab Admin di Mini App.
- Auto-reminder H-1 sebelum langganan habis (cron job + `bot.api.sendMessage`).
- Upload bukti transfer (foto) — Telegram Mini App bisa pakai `Telegram.WebApp.showPopup`
  atau minta user kirim foto langsung ke bot sebagai balasan order, lalu forward ke admin.
- Kalau nanti mau payment gateway otomatis (Midtrans/Xendit), tinggal tambah webhook baru
  yang manggil `approveOrder()` di `orderService.js` — logic inti sudah reusable.
