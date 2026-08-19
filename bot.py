"""
=============================================================
  TELEGRAM BOT STORE v3
  - Database SQLite via Railway Volume
  - Upload bukti QRIS/transfer dari user
  - Auto-expire langganan + notifikasi H-3 / H-1
  - Grup Admin Live Chat:
      * Semua notif order dikirim ke grup
      * Admin reply pesan di grup → diteruskan ke user
      * Admin ketik /balas [UID] [pesan] di grup
      * Tombol ✅ Konfirmasi / ❌ Tolak langsung di grup
=============================================================
"""

import os
import logging
from datetime import datetime, timedelta
from collections import Counter
from zoneinfo import ZoneInfo

from telegram import (
    Update, InlineKeyboardButton, InlineKeyboardMarkup,
    constants,
)
from telegram.ext import (
    Application, CommandHandler, CallbackQueryHandler,
    MessageHandler, filters, ContextTypes,
)
from sqlalchemy import (
    create_engine, Column, Integer, BigInteger, String,
    Boolean, DateTime, Text, ForeignKey, func,
)
from sqlalchemy.orm import declarative_base, sessionmaker, Session

# ─── KONFIGURASI ─────────────────────────────────────────────────────────────
BOT_TOKEN      = os.getenv("BOT_TOKEN", "ISI_TOKEN_BOT_KAMU")
OWNER_IDS      = list(map(int, os.getenv("OWNER_IDS", "123456789").split(",")))
ADMIN_GROUP_ID = int(os.getenv("ADMIN_GROUP_ID", "0"))   # ID grup admin (negatif, misal -1001234567890)
DATABASE_URL   = os.getenv("DATABASE_URL", "sqlite:////data/bot_store.db")

if DATABASE_URL.startswith("postgres://"):
    DATABASE_URL = DATABASE_URL.replace("postgres://", "postgresql+psycopg2://", 1)

WIB = ZoneInfo("Asia/Jakarta")

logging.basicConfig(
    format="%(asctime)s %(name)s %(levelname)s %(message)s", level=logging.INFO
)
logger = logging.getLogger(__name__)

# ─── DATABASE ────────────────────────────────────────────────────────────────
Base = declarative_base()
engine = create_engine(DATABASE_URL, pool_pre_ping=True,
                       connect_args={"check_same_thread": False}
                       if "sqlite" in DATABASE_URL else {})
SessionLocal = sessionmaker(bind=engine)

def get_db() -> Session:
    return SessionLocal()

class User(Base):
    __tablename__ = "users"
    id        = Column(BigInteger, primary_key=True)
    nama      = Column(String(255))
    username  = Column(String(255), nullable=True)
    join_at   = Column(DateTime, default=datetime.utcnow)
    is_admin  = Column(Boolean, default=False)

class Product(Base):
    __tablename__ = "products"
    id          = Column(String(10), primary_key=True)
    nama        = Column(String(255))
    deskripsi   = Column(Text)
    harga       = Column(Integer)
    kategori    = Column(String(50))
    stok        = Column(Integer, default=999)
    aktif       = Column(Boolean, default=True)
    durasi_hari = Column(Integer, nullable=True)

class PaymentMethod(Base):
    __tablename__ = "payment_methods"
    id     = Column(String(10), primary_key=True)
    nama   = Column(String(100))
    tipe   = Column(String(20))
    detail = Column(Text)
    aktif  = Column(Boolean, default=True)
    foto   = Column(String(255), nullable=True)

class Order(Base):
    __tablename__ = "orders"
    id            = Column(String(20), primary_key=True)
    user_id       = Column(BigInteger, ForeignKey("users.id"))
    produk_id     = Column(String(10), ForeignKey("products.id"))
    produk_nama   = Column(String(255))
    harga         = Column(Integer)
    payment_id    = Column(String(10), ForeignKey("payment_methods.id"))
    payment_nama  = Column(String(100))
    status        = Column(String(30), default="pending")
    waktu         = Column(DateTime, default=datetime.utcnow)
    bukti_file_id = Column(String(255), nullable=True)
    catatan       = Column(Text, nullable=True)
    confirmed_by  = Column(BigInteger, nullable=True)
    confirmed_at  = Column(DateTime, nullable=True)
    # ID pesan notif di grup — untuk edit/reply setelah konfirmasi
    group_msg_id  = Column(BigInteger, nullable=True)

class Subscription(Base):
    __tablename__ = "subscriptions"
    id          = Column(Integer, primary_key=True, autoincrement=True)
    user_id     = Column(BigInteger, ForeignKey("users.id"))
    order_id    = Column(String(20), ForeignKey("orders.id"))
    produk_nama = Column(String(255))
    mulai       = Column(DateTime)
    selesai     = Column(DateTime)
    aktif       = Column(Boolean, default=True)
    notif_3hari = Column(Boolean, default=False)
    notif_1hari = Column(Boolean, default=False)

# Mapping: message_id pesan user yang di-forward ke grup → user_id asli
# Disimpan di bot_data supaya persisten selama bot hidup
# Key: str(group_msg_id), Value: user_id

def init_db():
    Base.metadata.create_all(bind=engine)
    db = get_db()
    try:
        if db.query(Product).count() == 0:
            db.add_all([
                Product(id="P001", nama="Fitur Auto Reply Pro",
                        deskripsi="Auto reply canggih dengan AI, unlimited keyword",
                        harga=50000, kategori="fitur"),
                Product(id="P002", nama="Fitur Blast Message",
                        deskripsi="Kirim pesan ke semua member sekaligus",
                        harga=75000, kategori="fitur"),
                Product(id="P003", nama="Premium Basic 1 Bulan",
                        deskripsi="Akses semua fitur premium selama 30 hari",
                        harga=99000, kategori="premium", durasi_hari=30),
                Product(id="P004", nama="Premium Pro 3 Bulan",
                        deskripsi="Akses semua fitur premium + prioritas support 90 hari",
                        harga=249000, kategori="premium", durasi_hari=90),
                Product(id="P005", nama="Premium Ultimate 1 Tahun",
                        deskripsi="Akses penuh semua fitur selama 365 hari",
                        harga=799000, kategori="premium", stok=50, durasi_hari=365),
            ])
        if db.query(PaymentMethod).count() == 0:
            db.add_all([
                PaymentMethod(id="PM001", nama="QRIS BCA", tipe="qris",
                              detail="Scan QRIS BCA - a/n Toko Digital"),
                PaymentMethod(id="PM002", nama="Transfer BCA", tipe="bank",
                              detail="BCA - 1234567890 - a/n TOKO DIGITAL"),
                PaymentMethod(id="PM003", nama="OVO", tipe="ewallet",
                              detail="OVO - 08123456789 - a/n Toko Digital"),
                PaymentMethod(id="PM004", nama="GoPay", tipe="ewallet",
                              detail="GoPay - 08123456789 - a/n Toko Digital", aktif=False),
            ])
        db.commit()
    finally:
        db.close()

# ─── HELPERS ─────────────────────────────────────────────────────────────────
def is_owner(uid: int) -> bool:
    return uid in OWNER_IDS

def is_admin(uid: int) -> bool:
    if is_owner(uid):
        return True
    db = get_db()
    try:
        return db.query(User).filter_by(id=uid, is_admin=True).first() is not None
    finally:
        db.close()

def is_group_admin(uid: int) -> bool:
    """Cek apakah user adalah admin/owner yang terdaftar (untuk validasi pesan dari grup)."""
    return is_admin(uid)

