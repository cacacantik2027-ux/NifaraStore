# Nifara Store — Bot Telegram

Bot toko dengan sambutan, katalog & pricelist, order langsung ke grup admin,
info pembayaran QRIS, dan panel admin/owner untuk mengatur semua isi bot
tanpa perlu ubah kode.

## 1. Instalasi

```bash
npm install
cp .env.example .env
```

Isi `.env`:
```
BOT_TOKEN=token_dari_botfather
OWNER_IDS=123456789
```
- Dapatkan `BOT_TOKEN` dari [@BotFather](https://t.me/BotFather).
- Dapatkan `OWNER_IDS` (ID numerik Telegram-mu) dari [@userinfobot](https://t.me/userinfobot). Bisa lebih dari satu, pisahkan koma.

Jalankan:
```bash
npm start
```

## 2. Setup grup live chat admin

1. Buat grup Telegram untuk tim admin.
2. Masukkan bot ke grup itu, jadikan admin.
3. Ketik `/setgroup` **di dalam grup tersebut** — ID grup otomatis tersimpan sebagai tujuan notifikasi order.

Setiap ada order baru, bot otomatis mengirim ringkasan pesanan ke grup ini lengkap dengan tombol ✅ Terima / ❌ Tolak.

**Cara kerja live chat customer ↔ admin:** setiap pesan pribadi yang dikirim
customer ke bot (dan bukan bukti transfer/input panel admin) otomatis
disalin ke grup ini beserta nama/ID pengirimnya. Admin tinggal **reply**
pesan itu di dalam grup, dan balasannya otomatis diteruskan ke chat pribadi
customer yang bersangkutan — persis seperti bot livegram. Bot memakai
`copyMessage` (bukan `forwardMessage`) untuk menyalin pesan customer,
supaya tidak gagal diam-diam kalau customer mengaktifkan setelan privasi
Telegram "Pesan Diteruskan" yang memblokir forwardMessage oleh bot.

## 3. Panel admin/owner

Ketik `/admin` di chat pribadi dengan bot (harus terdaftar sebagai owner/admin). Dari sini kamu bisa mengubah:
- Pesan sambutan (`/start`)
- **Katalog & Pricelist** (nama tombol, deskripsi, dan foto — lihat bagian 4.1)
- Kategori & produk beserta harga
- Metode pembayaran (bisa lebih dari satu: QRIS 1, QRIS 2, Bank, DANA, dll — lihat bagian 6)
- Grup live chat admin
- Toggle fitur tampilan (lihat bagian 4)

Owner bisa menambah admin lain lewat `/addadmin <user_id>`.

### 3.1 Tombol "Katalog & Pricelist"

Tombol menu utama ini menampilkan **pricelist lengkap** (semua kategori &
produk beserta harga dan catatan, dalam bentuk tabel rapi) — TANPA tombol
per-produk. Di bawah pricelist hanya ada dua tombol: **Order Sekarang**
(langsung membuka live chat dengan admin) dan **Kembali**.

Customer memilih sendiri produk mana yang mau dipesan lewat live chat
setelah melihat pricelist ini — admin yang menindaklanjuti percakapannya.

Atur isinya lewat panel admin:
- **Panel Admin → 📋 Kelola Katalog & Pricelist** — ubah nama tombol menu
  utama dan deskripsi/foto pembuka (opsional, tampil sebelum tabel
  pricelist).
- **Panel Admin → 🗂 Kelola Kategori & Produk** — kelola kategori, nama
  produk, harga, dan catatan yang muncul di tabel pricelist.

Catatan: tombol "🛒 Order Sekarang" di **menu utama** (bukan di dalam
katalog) tetap memakai alur checkout lama (pilih kategori → pilih produk →
konfirmasi → pilih metode pembayaran → kirim bukti transfer). Order Sekarang
**di dalam halaman katalog/pricelist** sengaja dibuat lebih simpel: langsung
live chat ke admin, customer sebut sendiri produk yang diinginkan.

### 3.2 Tombol "Cara Pembayaran"

Tombol ini sekarang cukup menampilkan **daftar nama metode pembayaran** yang
tersedia (mis. QRIS 1, QRIS 2, Transfer Bank), tanpa tombol detail per
metode. Detail cara bayar (gambar QRIS/instruksi) tetap muncul otomatis saat
customer sudah membuat pesanan dan memilih metode pembayarannya — kelola
detail itu lewat **Panel Admin → 💳 Atur Metode Pembayaran** (lihat bagian
6).

## 4. Tentang fitur "warna tombol" & "tabel pricelist ala update terbaru"

Ini yang perlu kamu tahu, biar tidak salah ekspektasi:

- **Warna tombol** — Telegram menambahkan field `style` pada tombol inline
  di **Bot API 9.4 (9 Februari 2026)**, dengan pilihan warna biru (primary),
  hijau (success), dan merah (danger). Bot ini sudah memakainya (lihat
  `src/keyboards.js`), dan kamu bisa nyalakan/matikan lewat
  **Panel Admin → Fitur Tampilan**. Karena fitur ini baru, versi Telegram
  yang lebih lama di HP pengguna mungkin belum menampilkan warnanya — tapi
  tombolnya tetap berfungsi normal, cuma tampil netral.

- **Tabel pricelist** — secara default bot memakai tabel teks monospace
  (`<pre>`) yang dijamin rapi di semua versi Telegram. Telegram juga baru
  menambahkan format tabel sungguhan lewat **Rich Messages / `sendRichMessage`
  (Bot API 10.1, 11 Juni 2026)**. Ini sudah diimplementasikan sebagai mode
  *eksperimental* (`src/pricetable.js`) yang bisa dinyalakan di
  **Panel Admin → Fitur Tampilan → Tabel Rich Message**. Karena metode ini
  sangat baru dan belum dibungkus library Node.js manapun (bot ini
  memanggilnya langsung lewat HTTPS ke Telegram), disarankan tetap pakai
  mode teks (default) untuk produksi, dan baru nyalakan mode rich table
  setelah kamu uji coba sendiri di akun bot-mu.

## 5. Deploy di Railway (dengan Volume, supaya data tidak hilang)

Railway me-reset filesystem-nya setiap kali kamu redeploy, kecuali folder
data-nya di-mount sebagai **Volume**. Bot ini sudah disiapkan untuk itu lewat
env var `DATA_DIR`.

Langkah setup:

1. Deploy project ini ke Railway seperti biasa (connect repo / upload).
2. Buka service bot di dashboard Railway → tab **Settings** → bagian
   **Volumes** → **New Volume**.
3. Set **Mount Path** ke `/app/data` (ini folder kerja default Railway untuk
   Node app; sesuaikan kalau struktur deploy-mu beda).
4. Buka tab **Variables**, tambahkan variable baru:
   ```
   DATA_DIR=/app/data
   ```
   (selain `BOT_TOKEN` dan `OWNER_IDS` yang sudah wajib diisi sebelumnya)
5. Redeploy service.

Setelah ini, `settings.json` (data live tokomu) disimpan di folder yang
di-mount Volume, bukan di dalam source code — jadi katalog, harga, QRIS, dan
pengaturan lain yang diubah admin lewat `/admin` akan **tetap ada** meski
kamu push kode baru atau service di-restart.

Catatan: di deploy pertama (Volume masih kosong), bot otomatis membuat
`settings.json` baru berisi data contoh dari `settings.example.json` —
tinggal diedit lagi lewat `/admin` seperti biasa.

### ⚠️ Kenapa data bisa hilang saat "replace file baru" — dan cara amannya

Ada **dua** kemungkinan penyebab, keduanya sudah ditangani bot ini asalkan
kamu ikuti caranya:

1. **Belum setup Volume + `DATA_DIR`.** Tanpa ini, setiap redeploy = seluruh
   filesystem container dibuat ulang dari nol oleh Railway, jadi data ikut
   reset — solusinya ya bagian 5 ini.
2. **Tidak sengaja meng-upload ulang `settings.json` ke GitHub.** Ini
   penyebab paling sering: kalau kamu drag & drop semua file termasuk
   `settings.json` versi lama/template saat update kode, itu akan menimpa
   data live tokomu. **Solusi:** project ini sekarang memisahkan file
   template (`settings.example.json` — aman di-upload ulang kapan saja)
   dari file data live (`settings.json` — dibuat & dikelola otomatis oleh
   bot, **jangan pernah upload file ini secara manual**). Saat update kode,
   cukup upload file `.js` dan `settings.example.json` saja — jangan
   sertakan `settings.json`.

## 6. Tentang Metode Pembayaran (bisa lebih dari satu)

Bot ini mendukung **banyak metode pembayaran sekaligus** — misalnya QRIS 1,
QRIS 2, Transfer Bank, DANA, OVO, dan seterusnya. Saat checkout, customer
akan disodori tombol untuk memilih metode mana yang mau dipakai, lalu bot
menampilkan gambar (kalau ada) dan catatan/instruksi untuk metode itu.

Kelola daftar metode lewat **Panel Admin → 💳 Atur Metode Pembayaran**:
- ➕ Tambah metode baru (kasih nama bebas, mis. `QRIS 1`, `DANA`)
- Untuk tiap metode bisa diatur: nama, gambar (opsional — QRIS biasanya
  pakai gambar, transfer bank/e-wallet biasanya cukup teks saja), dan
  catatan/instruksi pembayaran
- Hapus gambar atau hapus metode kapan saja

Bot Telegram **tidak** punya integrasi native untuk QRIS Indonesia (beda
dengan Telegram Stars). Yang disediakan bot ini: admin upload gambar QRIS
statis (atau metode lain) per metode, bot otomatis kirim gambar + instruksi
saat customer memilihnya, lalu customer kirim bukti transfer manual ke chat
untuk diverifikasi admin.

Kalau kamu mau QRIS **dinamis** (nominal otomatis sesuai harga produk, auto-
verifikasi pembayaran), itu perlu integrasi ke payment gateway resmi seperti
Midtrans, Xendit, atau Tripay yang mendukung QRIS — bot ini bisa dikembangkan
untuk itu, tapi butuh akun merchant & API key dari gateway tersebut karena
menyangkut kredensial pembayaran sungguhan yang tidak bisa saya buatkan.

## 7. Struktur file

Semua file sengaja diletakkan sejajar (flat, tanpa subfolder) supaya gampang
di-upload ke GitHub lewat browser/tablet — tinggal drag & drop semuanya
sekaligus tanpa perlu bikin folder dulu satu-satu.

```
bot.js                 entry point + routing tombol & command
db.js                  baca/tulis settings.json
keyboards.js           semua inline keyboard + warna tombol
pricetable.js          render pricelist (teks & rich table)
customer.js            alur pembeli
admin.js               alur admin/owner
settings.example.json  template/contoh isi bot (aman di-upload ulang)
package.json           daftar dependency
.env.example           contoh isi env var
```

`settings.json` (data live tokomu) **sengaja tidak ada di daftar di atas** —
file itu dibuat otomatis oleh bot saat pertama kali jalan, bukan bagian dari
kode yang kamu kelola manual. Lihat kotak peringatan di bagian 5.

### Cara upload ke GitHub lewat tablet

1. Buka repo kamu di GitHub (browser) → klik **Add file** → **Upload files**.
2. Drag semua file di atas sekaligus ke area upload (atau tap area itu untuk
   memilih file dari penyimpanan tablet, bisa multi-select sekaligus).
   **Jangan** ikut upload `settings.json` — file itu tidak termasuk source
   code, dan kalau ke-upload akan menimpa data toko yang sudah kamu input.
3. Scroll ke bawah, klik **Commit changes**.

Karena tidak ada folder sama sekali, kamu tidak perlu upload satu-satu atau
bikin struktur folder manual di GitHub.
