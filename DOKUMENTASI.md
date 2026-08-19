# 📦 Telegram Bot Store — Dokumentasi Lengkap (v2)

## 🆕 Yang Baru di v2
| Fitur | Keterangan |
|-------|------------|
| **Database PostgreSQL** | Pakai SQLAlchemy + Railway Volume. Data tidak hilang saat redeploy. |
| **Upload Bukti QRIS** | User cukup kirim foto transfer → langsung muncul di chat admin dengan tombol Konfirmasi/Tolak. Owner juga bisa upload foto QRIS dari panel. |
| **Auto-Expire Langganan** | Job tiap jam. Kirim notif H-3 dan H-1 sebelum expired, lalu nonaktifkan otomatis saat expired. |

---

## 🔧 Instalasi

```bash
pip install -r requirements.txt
```

Buat file `.env` (lihat `.env.example`):
```
BOT_TOKEN=TOKEN_DARI_BOTFATHER
OWNER_IDS=123456789
```

Jalankan lokal:
```bash
python bot.py
```

---

## 🚂 Deploy ke Railway

1. **Push ke GitHub** (semua file di folder ini)
2. Di Railway → **New Project → Deploy from GitHub Repo**
3. Tambah plugin **PostgreSQL**:
   - Railway otomatis set env var `DATABASE_URL`
   - Bot langsung baca dan pakai PostgreSQL
4. Set **Environment Variables**:
   ```
   BOT_TOKEN   = token dari BotFather
   OWNER_IDS   = 123456789        ← Telegram ID kamu
   ```
5. Di tab **Settings → Deploy** → set **Start Command**:
   ```
   python bot.py
   ```
   Atau Railway akan baca `Procfile` secara otomatis.

> ⚠️ Pastikan pakai **Worker** (bukan Web Service) karena bot Telegram pakai long-polling, bukan HTTP server.

---

## 🗄️ Database & Volume Railway

Bot pakai **SQLAlchemy** — otomatis membuat tabel saat pertama jalan (`init_db()`).

Tabel yang dibuat:
| Tabel | Isi |
|-------|-----|
| `users` | Data user + flag `is_admin` |
| `products` | Produk + harga + durasi langganan |
| `payment_methods` | Metode bayar + `foto` (file_id QRIS) |
| `orders` | Semua order + `bukti_file_id` foto bukti |
| `subscriptions` | Langganan aktif + flag notif H-3/H-1 |

Data tersimpan di PostgreSQL Railway → **tidak hilang saat redeploy/restart**.

---

## 📸 Alur Upload Bukti Pembayaran

```
User pilih produk → pilih payment → muncul instruksi bayar
  ↓
User transfer → kirim FOTO ke chat bot
  ↓
Bot simpan file_id ke orders.bukti_file_id
Bot kirim foto + tombol [✅ Konfirmasi] [❌ Tolak] ke semua admin
  ↓
Admin klik Konfirmasi → user dapat notif + langganan diaktifkan
```

User juga bisa ketik `/konfirmasi ORD1001` tanpa foto (notif teks ke admin).

---

## 📷 Upload Foto QRIS (Owner)

1. Buka Panel Owner → **💳 Kelola Payment**
2. Klik **📷 Upload QRIS** di samping metode QRIS
3. Kirim foto QR code
4. Selesai — foto akan muncul otomatis ke user saat checkout

---

## ⏰ Auto-Expire Langganan

Bot menjalankan **job setiap 1 jam**:

| Kondisi | Aksi |
|---------|------|
| Sisa ≤ 3 hari | Kirim notif "Langganan Hampir Habis" ke user (sekali) |
| Sisa ≤ 1 hari | Kirim notif "Berakhir Besok!" ke user (sekali) |
| Sisa ≤ 0 | Nonaktifkan langganan + kirim notif "Berakhir" ke user |

---

## 👤 Alur User

```
/start
  ├── 🛒 Beli Fitur
  ├── ⭐ Langganan Premium
  ├── 📋 Pesanan Saya
  ├── 📅 Langganan Aktif   ← tampilkan sisa hari
  └── 💬 Bantuan

Setelah bayar:
  → Kirim foto bukti transfer ke chat bot  (BARU)
  → atau /konfirmasi ORD1001
```

---

## 🔧 Alur Admin

Tombol di notif order & bukti foto langsung bisa klik **[✅ Konfirmasi]** atau **[❌ Tolak]** tanpa buka panel.

---

## 👑 Alur Owner

```
/owner
  ├── 📦 Kelola Produk   (toggle aktif/nonaktif)
  ├── 💳 Kelola Payment
  │     └── 📷 Upload QRIS (per metode)  ← BARU
  ├── 👥 Kelola Admin
  ├── 📊 Laporan Lengkap
  └── 🔧 Panel Admin
```

---

## 📋 Daftar Perintah

| Perintah | Siapa | Fungsi |
|----------|-------|--------|
| `/start` | Semua | Menu utama |
| `/konfirmasi [ID]` | User | Konfirmasi bayar tanpa foto |
| `/admin` | Admin | Panel admin |
| `/owner` | Owner | Panel owner |
| `/tambah_admin [id]` | Owner | Tambah admin |
| `/hapus_admin [id]` | Owner | Hapus admin |
| `/broadcast [pesan]` | Owner | Kirim ke semua user |

---

## 📁 Struktur File

```
bot_store/
├── bot.py              ← Kode utama (v2)
├── requirements.txt    ← Dependencies
├── Procfile            ← Untuk Railway (worker)
├── .env.example        ← Template env vars
└── DOKUMENTASI.md      ← File ini
```