def format_rupiah(n: int) -> str:
    return f"Rp {n:,.0f}".replace(",", ".")

def status_emoji(s: str) -> str:
    return {"pending": "⏳", "paid": "💸", "completed": "🎉", "cancelled": "❌"}.get(s, "❓")

def tipe_emoji(t: str) -> str:
    return {"qris": "📱", "bank": "🏦", "ewallet": "💰"}.get(t, "💳")

def back_btn(target: str) -> InlineKeyboardMarkup:
    label = {"start": "🏠 Menu Utama", "admin_menu": "🔙 Panel Admin",
             "owner_menu": "👑 Menu Owner"}.get(target, "🔙 Kembali")
    return InlineKeyboardMarkup([[InlineKeyboardButton(label, callback_data=target)]])

def get_next_order_id(db: Session) -> str:
    last = db.query(Order).order_by(Order.id.desc()).first()
    return f"ORD{int(last.id.replace('ORD','')) + 1}" if last else "ORD1001"

def get_user_tag(user_id: int, db: Session) -> str:
    u = db.query(User).filter_by(id=user_id).first()
    if u and u.username:
        return f"@{u.username}"
    return f"ID `{user_id}`"

# ─── KIRIM NOTIF KE GRUP ─────────────────────────────────────────────────────
async def kirim_notif_grup(context: ContextTypes.DEFAULT_TYPE, text: str,
                            keyboard=None, order_id: str = None) -> int | None:
    """Kirim pesan ke grup admin, simpan message_id untuk keperluan edit."""
    if not ADMIN_GROUP_ID:
        return None
    try:
        markup = InlineKeyboardMarkup(keyboard) if keyboard else None
        msg = await context.bot.send_message(
            ADMIN_GROUP_ID, text, parse_mode="Markdown",
            reply_markup=markup)
        # Simpan mapping order_id → group_msg_id
        if order_id:
            db = get_db()
            try:
                o = db.query(Order).filter_by(id=order_id).first()
                if o:
                    o.group_msg_id = msg.message_id
                    db.commit()
            finally:
                db.close()
        return msg.message_id
    except Exception as e:
        logger.error(f"Gagal kirim ke grup: {e}")
        return None

async def kirim_foto_notif_grup(context: ContextTypes.DEFAULT_TYPE, file_id: str,
                                 caption: str, keyboard=None, order_id: str = None) -> int | None:
    if not ADMIN_GROUP_ID:
        return None
    try:
        markup = InlineKeyboardMarkup(keyboard) if keyboard else None
        msg = await context.bot.send_photo(
            ADMIN_GROUP_ID, file_id, caption=caption,
            parse_mode="Markdown", reply_markup=markup)
        if order_id:
            db = get_db()
            try:
                o = db.query(Order).filter_by(id=order_id).first()
                if o:
                    o.group_msg_id = msg.message_id
                    db.commit()
            finally:
                db.close()
        return msg.message_id
    except Exception as e:
        logger.error(f"Gagal kirim foto ke grup: {e}")
        return None

# ─── START / MENU USER ───────────────────────────────────────────────────────
async def start(update: Update, context: ContextTypes.DEFAULT_TYPE):
    # Abaikan pesan dari grup
    if update.effective_chat.type != "private":
        return

    user = update.effective_user
    uid  = user.id
    db   = get_db()
    try:
        if not db.query(User).filter_by(id=uid).first():
            db.add(User(id=uid, nama=user.full_name, username=user.username))
            db.commit()
    finally:
        db.close()

    if is_owner(uid):
        return await owner_menu(update, context)
    if is_admin(uid):
        return await admin_menu(update, context)

    welcome = context.bot_data.get("welcome_msg", "Selamat datang di Bot Store! 🛍️")
    keyboard = [
        [InlineKeyboardButton("🛒 Beli Fitur",        callback_data="kat_fitur"),
         InlineKeyboardButton("⭐ Langganan Premium",  callback_data="kat_premium")],
        [InlineKeyboardButton("📋 Pesanan Saya",       callback_data="my_orders"),
         InlineKeyboardButton("📅 Langganan Aktif",    callback_data="my_subs")],
        [InlineKeyboardButton("💬 Chat dengan Admin",  callback_data="chat_admin"),
         InlineKeyboardButton("❓ Bantuan",             callback_data="help")],
    ]
    text = f"👋 Halo, *{user.first_name}*!\n\n{welcome}\n\nSilakan pilih menu:"
    if update.callback_query:
        await update.callback_query.edit_message_text(
            text, reply_markup=InlineKeyboardMarkup(keyboard), parse_mode="Markdown")
    else:
        await update.message.reply_text(
            text, reply_markup=InlineKeyboardMarkup(keyboard), parse_mode="Markdown")

# ─── CHAT ADMIN (USER KIRIM PESAN KE ADMIN GRUP) ─────────────────────────────
async def chat_admin_menu(update: Update, context: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    await query.answer()
    await query.edit_message_text(
        "💬 *Chat dengan Admin*\n\n"
        "Ketik pesan kamu dan kirim — admin akan membalas langsung dari grup.\n\n"
        "_Ketik /batal untuk kembali ke menu._",
        parse_mode="Markdown",
        reply_markup=InlineKeyboardMarkup([
            [InlineKeyboardButton("🔙 Kembali", callback_data="start")]
        ]))
    context.user_data["mode"] = "chat_admin"

async def user_kirim_pesan_ke_admin(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """User private → forward ke grup admin dengan tombol Balas."""
    if update.effective_chat.type != "private":
        return
    uid  = update.effective_user.id
    nama = update.effective_user.full_name
    uname = f"@{update.effective_user.username}" if update.effective_user.username else f"ID `{uid}`"
    teks  = update.message.text or ""

    if not ADMIN_GROUP_ID:
        await update.message.reply_text("❌ Fitur chat admin belum dikonfigurasi.")
        return

    # Kirim ke grup
    notif = (f"💬 *PESAN DARI USER*\n\n"
             f"👤 {nama} ({uname})\n"
             f"🆔 `{uid}`\n\n"
             f"📩 {teks}")
    keyboard = [[InlineKeyboardButton(f"↩️ Balas ke {nama}", callback_data=f"grup_balas_{uid}")]]
    try:
        msg = await context.bot.send_message(
            ADMIN_GROUP_ID, notif,
            parse_mode="Markdown",
            reply_markup=InlineKeyboardMarkup(keyboard))
        # Simpan mapping group_msg_id → user_id di bot_data
        context.bot_data.setdefault("msg_user_map", {})[str(msg.message_id)] = uid
    except Exception as e:
        logger.error(f"Gagal forward pesan user ke grup: {e}")
        await update.message.reply_text("❌ Gagal mengirim pesan ke admin. Coba lagi.")
        return

    await update.message.reply_text(
        "✅ Pesan terkirim ke admin! Tunggu balasan ya. 🙏")

# ─── ADMIN BALAS USER DARI GRUP ──────────────────────────────────────────────
async def grup_tombol_balas(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Admin klik tombol '↩️ Balas' di grup → bot minta admin ketik balasan."""
    query = update.callback_query
    await query.answer()
    uid_admin = update.effective_user.id

    if not is_group_admin(uid_admin):
        await query.answer("❌ Hanya admin yang bisa membalas.", show_alert=True)
        return

    target_uid = int(query.data.replace("grup_balas_", ""))
    # Simpan state: admin ini sedang mau balas ke target_uid
    context.user_data["balas_target"] = target_uid
    context.user_data["mode"] = "balas_user"

    await query.message.reply_text(
        f"↩️ Ketik balasan untuk user `{target_uid}`.\n"
        f"Atau gunakan: `/balas {target_uid} [pesan]`",
        parse_mode="Markdown")

async def grup_admin_ketik_balasan(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Admin mengetik teks di grup setelah klik tombol Balas → diteruskan ke user."""
    if update.effective_chat.id != ADMIN_GROUP_ID:
        return
    uid_admin = update.effective_user.id
    if not is_group_admin(uid_admin):
        return

    # Cek apakah admin ini sedang dalam mode balas
    target_uid = context.user_data.get("balas_target")
    if not target_uid or context.user_data.get("mode") != "balas_user":
        return

    teks = update.message.text
    if not teks:
        return

    admin_nama = update.effective_user.full_name
    try:
        await context.bot.send_message(
            target_uid,
            f"💬 *Balasan dari Admin*\n\n{teks}\n\n_— {admin_nama}_",
            parse_mode="Markdown")
        await update.message.reply_text(f"✅ Balasan terkirim ke user `{target_uid}`.")
    except Exception as e:
        await update.message.reply_text(f"❌ Gagal kirim ke user: {e}")

    # Reset mode
    context.user_data.pop("balas_target", None)
    context.user_data.pop("mode", None)

async def cmd_balas(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """/balas [user_id] [pesan] — admin balas user dari grup maupun private."""
    uid_admin = update.effective_user.id
    if not is_group_admin(uid_admin):
        return
    if len(context.args) < 2:
        await update.message.reply_text(
            "Gunakan: `/balas [user_id] [pesan]`\nContoh: `/balas 123456789 Halo, pesanan kamu sudah kami proses!`",
            parse_mode="Markdown")
        return
    try:
        target_uid = int(context.args[0])
    except ValueError:
        await update.message.reply_text("❌ User ID harus berupa angka.")
        return
    pesan      = " ".join(context.args[1:])
    admin_nama = update.effective_user.full_name
    try:
        await context.bot.send_message(
            target_uid,
            f"💬 *Balasan dari Admin*\n\n{pesan}\n\n_— {admin_nama}_",
            parse_mode="Markdown")
        await update.message.reply_text(f"✅ Pesan terkirim ke user `{target_uid}`.")
    except Exception as e:
        await update.message.reply_text(f"❌ Gagal kirim: {e}")

# ─── PRODUK ──────────────────────────────────────────────────────────────────
async def show_kategori(update: Update, context: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    await query.answer()
    kategori = query.data.replace("kat_", "")
    db = get_db()
    try:
        prods = db.query(Product).filter_by(kategori=kategori, aktif=True).all()
    finally:
        db.close()
    if not prods:
        await query.edit_message_text("❌ Tidak ada produk tersedia.", reply_markup=back_btn("start"))
        return
    label = "Fitur" if kategori == "fitur" else "Langganan Premium"
    text  = f"{'🛒' if kategori=='fitur' else '⭐'} *Daftar {label}*\n\n"
    keyboard = []
    for p in prods:
        text += f"• *{p.nama}* — {format_rupiah(p.harga)}\n"
        keyboard.append([InlineKeyboardButton(f"{p.nama} — {format_rupiah(p.harga)}",
                                               callback_data=f"produk_{p.id}")])
    keyboard.append([InlineKeyboardButton("🔙 Kembali", callback_data="start")])
    await query.edit_message_text(text, reply_markup=InlineKeyboardMarkup(keyboard), parse_mode="Markdown")

async def show_produk(update: Update, context: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    await query.answer()
    pid = query.data.replace("produk_", "")
    db  = get_db()
    try:
        p = db.query(Product).filter_by(id=pid).first()
    finally:
        db.close()
    if not p:
        await query.edit_message_text("❌ Produk tidak ditemukan.")
        return
    durasi = f"\n⏱ Durasi: *{p.durasi_hari} hari*" if p.durasi_hari else ""
    text = (f"📦 *{p.nama}*\n\n📝 {p.deskripsi}{durasi}\n\n"
            f"💰 Harga: *{format_rupiah(p.harga)}*\n"
            f"📊 Stok: {'Tersedia' if p.stok > 0 else '❌ Habis'}")
    keyboard = [
        [InlineKeyboardButton("✅ Pesan Sekarang", callback_data=f"order_{pid}")],
        [InlineKeyboardButton("🔙 Kembali", callback_data=f"kat_{p.kategori}")],
    ]
    await query.edit_message_text(text, reply_markup=InlineKeyboardMarkup(keyboard), parse_mode="Markdown")

async def proses_order(update: Update, context: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    await query.answer()
    pid = query.data.replace("order_", "")
    db  = get_db()
    try:
        p    = db.query(Product).filter_by(id=pid).first()
        pms  = db.query(PaymentMethod).filter_by(aktif=True).all()
    finally:
        db.close()
    if not p or not pms:
        await query.edit_message_text("❌ Tidak ada metode pembayaran aktif. Hubungi admin.")
        return
    context.user_data["order_produk"] = pid
    text = (f"💳 *Pilih Metode Pembayaran*\n\n"
            f"Produk: *{p.nama}*\nTotal: *{format_rupiah(p.harga)}*\n\nPilih cara bayar:")
    keyboard = [[InlineKeyboardButton(f"{tipe_emoji(pm.tipe)} {pm.nama}",
                                       callback_data=f"pay_{pm.id}")] for pm in pms]
    keyboard.append([InlineKeyboardButton("❌ Batal", callback_data="start")])
    await query.edit_message_text(text, reply_markup=InlineKeyboardMarkup(keyboard), parse_mode="Markdown")

async def pilih_payment(update: Update, context: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    await query.answer()
    pmid = query.data.replace("pay_", "")
    pid  = context.user_data.get("order_produk")
    uid  = update.effective_user.id
    db   = get_db()
    try:
        pm = db.query(PaymentMethod).filter_by(id=pmid).first()
        p  = db.query(Product).filter_by(id=pid).first()
        if not pm or not p:
            return
        oid = get_next_order_id(db)
        db.add(Order(id=oid, user_id=uid, produk_id=pid,
                     produk_nama=p.nama, harga=p.harga,
                     payment_id=pmid, payment_nama=pm.nama, status="pending"))
        db.commit()
        pm_foto   = pm.foto
        pm_detail = pm.detail
        pm_tipe   = pm.tipe
        p_nama    = p.nama
        p_harga   = p.harga
    finally:
        db.close()

    context.user_data["pending_order_id"] = oid

    text = (f"📝 *Detail Pembayaran*\n\n"
            f"🔖 ID Order: `{oid}`\n"
            f"📦 Produk: *{p_nama}*\n"
            f"💰 Total: *{format_rupiah(p_harga)}*\n\n"
            f"━━━━━━━━━━━━━━━━\n"
            f"{tipe_emoji(pm_tipe)} *{pm.nama}*\n"
            f"📋 {pm_detail}\n"
            f"━━━━━━━━━━━━━━━━\n\n"
            f"📸 Setelah transfer, *kirim foto bukti* ke sini,\n"
            f"atau ketik `/konfirmasi {oid}` tanpa foto.")
    keyboard = [[InlineKeyboardButton("📋 Pesanan Saya", callback_data="my_orders"),
                 InlineKeyboardButton("🏠 Menu Utama",   callback_data="start")]]

    if pm_foto:
        await query.message.reply_photo(pm_foto, caption=text,
                                         reply_markup=InlineKeyboardMarkup(keyboard),
                                         parse_mode="Markdown")
        await query.delete_message()
    else:
        await query.edit_message_text(text, reply_markup=InlineKeyboardMarkup(keyboard),
                                       parse_mode="Markdown")

    # Notif ke grup admin
    user = update.effective_user
    uname = f"@{user.username}" if user.username else f"ID `{uid}`"
    grup_text = (f"🔔 *ORDER BARU*\n\n"
                 f"🔖 `{oid}`\n"
                 f"👤 {user.full_name} ({uname})\n"
                 f"📦 {p_nama}\n"
                 f"💰 {format_rupiah(p_harga)}\n"
                 f"💳 {pm.nama}\n"
                 f"⏰ {datetime.now(WIB).strftime('%d/%m %H:%M')} WIB\n\n"
                 f"_Menunggu bukti transfer..._")
    grup_keyboard = [[
        InlineKeyboardButton("✅ Konfirmasi", callback_data=f"admin_conf_{oid}"),
        InlineKeyboardButton("❌ Tolak",      callback_data=f"admin_reject_{oid}"),
        InlineKeyboardButton("↩️ Balas User", callback_data=f"grup_balas_{uid}"),
    ]]
    await kirim_notif_grup(context, grup_text, grup_keyboard, order_id=oid)

# ─── TERIMA FOTO BUKTI (USER) ────────────────────────────────────────────────
async def terima_bukti_pembayaran(update: Update, context: ContextTypes.DEFAULT_TYPE):
    uid = update.effective_user.id
    if update.message.photo:
        file_id = update.message.photo[-1].file_id
    elif update.message.document:
        file_id = update.message.document.file_id
    else:
        await update.message.reply_text("Kirim berupa foto ya. 🙏")
        return

    oid = context.user_data.get("pending_order_id")
    db  = get_db()
    try:
        o = (db.query(Order).filter_by(id=oid, user_id=uid).first() if oid
             else db.query(Order).filter_by(user_id=uid, status="pending")
                    .order_by(Order.waktu.desc()).first())
        if not o:
            await update.message.reply_text(
                "❌ Tidak ada order pending. Gunakan /konfirmasi [ID_ORDER].")
            return
        o.bukti_file_id = file_id
        o.status        = "paid"
        oid_save    = o.id
        uid_save    = o.user_id
        produk_nama = o.produk_nama
        harga       = o.harga
        pay_nama    = o.payment_nama
        db.commit()
    finally:
        db.close()

    await update.message.reply_text(
        f"✅ *Bukti pembayaran diterima!*\n\n🔖 `{oid_save}`\nAdmin akan segera verifikasi. 🙏",
        parse_mode="Markdown")

    user  = update.effective_user
    uname = f"@{user.username}" if user.username else f"ID `{uid_save}`"
    caption = (f"💸 *BUKTI BAYAR MASUK*\n\n"
               f"🔖 `{oid_save}`\n"
               f"👤 {user.full_name} ({uname})\n"
               f"📦 {produk_nama}\n"
               f"💰 {format_rupiah(harga)}\n"
               f"💳 {pay_nama}")
    grup_keyboard = [[
        InlineKeyboardButton("✅ Konfirmasi", callback_data=f"admin_conf_{oid_save}"),
        InlineKeyboardButton("❌ Tolak",      callback_data=f"admin_reject_{oid_save}"),
        InlineKeyboardButton("↩️ Balas User", callback_data=f"grup_balas_{uid_save}"),
    ]]
    await kirim_foto_notif_grup(context, file_id, caption, grup_keyboard, order_id=oid_save)
    context.user_data.pop("pending_order_id", None)

# ─── PESANAN & LANGGANAN USER ────────────────────────────────────────────────
async def my_orders(update: Update, context: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    await query.answer()
    uid = update.effective_user.id
    db  = get_db()
    try:
        orders = (db.query(Order).filter_by(user_id=uid)
                    .order_by(Order.waktu.desc()).limit(10).all())
    finally:
        db.close()
    text = "📋 *Pesanan Saya*\n\n"
    if not orders:
        text += "Belum ada pesanan."
    else:
        for o in orders:
            text += (f"{status_emoji(o.status)} `{o.id}` — *{o.produk_nama}*\n"
                     f"   💰 {format_rupiah(o.harga)} | _{o.status.title()}_\n\n")
    await query.edit_message_text(text,
        reply_markup=InlineKeyboardMarkup([[InlineKeyboardButton("🏠 Menu Utama", callback_data="start")]]),
        parse_mode="Markdown")

async def my_subs(update: Update, context: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    await query.answer()
    uid = update.effective_user.id
    now = datetime.utcnow()
    db  = get_db()
    try:
        subs = db.query(Subscription).filter_by(user_id=uid, aktif=True).all()
    finally:
        db.close()
    text = "📅 *Langganan Aktif*\n\n"
    if not subs:
        text += "Tidak ada langganan aktif."
    else:
        for s in subs:
            sisa = (s.selesai - now).days
            text += (f"⭐ *{s.produk_nama}*\n"
                     f"   📅 Berakhir: {s.selesai.strftime('%d %b %Y')}\n"
                     f"   ⏳ Sisa: *{sisa} hari*\n\n")
    await query.edit_message_text(text,
        reply_markup=InlineKeyboardMarkup([[InlineKeyboardButton("🏠 Menu Utama", callback_data="start")]]),
        parse_mode="Markdown")

# ─── ADMIN FUNCTIONS ─────────────────────────────────────────────────────────
async def admin_menu(update: Update, context: ContextTypes.DEFAULT_TYPE):
    uid = update.effective_user.id
    if not is_admin(uid):
        return
    keyboard = [
        [InlineKeyboardButton("📋 Daftar Order",    callback_data="admin_orders"),
         InlineKeyboardButton("📊 Statistik",       callback_data="admin_stats")],
    ]
    if is_owner(uid):
        keyboard.append([InlineKeyboardButton("👑 Menu Owner", callback_data="owner_menu")])
    text = f"🔧 *Panel Admin*\n\nID: `{uid}`\nGrup: `{ADMIN_GROUP_ID}`\n\nPilih aksi:"
    if update.callback_query:
        await update.callback_query.edit_message_text(
            text, reply_markup=InlineKeyboardMarkup(keyboard), parse_mode="Markdown")
    else:
        await update.message.reply_text(
            text, reply_markup=InlineKeyboardMarkup(keyboard), parse_mode="Markdown")

async def admin_list_orders(update: Update, context: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    await query.answer()
    if not is_admin(update.effective_user.id):
        return
    db = get_db()
    try:
        pending = db.query(Order).filter(Order.status.in_(["pending", "paid"])).all()
    finally:
        db.close()
    if not pending:
        text = "📋 Tidak ada order pending."
    else:
        text = f"📋 *Order Pending ({len(pending)})*\n\n"
        for o in pending[-20:]:
            bukti = " 📸" if o.bukti_file_id else ""
            text += (f"{status_emoji(o.status)} `{o.id}` — {o.produk_nama}{bukti}\n"
                     f"   👤 `{o.user_id}` | 💰 {format_rupiah(o.harga)}\n\n")
    await query.edit_message_text(text, reply_markup=back_btn("admin_menu"), parse_mode="Markdown")

async def admin_confirm_order(update: Update, context: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    await query.answer()
    # Boleh dari private maupun grup, tapi tetap cek is_admin
    if not is_admin(update.effective_user.id):
        await query.answer("❌ Hanya admin yang bisa konfirmasi.", show_alert=True)
        return

    oid = query.data.replace("admin_conf_", "")
    db  = get_db()
    try:
        o = db.query(Order).filter_by(id=oid).first()
        if not o:
            await query.answer("❌ Order tidak ditemukan!", show_alert=True)
            return
        if o.status == "completed":
            await query.answer("Order sudah dikonfirmasi sebelumnya.", show_alert=True)
            return
        o.status       = "completed"
        o.confirmed_by = update.effective_user.id
        o.confirmed_at = datetime.utcnow()
        p = db.query(Product).filter_by(id=o.produk_id).first()
        if p and p.durasi_hari:
            now = datetime.utcnow()
            db.add(Subscription(
                user_id=o.user_id, order_id=oid,
                produk_nama=p.nama, mulai=now,
                selesai=now + timedelta(days=p.durasi_hari), aktif=True))
        db.commit()
        uid_user    = o.user_id
        produk_nama = o.produk_nama
        group_msg   = o.group_msg_id
    finally:
        db.close()

    # Notif ke user
    try:
        await context.bot.send_message(
            uid_user,
            f"🎉 *Pembayaran Dikonfirmasi!*\n\n"
            f"🔖 `{oid}`\n📦 *{produk_nama}*\n\n"
            f"Terima kasih! Produk sudah diaktifkan. 🙏",
            parse_mode="Markdown")
    except Exception as e:
        logger.error(f"Gagal notif user: {e}")

    # Edit pesan di grup jadi status selesai
    konfirmator = update.effective_user.full_name
    done_text = f"✅ *DIKONFIRMASI* — `{oid}`\nOleh: {konfirmator}"
    if ADMIN_GROUP_ID and group_msg:
        try:
            await context.bot.edit_message_reply_markup(
                ADMIN_GROUP_ID, group_msg, reply_markup=None)
            await context.bot.send_message(
                ADMIN_GROUP_ID, done_text, parse_mode="Markdown",
                reply_to_message_id=group_msg)
        except:
            pass

    # Edit pesan di private (kalau dari private)
    if update.effective_chat.type == "private":
        await query.edit_message_text(
            f"✅ Order `{oid}` dikonfirmasi! User sudah diberitahu.", parse_mode="Markdown")

async def admin_reject_order(update: Update, context: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    await query.answer()
    if not is_admin(update.effective_user.id):
        await query.answer("❌ Hanya admin yang bisa menolak.", show_alert=True)
        return

    oid = query.data.replace("admin_reject_", "")
    db  = get_db()
    try:
        o = db.query(Order).filter_by(id=oid).first()
        if not o:
            await query.answer("❌ Order tidak ditemukan!", show_alert=True)
            return
        if o.status in ("completed", "cancelled"):
            await query.answer("Order sudah diproses sebelumnya.", show_alert=True)
            return
        o.status   = "cancelled"
        uid_user   = o.user_id
        group_msg  = o.group_msg_id
        db.commit()
    finally:
        db.close()

    try:
        await context.bot.send_message(
            uid_user,
            f"❌ *Order Dibatalkan*\n\n🔖 `{oid}`\n"
            f"Pembayaran tidak terverifikasi. Hubungi admin jika ada pertanyaan.",
            parse_mode="Markdown")
    except:
        pass

    tolak_text = f"❌ *DITOLAK* — `{oid}`\nOleh: {update.effective_user.full_name}"
    if ADMIN_GROUP_ID and group_msg:
        try:
            await context.bot.edit_message_reply_markup(
                ADMIN_GROUP_ID, group_msg, reply_markup=None)
            await context.bot.send_message(
                ADMIN_GROUP_ID, tolak_text, parse_mode="Markdown",
                reply_to_message_id=group_msg)
        except:
            pass

    if update.effective_chat.type == "private":
        await query.edit_message_text(f"❌ Order `{oid}` ditolak.", parse_mode="Markdown")

async def admin_stats(update: Update, context: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    await query.answer()
    db    = get_db()
    try:
        today = datetime.utcnow().date()
        all_o = db.query(Order).filter(func.date(Order.waktu) == today).all()
        rev   = sum(o.harga for o in all_o if o.status == "completed")
        text  = (f"📊 *Statistik Hari Ini* — {today}\n\n"
                 f"📦 Total: {len(all_o)}\n"
                 f"✅ Selesai: {sum(1 for o in all_o if o.status=='completed')}\n"
                 f"⏳ Pending: {sum(1 for o in all_o if o.status in ('pending','paid'))}\n"
                 f"💰 Pendapatan: *{format_rupiah(rev)}*\n\n"
                 f"👥 Total User: {db.query(User).count()}")
    finally:
        db.close()
    await query.edit_message_text(text, reply_markup=back_btn("admin_menu"), parse_mode="Markdown")

# ─── OWNER FUNCTIONS ─────────────────────────────────────────────────────────
async def owner_menu(update: Update, context: ContextTypes.DEFAULT_TYPE):
    uid = update.effective_user.id
    if not is_owner(uid):
        return
    db = get_db()
    try:
        np = db.query(Product).count()
        no = db.query(Order).count()
        nu = db.query(User).count()
    finally:
        db.close()
    keyboard = [
        [InlineKeyboardButton("📦 Kelola Produk",  callback_data="owner_produk"),
         InlineKeyboardButton("💳 Kelola Payment", callback_data="owner_payment")],
        [InlineKeyboardButton("👥 Kelola Admin",   callback_data="owner_admins"),
         InlineKeyboardButton("📊 Laporan",        callback_data="owner_laporan")],
        [InlineKeyboardButton("⚙️ Pengaturan",     callback_data="owner_settings"),
         InlineKeyboardButton("🔧 Panel Admin",    callback_data="admin_menu")],
    ]
    text = (f"👑 *Panel Owner*\n\nProduk: {np} | Order: {no} | User: {nu}\n\n"
            f"🆔 Grup Admin: `{ADMIN_GROUP_ID}`")
    if update.callback_query:
        await update.callback_query.edit_message_text(
            text, reply_markup=InlineKeyboardMarkup(keyboard), parse_mode="Markdown")
    else:
        await update.message.reply_text(
            text, reply_markup=InlineKeyboardMarkup(keyboard), parse_mode="Markdown")

async def owner_kelola_produk(update: Update, context: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    await query.answer()
    if not is_owner(update.effective_user.id):
        return
    db = get_db()
    try:
        prods = db.query(Product).all()
    finally:
        db.close()
    text = "📦 *Kelola Produk*\n\n"
    keyboard = []
    for p in prods:
        text += f"{'✅' if p.aktif else '❌'} `{p.id}` — *{p.nama}* — {format_rupiah(p.harga)}\n"
        keyboard.append([
            InlineKeyboardButton(f"✏️ {p.nama[:15]}", callback_data=f"owner_edit_p_{p.id}"),
            InlineKeyboardButton("🔁 Toggle",          callback_data=f"owner_toggle_p_{p.id}"),
        ])
    keyboard.append([InlineKeyboardButton("🔙 Menu Owner", callback_data="owner_menu")])
    await query.edit_message_text(text, reply_markup=InlineKeyboardMarkup(keyboard), parse_mode="Markdown")

async def owner_toggle_produk(update: Update, context: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    await query.answer()
    pid = query.data.replace("owner_toggle_p_", "")
    db  = get_db()
    try:
        p = db.query(Product).filter_by(id=pid).first()
        if p:
            p.aktif = not p.aktif
            db.commit()
            await query.answer(f"{'Aktif' if p.aktif else 'Nonaktif'}!", show_alert=True)
    finally:
        db.close()
    return await owner_kelola_produk(update, context)

async def owner_edit_produk(update: Update, context: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    await query.answer()
    pid = query.data.replace("owner_edit_p_", "")
    db  = get_db()
    try:
        p = db.query(Product).filter_by(id=pid).first()
        if not p:
            return
        text = (f"✏️ *Edit Produk — {p.nama}*\n\n"
                f"ID: `{p.id}` | Harga: {format_rupiah(p.harga)}\n"
                f"Stok: {p.stok} | Status: {'✅' if p.aktif else '❌'}\n\n"
                f"Perintah edit (ketik di chat private):\n"
                f"`/edit_produk {pid} nama [teks]`\n"
                f"`/edit_produk {pid} harga [angka]`\n"
                f"`/edit_produk {pid} stok [angka]`\n"
                f"`/edit_produk {pid} deskripsi [teks]`")
    finally:
        db.close()
    await query.edit_message_text(text, reply_markup=back_btn("owner_produk"), parse_mode="Markdown")

async def owner_kelola_payment(update: Update, context: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    await query.answer()
    if not is_owner(update.effective_user.id):
        return
    db = get_db()
    try:
        pms = db.query(PaymentMethod).all()
    finally:
        db.close()
    text = "💳 *Kelola Metode Pembayaran*\n\n"
    keyboard = []
    for pm in pms:
        text += f"{'✅' if pm.aktif else '❌'} {tipe_emoji(pm.tipe)} *{pm.nama}*\n   {pm.detail}\n\n"
        row = [
            InlineKeyboardButton(f"✏️ {pm.nama}", callback_data=f"owner_edit_pm_{pm.id}"),
            InlineKeyboardButton("🔁 Toggle",      callback_data=f"owner_toggle_pm_{pm.id}"),
        ]
        if pm.tipe == "qris":
            row.append(InlineKeyboardButton("📷 Upload QRIS", callback_data=f"owner_upload_qris_{pm.id}"))
        keyboard.append(row)
    keyboard.append([InlineKeyboardButton("🔙 Menu Owner", callback_data="owner_menu")])
    await query.edit_message_text(text, reply_markup=InlineKeyboardMarkup(keyboard), parse_mode="Markdown")

async def owner_toggle_payment(update: Update, context: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    await query.answer()
    pmid = query.data.replace("owner_toggle_pm_", "")
    db   = get_db()
    try:
        pm = db.query(PaymentMethod).filter_by(id=pmid).first()
        if pm:
            pm.aktif = not pm.aktif
            db.commit()
            await query.answer(f"{'Aktif' if pm.aktif else 'Nonaktif'}!", show_alert=True)
    finally:
        db.close()
    return await owner_kelola_payment(update, context)

async def owner_edit_payment(update: Update, context: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    await query.answer()
    pmid = query.data.replace("owner_edit_pm_", "")
    db   = get_db()
    try:
        pm = db.query(PaymentMethod).filter_by(id=pmid).first()
        if not pm:
            return
        text = (f"✏️ *Edit Payment — {pm.nama}*\n\n"
                f"ID: `{pm.id}` | Tipe: {pm.tipe}\n"
                f"Detail: {pm.detail}\n\n"
                f"Perintah edit:\n"
                f"`/edit_payment {pmid} nama [teks]`\n"
                f"`/edit_payment {pmid} detail [teks]`")
    finally:
        db.close()
    await query.edit_message_text(text, reply_markup=back_btn("owner_payment"), parse_mode="Markdown")

async def owner_request_upload_qris(update: Update, context: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    await query.answer()
    if not is_owner(update.effective_user.id):
        return
    pmid = query.data.replace("owner_upload_qris_", "")
    context.user_data["upload_qris_pmid"] = pmid
    db = get_db()
    try:
        pm = db.query(PaymentMethod).filter_by(id=pmid).first()
        nama = pm.nama if pm else pmid
    finally:
        db.close()
    await query.edit_message_text(
        f"📷 *Upload Foto QRIS — {nama}*\n\nKirimkan foto QR code sekarang.",
        reply_markup=back_btn("owner_payment"), parse_mode="Markdown")

async def owner_terima_foto_qris(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if not is_owner(update.effective_user.id):
        return
    if not update.message.photo:
        await update.message.reply_text("Kirim berupa foto. 🙏")
        return
    pmid    = context.user_data.pop("upload_qris_pmid", None)
    file_id = update.message.photo[-1].file_id
    db = get_db()
    try:
        pm = db.query(PaymentMethod).filter_by(id=pmid).first()
        if pm:
            pm.foto = file_id
            db.commit()
            nama = pm.nama
        else:
            nama = pmid
    finally:
        db.close()
    await update.message.reply_text(
        f"✅ Foto QRIS *{nama}* berhasil diupload!", parse_mode="Markdown")

async def owner_kelola_admin(update: Update, context: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    await query.answer()
    db = get_db()
    try:
        admins = db.query(User).filter_by(is_admin=True).all()
    finally:
        db.close()
    text = "👥 *Kelola Admin*\n\n"
    text += "\n".join([f"• `{a.id}` — {a.nama}" for a in admins]) or "Belum ada admin."
    text += "\n\n`/tambah_admin [user_id]`\n`/hapus_admin [user_id]`"
    await query.edit_message_text(text, reply_markup=back_btn("owner_menu"), parse_mode="Markdown")

async def owner_laporan(update: Update, context: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    await query.answer()
    db = get_db()
    try:
        all_o = db.query(Order).all()
        done  = [o for o in all_o if o.status == "completed"]
        rev   = sum(o.harga for o in done)
        best_nama, best_cnt = "-", 0
        if done:
            c = Counter(o.produk_id for o in done)
            best_pid, best_cnt = c.most_common(1)[0]
            bp = db.query(Product).filter_by(id=best_pid).first()
            best_nama = bp.nama if bp else best_pid
        n_subs = db.query(Subscription).filter_by(aktif=True).count()
    finally:
        db.close()
    text = (f"📊 *Laporan Lengkap*\n\n"
            f"📦 Total Order: {len(all_o)}\n"
            f"✅ Selesai: {len(done)}\n"
            f"⏳ Pending: {sum(1 for o in all_o if o.status in ('pending','paid'))}\n"
            f"❌ Batal: {sum(1 for o in all_o if o.status=='cancelled')}\n\n"
            f"💰 Total Pendapatan: *{format_rupiah(rev)}*\n"
            f"🏆 Produk Terlaris: *{best_nama}* ({best_cnt}x)\n"
            f"📅 Langganan Aktif: {n_subs}")
    await query.edit_message_text(text, reply_markup=back_btn("owner_menu"), parse_mode="Markdown")

async def owner_settings(update: Update, context: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    await query.answer()
    await query.edit_message_text(
        "⚙️ *Pengaturan Bot*\n\n"
        "Ubah pesan sambutan:\n`/set_welcome [pesan baru]`\n\n"
        "Broadcast ke semua user:\n`/broadcast [pesan]`",
        reply_markup=back_btn("owner_menu"), parse_mode="Markdown")

# ─── COMMAND HANDLERS ────────────────────────────────────────────────────────
async def cmd_konfirmasi(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if update.effective_chat.type != "private":
        return
    if not context.args:
        await update.message.reply_text(
            "Gunakan: `/konfirmasi [ID_ORDER]`\nAtau kirim foto bukti transfer.",
            parse_mode="Markdown")
        return
    oid = context.args[0].upper()
    uid = update.effective_user.id
    db  = get_db()
    try:
        o = db.query(Order).filter_by(id=oid).first()
        if not o:
            await update.message.reply_text("❌ ID Order tidak ditemukan.")
            return
        if o.user_id != uid:
            await update.message.reply_text("❌ Order ini bukan milik kamu.")
            return
        if o.status != "pending":
            await update.message.reply_text(f"Status order: *{o.status}*", parse_mode="Markdown")
            return
        o.status    = "paid"
        produk_nama = o.produk_nama
        harga       = o.harga
        pay_nama    = o.payment_nama
        db.commit()
    finally:
        db.close()

    await update.message.reply_text(
        f"✅ Konfirmasi `{oid}` diterima! Admin akan segera verifikasi. 🙏",
        parse_mode="Markdown")

    user  = update.effective_user
    uname = f"@{user.username}" if user.username else f"ID `{uid}`"
    grup_text = (f"💰 *KONFIRMASI BAYAR (tanpa foto)*\n\n"
                 f"🔖 `{oid}`\n"
                 f"👤 {user.full_name} ({uname})\n"
                 f"📦 {produk_nama}\n"
                 f"💰 {format_rupiah(harga)} via {pay_nama}")
    grup_keyboard = [[
        InlineKeyboardButton("✅ Konfirmasi", callback_data=f"admin_conf_{oid}"),
        InlineKeyboardButton("❌ Tolak",      callback_data=f"admin_reject_{oid}"),
        InlineKeyboardButton("↩️ Balas User", callback_data=f"grup_balas_{uid}"),
    ]]
    await kirim_notif_grup(context, grup_text, grup_keyboard, order_id=oid)

async def cmd_tambah_admin(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if not is_owner(update.effective_user.id):
        return
    if not context.args:
        await update.message.reply_text("Gunakan: `/tambah_admin [user_id]`", parse_mode="Markdown")
        return
    new_id = int(context.args[0])
    db = get_db()
    try:
        u = db.query(User).filter_by(id=new_id).first()
        if not u:
            db.add(User(id=new_id, nama=f"Admin_{new_id}"))
            db.flush()
            u = db.query(User).filter_by(id=new_id).first()
        u.is_admin = True
        db.commit()
    finally:
        db.close()
    await update.message.reply_text(f"✅ Admin `{new_id}` ditambahkan!", parse_mode="Markdown")

async def cmd_hapus_admin(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if not is_owner(update.effective_user.id):
        return
    if not context.args:
        await update.message.reply_text("Gunakan: `/hapus_admin [user_id]`", parse_mode="Markdown")
        return
    rem_id = int(context.args[0])
    db = get_db()
    try:
        u = db.query(User).filter_by(id=rem_id).first()
        if u and u.is_admin:
            u.is_admin = False
            db.commit()
            await update.message.reply_text(f"✅ Admin `{rem_id}` dihapus!", parse_mode="Markdown")
        else:
            await update.message.reply_text("⚠️ Bukan admin.")
    finally:
        db.close()

async def cmd_broadcast(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if not is_owner(update.effective_user.id):
        return
    msg = " ".join(context.args)
    if not msg:
        await update.message.reply_text("Gunakan: `/broadcast [pesan]`", parse_mode="Markdown")
        return
    db = get_db()
    try:
        users = db.query(User).all()
    finally:
        db.close()
    ok = 0
    for u in users:
        try:
            await context.bot.send_message(u.id, f"📢 *Broadcast*\n\n{msg}", parse_mode="Markdown")
            ok += 1
        except:
            pass
    await update.message.reply_text(f"✅ Terkirim ke {ok} user.")

async def cmd_set_welcome(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if not is_owner(update.effective_user.id):
        return
    msg = " ".join(context.args)
    if not msg:
        await update.message.reply_text("Gunakan: `/set_welcome [pesan]`", parse_mode="Markdown")
        return
    context.bot_data["welcome_msg"] = msg
    await update.message.reply_text(f"✅ Pesan sambutan diubah:\n\n_{msg}_", parse_mode="Markdown")

async def cmd_edit_produk(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if not is_owner(update.effective_user.id):
        return
    args = context.args
    if len(args) < 3:
        await update.message.reply_text(
            "Gunakan: `/edit_produk [ID] [field] [nilai]`\nField: nama, harga, stok, deskripsi",
            parse_mode="Markdown")
        return
    pid, field, nilai = args[0].upper(), args[1].lower(), " ".join(args[2:])
    db = get_db()
    try:
        p = db.query(Product).filter_by(id=pid).first()
        if not p:
            await update.message.reply_text("❌ Produk tidak ditemukan.")
            return
        if field == "nama":        p.nama      = nilai
        elif field == "harga":     p.harga     = int(nilai.replace(".", "").replace(",", ""))
        elif field == "stok":      p.stok      = int(nilai)
        elif field == "deskripsi": p.deskripsi = nilai
        else:
            await update.message.reply_text("❌ Field tidak valid.")
            return
        db.commit()
        await update.message.reply_text(f"✅ Produk `{pid}` — `{field}` diupdate!", parse_mode="Markdown")
    finally:
        db.close()

async def cmd_edit_payment(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if not is_owner(update.effective_user.id):
        return
    args = context.args
    if len(args) < 3:
        await update.message.reply_text(
            "Gunakan: `/edit_payment [ID] [field] [nilai]`\nField: nama, detail",
            parse_mode="Markdown")
        return
    pmid, field, nilai = args[0].upper(), args[1].lower(), " ".join(args[2:])
    db = get_db()
    try:
        pm = db.query(PaymentMethod).filter_by(id=pmid).first()
        if not pm:
            await update.message.reply_text("❌ Payment tidak ditemukan.")
            return
        if field == "nama":     pm.nama   = nilai
        elif field == "detail": pm.detail = nilai
        else:
            await update.message.reply_text("❌ Field tidak valid.")
            return
        db.commit()
        await update.message.reply_text(f"✅ Payment `{pmid}` — `{field}` diupdate!", parse_mode="Markdown")
    finally:
        db.close()

async def help_menu(update: Update, context: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    if query:
        await query.answer()
    text = ("❓ *Bantuan*\n\n"
            "📌 *Cara Order:*\n"
            "1. Pilih produk\n"
            "2. Pilih metode pembayaran\n"
            "3. Transfer sesuai nominal\n"
            "4. Kirim *foto bukti transfer* ke sini\n"
            "   atau `/konfirmasi [ID_ORDER]`\n\n"
            "💬 *Chat Admin:* Pilih menu Chat dengan Admin\n\n"
            "`/start` — Menu utama")
    keyboard = [[InlineKeyboardButton("🏠 Menu Utama", callback_data="start")]]
    if query:
        await query.edit_message_text(text, reply_markup=InlineKeyboardMarkup(keyboard), parse_mode="Markdown")
    else:
        await update.message.reply_text(text, reply_markup=InlineKeyboardMarkup(keyboard), parse_mode="Markdown")

# ─── AUTO-EXPIRE JOB ─────────────────────────────────────────────────────────
async def job_cek_expire(context: ContextTypes.DEFAULT_TYPE):
    now = datetime.utcnow()
    db  = get_db()
    try:
        for s in db.query(Subscription).filter_by(aktif=True).all():
            sisa = (s.selesai - now).total_seconds() / 86400
            if 2 <= sisa < 3 and not s.notif_3hari:
                try:
                    await context.bot.send_message(
                        s.user_id,
                        f"⚠️ *Langganan Hampir Habis!*\n\n"
                        f"📦 *{s.produk_nama}*\n"
                        f"⏳ Berakhir dalam *3 hari* ({s.selesai.strftime('%d %b %Y')})\n\n"
                        f"Perpanjang sekarang! Ketik /start 🙏",
                        parse_mode="Markdown")
                    s.notif_3hari = True
                except Exception as e:
                    logger.error(f"Notif H-3 gagal {s.user_id}: {e}")
            elif 0 < sisa < 1 and not s.notif_1hari:
                try:
                    await context.bot.send_message(
                        s.user_id,
                        f"🚨 *Langganan Berakhir Besok!*\n\n"
                        f"📦 *{s.produk_nama}*\n"
                        f"Perpanjang *sekarang* sebelum akses terputus!\n/start",
                        parse_mode="Markdown")
                    s.notif_1hari = True
                except Exception as e:
                    logger.error(f"Notif H-1 gagal {s.user_id}: {e}")
            elif sisa <= 0:
                s.aktif = False
                try:
                    await context.bot.send_message(
                        s.user_id,
                        f"❌ *Langganan Berakhir*\n\n📦 *{s.produk_nama}* sudah berakhir.\n"
                        f"Perpanjang di /start 🙏",
                        parse_mode="Markdown")
                except Exception as e:
                    logger.error(f"Notif expired gagal {s.user_id}: {e}")
        db.commit()
    finally:
        db.close()

# ─── CALLBACK ROUTER ─────────────────────────────────────────────────────────
async def callback_router(update: Update, context: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    await query.answer()
    data  = query.data

    routes = {
        "start":          start,
        "my_orders":      my_orders,
        "my_subs":        my_subs,
        "help":           help_menu,
        "chat_admin":     chat_admin_menu,
        "admin_menu":     admin_menu,
        "admin_orders":   admin_list_orders,
        "admin_input_pay":admin_list_orders,
        "admin_stats":    admin_stats,
        "owner_menu":     owner_menu,
        "owner_produk":   owner_kelola_produk,
        "owner_payment":  owner_kelola_payment,
        "owner_admins":   owner_kelola_admin,
        "owner_laporan":  owner_laporan,
        "owner_settings": owner_settings,
    }
    if data in routes:
        return await routes[data](update, context)
    elif data.startswith("kat_"):               return await show_kategori(update, context)
    elif data.startswith("produk_"):            return await show_produk(update, context)
    elif data.startswith("order_"):             return await proses_order(update, context)
    elif data.startswith("pay_"):               return await pilih_payment(update, context)
    elif data.startswith("admin_conf_"):        return await admin_confirm_order(update, context)
    elif data.startswith("admin_reject_"):      return await admin_reject_order(update, context)
    elif data.startswith("owner_toggle_p_"):    return await owner_toggle_produk(update, context)
    elif data.startswith("owner_toggle_pm_"):   return await owner_toggle_payment(update, context)
    elif data.startswith("owner_upload_qris_"): return await owner_request_upload_qris(update, context)
    elif data.startswith("owner_edit_p_"):      return await owner_edit_produk(update, context)
    elif data.startswith("owner_edit_pm_"):     return await owner_edit_payment(update, context)
    elif data.startswith("grup_balas_"):        return await grup_tombol_balas(update, context)
    else:
        logger.warning(f"Unhandled callback: {data}")

# ─── FOTO DISPATCHER ─────────────────────────────────────────────────────────
async def foto_dispatcher(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Satu handler foto: owner upload QRIS (jika ada flag) atau user kirim bukti bayar."""
    if update.effective_chat.type != "private":
        return
    uid = update.effective_user.id
    if is_owner(uid) and context.user_data.get("upload_qris_pmid"):
        return await owner_terima_foto_qris(update, context)
    return await terima_bukti_pembayaran(update, context)

# ─── HANDLER PESAN TEKS USER PRIVATE ────────────────────────────────────────
async def pesan_teks_private(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Teks dari user di private — forward ke grup admin jika dalam mode chat_admin."""
    if update.effective_chat.type != "private":
        return
    uid  = update.effective_user.id
    mode = context.user_data.get("mode")

    # Jika admin sedang dalam mode balas, tangani di sini (bukan di handler grup)
    if mode == "balas_user" and is_admin(uid):
        # Admin balas dari private (bukan dari grup) — jarang tapi bisa terjadi
        target = context.user_data.get("balas_target")
        if target:
            admin_nama = update.effective_user.full_name
            try:
                await context.bot.send_message(
                    target,
                    f"💬 *Balasan dari Admin*\n\n{update.message.text}\n\n_— {admin_nama}_",
                    parse_mode="Markdown")
                await update.message.reply_text(f"✅ Terkirim ke user `{target}`.")
            except Exception as e:
                await update.message.reply_text(f"❌ Gagal kirim: {e}")
            context.user_data.pop("balas_target", None)
            context.user_data.pop("mode", None)
            return

    if mode == "chat_admin":
        await user_kirim_pesan_ke_admin(update, context)

# ─── MAIN ────────────────────────────────────────────────────────────────────
def main():
    init_db()

    app = Application.builder().token(BOT_TOKEN).build()

    # ── Command handlers ──────────────────────────────────────
    for cmd, fn in [
        ("start",        start),
        ("konfirmasi",   cmd_konfirmasi),
        ("tambah_admin", cmd_tambah_admin),
        ("hapus_admin",  cmd_hapus_admin),
        ("broadcast",    cmd_broadcast),
        ("set_welcome",  cmd_set_welcome),
        ("edit_produk",  cmd_edit_produk),
        ("edit_payment", cmd_edit_payment),
        ("admin",        admin_menu),
        ("owner",        owner_menu),
        ("balas",        cmd_balas),          # /balas [uid] [pesan] — dari grup/private
    ]:
        app.add_handler(CommandHandler(cmd, fn))

    # ── Callback (tombol inline) ──────────────────────────────
    app.add_handler(CallbackQueryHandler(callback_router))

    # ── Foto dari private (bukti bayar / upload QRIS) ─────────
    app.add_handler(MessageHandler(
        filters.ChatType.PRIVATE & (filters.PHOTO | filters.Document.IMAGE),
        foto_dispatcher))

    # ── Teks dari user private → chat admin ───────────────────
    app.add_handler(MessageHandler(
        filters.ChatType.PRIVATE & filters.TEXT & ~filters.COMMAND,
        pesan_teks_private))

    # ── Teks dari admin di grup → balas ke user ───────────────
    app.add_handler(MessageHandler(
        filters.Chat(ADMIN_GROUP_ID) & filters.TEXT & ~filters.COMMAND,
        grup_admin_ketik_balasan))

    # ── Job auto-expire setiap jam ────────────────────────────
    app.job_queue.run_repeating(job_cek_expire, interval=3600, first=60)

    print(f"🤖 Bot Store v3 berjalan | Grup Admin: {ADMIN_GROUP_ID}")
    app.run_polling(allowed_updates=Update.ALL_TYPES)

if __name__ == "__main__":
    main()
