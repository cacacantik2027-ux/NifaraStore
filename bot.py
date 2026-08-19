"""
=============================================================
  TELEGRAM BOT STORE - UPGRADED SYSTEM
  Tambahan:
  - Database PostgreSQL (Railway Volume)
  - Upload bukti QRIS/transfer dari user
  - Auto-expire langganan + notifikasi mendekati expire
=============================================================
"""

import os
import io
import logging
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from telegram import (
    Update, InlineKeyboardButton, InlineKeyboardMarkup,
)
from telegram.ext import (
    Application, CommandHandler, CallbackQueryHandler,
    MessageHandler, filters, ContextTypes, ConversationHandler
)

# Database
from sqlalchemy import (
    create_engine, Column, Integer, BigInteger, String,
    Boolean, DateTime, Text, ForeignKey, func
)
from sqlalchemy.orm import declarative_base, sessionmaker, Session
from sqlalchemy.exc import IntegrityError

# ─── KONFIGURASI ─────────────────────────────────────────────
BOT_TOKEN   = os.getenv("BOT_TOKEN", "ISI_TOKEN_BOT_KAMU")
OWNER_IDS   = list(map(int, os.getenv("OWNER_IDS", "123456789").split(",")))
DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./bot_store.db")
# Railway otomatis set DATABASE_URL untuk PostgreSQL.
# Kalau pakai PostgreSQL, ganti prefix "postgres://" → "postgresql+psycopg2://"
if DATABASE_URL.startswith("postgres://"):
    DATABASE_URL = DATABASE_URL.replace("postgres://", "postgresql+psycopg2://", 1)

WIB = ZoneInfo("Asia/Jakarta")

logging.basicConfig(
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
    level=logging.INFO
)
logger = logging.getLogger(__name__)

# ─── DATABASE SETUP ───────────────────────────────────────────
Base = declarative_base()
engine = create_engine(DATABASE_URL, pool_pre_ping=True)
SessionLocal = sessionmaker(bind=engine)

def get_db() -> Session:
    return SessionLocal()

class User(Base):
    __tablename__ = "users"
    id         = Column(BigInteger, primary_key=True)   # Telegram user_id
    nama       = Column(String(255))
    username   = Column(String(255), nullable=True)
    join_at    = Column(DateTime, default=datetime.utcnow)
    is_admin   = Column(Boolean, default=False)

class Product(Base):
    __tablename__ = "products"
    id           = Column(String(10), primary_key=True)   # P001, P002 ...
    nama         = Column(String(255))
    deskripsi    = Column(Text)
    harga        = Column(Integer)
    kategori     = Column(String(50))   # fitur | premium
    stok         = Column(Integer, default=999)
    aktif        = Column(Boolean, default=True)
    durasi_hari  = Column(Integer, nullable=True)   # untuk produk premium

class PaymentMethod(Base):
    __tablename__ = "payment_methods"
    id     = Column(String(10), primary_key=True)   # PM001 ...
    nama   = Column(String(100))
    tipe   = Column(String(20))   # qris | bank | ewallet
    detail = Column(Text)
    aktif  = Column(Boolean, default=True)
    foto   = Column(String(255), nullable=True)     # Telegram file_id foto QRIS

class Order(Base):
    __tablename__ = "orders"
    id            = Column(String(20), primary_key=True)   # ORD1001
    user_id       = Column(BigInteger, ForeignKey("users.id"))
    produk_id     = Column(String(10), ForeignKey("products.id"))
    produk_nama   = Column(String(255))
    harga         = Column(Integer)
    payment_id    = Column(String(10), ForeignKey("payment_methods.id"))
    payment_nama  = Column(String(100))
    status        = Column(String(30), default="pending")
    # pending → paid → completed | cancelled
    waktu         = Column(DateTime, default=datetime.utcnow)
    bukti_file_id = Column(String(255), nullable=True)   # file_id foto bukti
    catatan       = Column(Text, nullable=True)
    confirmed_by  = Column(BigInteger, nullable=True)
    confirmed_at  = Column(DateTime, nullable=True)

class Subscription(Base):
    """Tabel langganan premium — terpisah dari orders supaya mudah dicek."""
    __tablename__ = "subscriptions"
    id          = Column(Integer, primary_key=True, autoincrement=True)
    user_id     = Column(BigInteger, ForeignKey("users.id"))
    order_id    = Column(String(20), ForeignKey("orders.id"))
    produk_nama = Column(String(255))
    mulai       = Column(DateTime)
    selesai     = Column(DateTime)
    aktif       = Column(Boolean, default=True)
    notif_3hari = Column(Boolean, default=False)   # sudah kirim notif H-3?
    notif_1hari = Column(Boolean, default=False)   # sudah kirim notif H-1?

def init_db():
    """Buat tabel dan isi data awal jika belum ada."""
    Base.metadata.create_all(bind=engine)
    db = get_db()
    try:
        # Seed produk
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
        # Seed payment methods
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

# ─── CONVERSATION STATES ─────────────────────────────────────
(
    MENU, PILIH_KATEGORI, PILIH_PRODUK, KONFIRMASI_ORDER,
    ADMIN_MENU, ADMIN_INPUT_ORDER_ID,
    OWNER_MENU,
    # State baru: menunggu upload bukti
    TUNGGU_BUKTI,
    # State baru: owner upload foto QRIS
    OWNER_UPLOAD_QRIS,
) = range(9)

# ─── HELPER ───────────────────────────────────────────────────
def is_owner(uid: int) -> bool:
    return uid in OWNER_IDS

def is_admin(uid: int) -> bool:
    if is_owner(uid):
        return True
    db = get_db()
    try:
        u = db.query(User).filter_by(id=uid, is_admin=True).first()
        return u is not None
    finally:
        db.close()

def format_rupiah(n: int) -> str:
    return f"Rp {n:,.0f}".replace(",", ".")

def status_emoji(s: str) -> str:
    return {"pending": "⏳", "paid": "💸", "confirmed": "✅",
            "completed": "🎉", "cancelled": "❌"}.get(s, "❓")

def tipe_emoji(t: str) -> str:
    return {"qris": "📱", "bank": "🏦", "ewallet": "💰"}.get(t, "💳")

def back_btn(target: str) -> InlineKeyboardMarkup:
    label = {"start": "🏠 Menu Utama", "admin_menu": "🔙 Panel Admin",
             "owner_menu": "👑 Menu Owner"}.get(target, "🔙 Kembali")
    return InlineKeyboardMarkup([[InlineKeyboardButton(label, callback_data=target)]])

def get_next_order_id(db: Session) -> str:
    last = db.query(Order).order_by(Order.id.desc()).first()
    if not last:
        return "ORD1001"
    num = int(last.id.replace("ORD", "")) + 1
    return f"ORD{num}"

def get_all_admin_ids(db: Session) -> list:
    admins = db.query(User).filter_by(is_admin=True).all()
    ids = [u.id for u in admins]
    for oid in OWNER_IDS:
        if oid not in ids:
            ids.append(oid)
    return ids

# ─── START / MENU USER ───────────────────────────────────────
async def start(update: Update, context: ContextTypes.DEFAULT_TYPE):
    user = update.effective_user
    uid  = user.id

    db = get_db()
    try:
        existing = db.query(User).filter_by(id=uid).first()
        if not existing:
            db.add(User(id=uid, nama=user.full_name, username=user.username))
            db.commit()
    finally:
        db.close()

    if is_owner(uid):
        return await owner_menu(update, context)
    if is_admin(uid):
        return await admin_menu(update, context)

    keyboard = [
        [InlineKeyboardButton("🛒 Beli Fitur", callback_data="kat_fitur"),
         InlineKeyboardButton("⭐ Langganan Premium", callback_data="kat_premium")],
        [InlineKeyboardButton("📋 Pesanan Saya", callback_data="my_orders"),
         InlineKeyboardButton("📅 Langganan Aktif", callback_data="my_subs")],
        [InlineKeyboardButton("💬 Bantuan", callback_data="help")],
    ]
    text = (f"👋 Halo, *{user.first_name}*!\n\n"
            "Selamat datang di Bot Store! 🛍️\n\nSilakan pilih menu:")
    if update.callback_query:
        await update.callback_query.edit_message_text(
            text, reply_markup=InlineKeyboardMarkup(keyboard), parse_mode="Markdown")
    else:
        await update.message.reply_text(
            text, reply_markup=InlineKeyboardMarkup(keyboard), parse_mode="Markdown")
    return MENU

# ─── PRODUK ───────────────────────────────────────────────────
async def show_kategori(update: Update, context: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    await query.answer()
    kategori = query.data.replace("kat_", "")

    db = get_db()
    try:
        produk_list = db.query(Product).filter_by(kategori=kategori, aktif=True).all()
    finally:
        db.close()

    if not produk_list:
        await query.edit_message_text("❌ Tidak ada produk tersedia.", reply_markup=back_btn("start"))
        return MENU

    label = "Fitur" if kategori == "fitur" else "Langganan Premium"
    ikon  = "🛒" if kategori == "fitur" else "⭐"
    text  = f"{ikon} *Daftar {label}*\n\n"
    keyboard = []
    for p in produk_list:
        text += f"• *{p.nama}* — {format_rupiah(p.harga)}\n"
        keyboard.append([InlineKeyboardButton(
            f"{p.nama} — {format_rupiah(p.harga)}", callback_data=f"produk_{p.id}")])
    keyboard.append([InlineKeyboardButton("🔙 Kembali", callback_data="start")])
    await query.edit_message_text(text, reply_markup=InlineKeyboardMarkup(keyboard), parse_mode="Markdown")
    return PILIH_KATEGORI

async def show_produk(update: Update, context: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    await query.answer()
    pid = query.data.replace("produk_", "")

    db = get_db()
    try:
        p = db.query(Product).filter_by(id=pid).first()
    finally:
        db.close()

    if not p:
        await query.edit_message_text("❌ Produk tidak ditemukan.")
        return MENU

    durasi = f"\n⏱ Durasi: *{p.durasi_hari} hari*" if p.durasi_hari else ""
    text = (f"📦 *{p.nama}*\n\n"
            f"📝 {p.deskripsi}{durasi}\n\n"
            f"💰 Harga: *{format_rupiah(p.harga)}*\n"
            f"📊 Stok: {'Tersedia' if p.stok > 0 else '❌ Habis'}")
    keyboard = [
        [InlineKeyboardButton("✅ Pesan Sekarang", callback_data=f"order_{pid}")],
        [InlineKeyboardButton("🔙 Kembali", callback_data=f"kat_{p.kategori}")],
    ]
    await query.edit_message_text(text, reply_markup=InlineKeyboardMarkup(keyboard), parse_mode="Markdown")
    return PILIH_PRODUK

async def proses_order(update: Update, context: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    await query.answer()
    pid = query.data.replace("order_", "")

    db = get_db()
    try:
        p       = db.query(Product).filter_by(id=pid).first()
        payments = db.query(PaymentMethod).filter_by(aktif=True).all()
    finally:
        db.close()

    if not p:
        return MENU
    if not payments:
        await query.edit_message_text("❌ Tidak ada metode pembayaran aktif. Hubungi admin.")
        return MENU

    context.user_data["order_produk"] = pid
    text = (f"💳 *Pilih Metode Pembayaran*\n\n"
            f"Produk: *{p.nama}*\n"
            f"Total: *{format_rupiah(p.harga)}*\n\nPilih cara bayar:")
    keyboard = [[InlineKeyboardButton(
        f"{tipe_emoji(pm.tipe)} {pm.nama}", callback_data=f"pay_{pm.id}")] for pm in payments]
    keyboard.append([InlineKeyboardButton("❌ Batal", callback_data="start")])
    await query.edit_message_text(text, reply_markup=InlineKeyboardMarkup(keyboard), parse_mode="Markdown")
    return KONFIRMASI_ORDER

async def pilih_payment(update: Update, context: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    await query.answer()
    pmid = query.data.replace("pay_", "")
    pid  = context.user_data.get("order_produk")

    db = get_db()
    try:
        pm = db.query(PaymentMethod).filter_by(id=pmid).first()
        p  = db.query(Product).filter_by(id=pid).first()
        if not pm or not p:
            return MENU

        oid   = get_next_order_id(db)
        uid   = update.effective_user.id
        order = Order(
            id=oid, user_id=uid, produk_id=pid,
            produk_nama=p.nama, harga=p.harga,
            payment_id=pmid, payment_nama=pm.nama,
            status="pending",
        )
        db.add(order)
        db.commit()

        context.user_data["order_id"] = oid
        order_data = {
            "id": oid, "user_id": uid, "produk_nama": p.nama,
            "harga": p.harga, "payment_nama": pm.nama,
            "pm_tipe": pm.tipe, "pm_detail": pm.detail, "pm_foto": pm.foto,
        }
    finally:
        db.close()

    text = (f"📝 *Detail Pembayaran*\n\n"
            f"🔖 ID Order: `{oid}`\n"
            f"📦 Produk: *{p.nama}*\n"
            f"💰 Total: *{format_rupiah(p.harga)}*\n\n"
            f"━━━━━━━━━━━━━━━━\n"
            f"{tipe_emoji(pm.tipe)} *{pm.nama}*\n"
            f"📋 {pm.detail}\n"
            f"━━━━━━━━━━━━━━━━\n\n"
            f"📸 Setelah transfer, kirim *foto bukti pembayaran* ke chat ini,\n"
            f"atau ketik `/konfirmasi {oid}` tanpa foto.\n\n"
            f"_ID Order kamu: `{oid}`_")
    keyboard = [[InlineKeyboardButton("📋 Pesanan Saya", callback_data="my_orders"),
                 InlineKeyboardButton("🏠 Menu Utama",  callback_data="start")]]

    if pm.foto:
        await query.message.reply_photo(pm.foto, caption=text,
                                         reply_markup=InlineKeyboardMarkup(keyboard),
                                         parse_mode="Markdown")
        await query.delete_message()
    else:
        await query.edit_message_text(text, reply_markup=InlineKeyboardMarkup(keyboard),
                                       parse_mode="Markdown")

    # Simpan order_id di user_data supaya bisa terima foto bukti berikutnya
    context.user_data["pending_order_id"] = oid

    await notif_admin_new_order(context, order_data)
    return TUNGGU_BUKTI   # ← tunggu foto bukti dari user

# ─── TERIMA FOTO BUKTI TRANSFER ───────────────────────────────
async def terima_bukti_pembayaran(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Handler foto/dokumen yang dikirim user sebagai bukti bayar."""
    uid = update.effective_user.id

    # Ambil file_id
    if update.message.photo:
        file_id = update.message.photo[-1].file_id
    elif update.message.document:
        file_id = update.message.document.file_id
    else:
        await update.message.reply_text("Kirim berupa foto ya, bukan file lain. 🙏")
        return TUNGGU_BUKTI

    oid = context.user_data.get("pending_order_id")

    db = get_db()
    try:
        # Kalau ada order pending milik user ini, hubungkan ke order itu
        if oid:
            o = db.query(Order).filter_by(id=oid, user_id=uid).first()
        else:
            # Cari order pending terbaru milik user ini
            o = (db.query(Order)
                   .filter_by(user_id=uid, status="pending")
                   .order_by(Order.waktu.desc())
                   .first())

        if not o:
            await update.message.reply_text(
                "❌ Tidak ada order pending yang aktif. "
                "Gunakan /konfirmasi [ID_ORDER] jika sudah membayar.")
            return MENU

        o.bukti_file_id = file_id
        o.status        = "paid"
        oid_save        = o.id
        user_id_save    = o.user_id
        produk_nama     = o.produk_nama
        harga           = o.harga
        payment_nama    = o.payment_nama
        db.commit()
        admin_ids = get_all_admin_ids(db)
    finally:
        db.close()

    await update.message.reply_text(
        f"✅ *Bukti pembayaran diterima!*\n\n"
        f"🔖 ID Order: `{oid_save}`\n"
        f"Admin akan segera memverifikasi. Terima kasih! 🙏",
        parse_mode="Markdown")

    # Kirim notif + foto bukti ke semua admin
    keyboard = [[
        InlineKeyboardButton("✅ Konfirmasi", callback_data=f"admin_conf_{oid_save}"),
        InlineKeyboardButton("❌ Tolak",      callback_data=f"admin_reject_{oid_save}")
    ]]
    caption = (f"💸 *BUKTI BAYAR MASUK*\n\n"
               f"🔖 ID: `{oid_save}`\n"
               f"👤 User: `{user_id_save}`\n"
               f"📦 Produk: {produk_nama}\n"
               f"💰 Nominal: {format_rupiah(harga)}\n"
               f"💳 Via: {payment_nama}")
    for aid in admin_ids:
        try:
            await context.bot.send_photo(
                aid, file_id, caption=caption,
                reply_markup=InlineKeyboardMarkup(keyboard), parse_mode="Markdown")
        except Exception as e:
            logger.error(f"Gagal kirim bukti ke admin {aid}: {e}")

    context.user_data.pop("pending_order_id", None)
    return MENU

# ─── PESANAN & LANGGANAN USER ─────────────────────────────────
async def my_orders(update: Update, context: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    await query.answer()
    uid = update.effective_user.id

    db = get_db()
    try:
        orders = (db.query(Order)
                    .filter_by(user_id=uid)
                    .order_by(Order.waktu.desc())
                    .limit(10).all())
    finally:
        db.close()

    if not orders:
        text = "📋 *Pesanan Saya*\n\nBelum ada pesanan."
    else:
        text = "📋 *Pesanan Saya*\n\n"
        for o in orders:
            text += (f"{status_emoji(o.status)} `{o.id}` — *{o.produk_nama}*\n"
                     f"   💰 {format_rupiah(o.harga)} | _{o.status.title()}_\n\n")

    keyboard = [[InlineKeyboardButton("🏠 Menu Utama", callback_data="start")]]
    await query.edit_message_text(text, reply_markup=InlineKeyboardMarkup(keyboard), parse_mode="Markdown")
    return MENU

async def my_subs(update: Update, context: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    await query.answer()
    uid = update.effective_user.id
    now = datetime.utcnow()

    db = get_db()
    try:
        subs = db.query(Subscription).filter_by(user_id=uid, aktif=True).all()
    finally:
        db.close()

    if not subs:
        text = "📅 *Langganan Aktif*\n\nTidak ada langganan aktif."
    else:
        text = "📅 *Langganan Aktif*\n\n"
        for s in subs:
            sisa = (s.selesai - now).days
            text += (f"⭐ *{s.produk_nama}*\n"
                     f"   📅 Berakhir: {s.selesai.strftime('%d %b %Y')}\n"
                     f"   ⏳ Sisa: *{sisa} hari*\n\n")

    keyboard = [[InlineKeyboardButton("🏠 Menu Utama", callback_data="start")]]
    await query.edit_message_text(text, reply_markup=InlineKeyboardMarkup(keyboard), parse_mode="Markdown")
    return MENU

# ─── ADMIN FUNCTIONS ──────────────────────────────────────────
async def admin_menu(update: Update, context: ContextTypes.DEFAULT_TYPE):
    uid = update.effective_user.id
    if not is_admin(uid):
        return

    keyboard = [
        [InlineKeyboardButton("📋 Daftar Order",      callback_data="admin_orders"),
         InlineKeyboardButton("✅ Input Konfirmasi",   callback_data="admin_input_pay")],
        [InlineKeyboardButton("📊 Statistik",          callback_data="admin_stats"),
         InlineKeyboardButton("🏠 Menu Owner",         callback_data="owner_menu")] if is_owner(uid)
        else [InlineKeyboardButton("📊 Statistik",     callback_data="admin_stats")],
    ]
    keyboard = [r for r in keyboard if r]
    text = (f"🔧 *Panel Admin*\n\nID kamu: `{uid}`\n\nPilih aksi:")
    if update.callback_query:
        await update.callback_query.edit_message_text(
            text, reply_markup=InlineKeyboardMarkup(keyboard), parse_mode="Markdown")
    else:
        await update.message.reply_text(
            text, reply_markup=InlineKeyboardMarkup(keyboard), parse_mode="Markdown")
    return ADMIN_MENU

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
        text = "📋 Tidak ada order pending/menunggu konfirmasi."
    else:
        text = f"📋 *Order Pending ({len(pending)})*\n\n"
        for o in pending[-20:]:
            bukti_flag = " 📸" if o.bukti_file_id else ""
            text += (f"{status_emoji(o.status)} `{o.id}` — {o.produk_nama}{bukti_flag}\n"
                     f"   👤 `{o.user_id}` | 💰 {format_rupiah(o.harga)}\n\n")

    keyboard = [[InlineKeyboardButton("🔙 Panel Admin", callback_data="admin_menu")]]
    await query.edit_message_text(text, reply_markup=InlineKeyboardMarkup(keyboard), parse_mode="Markdown")

async def admin_confirm_order(update: Update, context: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    await query.answer()
    if not is_admin(update.effective_user.id):
        return

    oid = query.data.replace("admin_conf_", "")
    db  = get_db()
    try:
        o = db.query(Order).filter_by(id=oid).first()
        if not o:
            await query.answer("❌ Order tidak ditemukan!", show_alert=True)
            return

        o.status       = "completed"
        o.confirmed_by = update.effective_user.id
        o.confirmed_at = datetime.utcnow()

        # Jika produk premium → buat/perpanjang subscription
        p = db.query(Product).filter_by(id=o.produk_id).first()
        if p and p.durasi_hari:
            now   = datetime.utcnow()
            akhir = now + timedelta(days=p.durasi_hari)
            db.add(Subscription(
                user_id=o.user_id, order_id=oid,
                produk_nama=p.nama, mulai=now, selesai=akhir, aktif=True
            ))
        db.commit()
        uid_user    = o.user_id
        produk_nama = o.produk_nama
    finally:
        db.close()

    try:
        await context.bot.send_message(
            uid_user,
            f"🎉 *Pembayaran Dikonfirmasi!*\n\n"
            f"🔖 ID Order: `{oid}`\n"
            f"📦 Produk: *{produk_nama}*\n\n"
            f"Terima kasih telah berbelanja! 🙏\nProduk sudah diaktifkan.",
            parse_mode="Markdown")
    except Exception as e:
        logger.error(f"Gagal notif user: {e}")

    await query.edit_message_text(
        f"✅ Order `{oid}` dikonfirmasi! User sudah diberitahu.", parse_mode="Markdown")

async def admin_reject_order(update: Update, context: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    await query.answer()
    if not is_admin(update.effective_user.id):
        return

    oid = query.data.replace("admin_reject_", "")
    db  = get_db()
    try:
        o = db.query(Order).filter_by(id=oid).first()
        if o:
            o.status = "cancelled"
            db.commit()
            uid_user = o.user_id
        else:
            uid_user = None
    finally:
        db.close()

    if uid_user:
        try:
            await context.bot.send_message(
                uid_user,
                f"❌ *Order Dibatalkan*\n\n"
                f"🔖 ID Order: `{oid}`\n"
                f"Pembayaran tidak terverifikasi. Hubungi admin jika ada pertanyaan.",
                parse_mode="Markdown")
        except:
            pass
    await query.edit_message_text(f"❌ Order `{oid}` dibatalkan.", parse_mode="Markdown")

async def admin_stats(update: Update, context: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    await query.answer()

    db  = get_db()
    try:
        today = datetime.utcnow().date()
        all_o = db.query(Order).filter(func.date(Order.waktu) == today).all()
        rev   = sum(o.harga for o in all_o if o.status == "completed")
        text  = (f"📊 *Statistik Hari Ini*\n📅 {today}\n\n"
                 f"📦 Total Order: {len(all_o)}\n"
                 f"✅ Selesai: {sum(1 for o in all_o if o.status == 'completed')}\n"
                 f"⏳ Pending: {sum(1 for o in all_o if o.status in ('pending','paid'))}\n"
                 f"💰 Pendapatan: *{format_rupiah(rev)}*\n\n"
                 f"👥 Total User: {db.query(User).count()}")
    finally:
        db.close()

    await query.edit_message_text(text, reply_markup=back_btn("admin_menu"), parse_mode="Markdown")

# ─── OWNER FUNCTIONS ──────────────────────────────────────────
async def owner_menu(update: Update, context: ContextTypes.DEFAULT_TYPE):
    uid = update.effective_user.id
    if not is_owner(uid):
        return

    db = get_db()
    try:
        n_produk = db.query(Product).count()
        n_orders = db.query(Order).count()
        n_users  = db.query(User).count()
    finally:
        db.close()

    keyboard = [
        [InlineKeyboardButton("📦 Kelola Produk",  callback_data="owner_produk"),
         InlineKeyboardButton("💳 Kelola Payment", callback_data="owner_payment")],
        [InlineKeyboardButton("👥 Kelola Admin",   callback_data="owner_admins"),
         InlineKeyboardButton("📊 Laporan",        callback_data="owner_laporan")],
        [InlineKeyboardButton("🔧 Panel Admin",    callback_data="admin_menu")],
    ]
    text = (f"👑 *Panel Owner*\n\n"
            f"Produk: {n_produk} | Order: {n_orders} | User: {n_users}\n\nPilih menu:")
    if update.callback_query:
        await update.callback_query.edit_message_text(
            text, reply_markup=InlineKeyboardMarkup(keyboard), parse_mode="Markdown")
    else:
        await update.message.reply_text(
            text, reply_markup=InlineKeyboardMarkup(keyboard), parse_mode="Markdown")
    return OWNER_MENU

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
        st = "✅" if p.aktif else "❌"
        text += f"{st} `{p.id}` — *{p.nama}* — {format_rupiah(p.harga)}\n"
        keyboard.append([
            InlineKeyboardButton(f"✏️ {p.nama[:15]}", callback_data=f"owner_edit_p_{p.id}"),
            InlineKeyboardButton("🔁 Toggle", callback_data=f"owner_toggle_p_{p.id}")
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
            await query.answer(f"Produk {'aktif' if p.aktif else 'nonaktif'}!", show_alert=True)
    finally:
        db.close()
    return await owner_kelola_produk(update, context)

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
        st = "✅" if pm.aktif else "❌"
        text += f"{st} {tipe_emoji(pm.tipe)} *{pm.nama}*\n   📋 {pm.detail}\n\n"
        row = [
            InlineKeyboardButton(f"✏️ {pm.nama}", callback_data=f"owner_edit_pm_{pm.id}"),
            InlineKeyboardButton("🔁 Toggle",     callback_data=f"owner_toggle_pm_{pm.id}"),
        ]
        # Tombol upload QRIS hanya untuk tipe qris
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
            await query.answer(f"Payment {'aktif' if pm.aktif else 'nonaktif'}!", show_alert=True)
    finally:
        db.close()
    return await owner_kelola_payment(update, context)

# ─── UPLOAD FOTO QRIS (OWNER) ────────────────────────────────
async def owner_request_upload_qris(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Owner klik tombol Upload QRIS → minta kirim foto."""
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
        f"📷 *Upload Foto QRIS — {nama}*\n\n"
        f"Kirimkan foto QR code sekarang.\n"
        f"Foto ini akan ditampilkan ke user saat memilih metode bayar ini.",
        reply_markup=back_btn("owner_payment"), parse_mode="Markdown")
    return OWNER_UPLOAD_QRIS

async def owner_terima_foto_qris(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Terima foto QRIS dari owner dan simpan file_id ke DB."""
    if not is_owner(update.effective_user.id):
        return

    if not update.message.photo:
        await update.message.reply_text("Kirim berupa foto ya. 🙏")
        return OWNER_UPLOAD_QRIS

    pmid    = context.user_data.get("upload_qris_pmid")
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
        f"✅ Foto QRIS untuk *{nama}* berhasil diupload!\n"
        f"Akan otomatis ditampilkan ke user saat checkout.",
        parse_mode="Markdown")
    context.user_data.pop("upload_qris_pmid", None)
    return OWNER_MENU

async def owner_kelola_admin(update: Update, context: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    await query.answer()
    if not is_owner(update.effective_user.id):
        return

    db = get_db()
    try:
        admins = db.query(User).filter_by(is_admin=True).all()
    finally:
        db.close()

    text = "👥 *Kelola Admin*\n\n"
    text += "\n".join([f"• `{a.id}` — {a.nama}" for a in admins]) if admins else "Belum ada admin."
    text += "\n\n`/tambah_admin [user_id]`\n`/hapus_admin [user_id]`"
    await query.edit_message_text(text, reply_markup=back_btn("owner_menu"), parse_mode="Markdown")

async def owner_laporan(update: Update, context: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    await query.answer()

    db = get_db()
    try:
        all_o    = db.query(Order).all()
        done     = [o for o in all_o if o.status == "completed"]
        rev      = sum(o.harga for o in done)
        best_pid = None
        if done:
            from collections import Counter
            c = Counter(o.produk_id for o in done)
            best_pid, best_cnt = c.most_common(1)[0]
            best_p = db.query(Product).filter_by(id=best_pid).first()
            best_nama = best_p.nama if best_p else best_pid
        else:
            best_nama, best_cnt = "-", 0
        n_users = db.query(User).count()
        n_admin = db.query(User).filter_by(is_admin=True).count()
        n_subs  = db.query(Subscription).filter_by(aktif=True).count()
    finally:
        db.close()

    text = (f"📊 *Laporan Lengkap*\n\n"
            f"📦 Total Order: {len(all_o)}\n"
            f"✅ Selesai: {len(done)}\n"
            f"⏳ Pending: {sum(1 for o in all_o if o.status in ('pending','paid'))}\n"
            f"❌ Batal: {sum(1 for o in all_o if o.status == 'cancelled')}\n\n"
            f"💰 Total Pendapatan: *{format_rupiah(rev)}*\n\n"
            f"🏆 Produk Terlaris: *{best_nama}* ({best_cnt}x)\n\n"
            f"👥 Total User: {n_users} | Admin: {n_admin}\n"
            f"📅 Langganan Aktif: {n_subs}")
    await query.edit_message_text(text, reply_markup=back_btn("owner_menu"), parse_mode="Markdown")

# ─── COMMAND HANDLERS ─────────────────────────────────────────
async def cmd_konfirmasi(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """User konfirmasi sudah bayar (tanpa foto)."""
    if not context.args:
        await update.message.reply_text(
            "Gunakan: `/konfirmasi [ID_ORDER]`\nAtau kirim foto bukti transfer langsung ke chat ini.",
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
        if o.status not in ("pending",):
            await update.message.reply_text(
                f"Order `{oid}` sudah dalam status: *{o.status}*", parse_mode="Markdown")
            return
        o.status = "paid"
        db.commit()
        admin_ids   = get_all_admin_ids(db)
        produk_nama = o.produk_nama
        harga       = o.harga
        payment_nama = o.payment_nama
    finally:
        db.close()

    await update.message.reply_text(
        f"✅ Konfirmasi pembayaran `{oid}` diterima!\nAdmin akan segera memverifikasi. 🙏",
        parse_mode="Markdown")

    keyboard = [[
        InlineKeyboardButton("✅ Konfirmasi", callback_data=f"admin_conf_{oid}"),
        InlineKeyboardButton("❌ Tolak",      callback_data=f"admin_reject_{oid}")
    ]]
    notif = (f"💰 *USER KONFIRMASI BAYAR* (tanpa foto)\n\n"
             f"🔖 ID: `{oid}`\n"
             f"👤 User: `{uid}`\n"
             f"📦 Produk: {produk_nama}\n"
             f"💰 Nominal: {format_rupiah(harga)}\n"
             f"💳 Via: {payment_nama}")
    for aid in admin_ids:
        try:
            await context.bot.send_message(
                aid, notif, reply_markup=InlineKeyboardMarkup(keyboard), parse_mode="Markdown")
        except:
            pass

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
    await update.message.reply_text(f"✅ Admin `{new_id}` berhasil ditambahkan!", parse_mode="Markdown")

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
            await update.message.reply_text("⚠️ User tersebut bukan admin.")
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
    success = 0
    for u in users:
        try:
            await context.bot.send_message(u.id, f"📢 *Broadcast*\n\n{msg}", parse_mode="Markdown")
            success += 1
        except:
            pass
    await update.message.reply_text(f"✅ Broadcast terkirim ke {success} user.")

async def help_menu(update: Update, context: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    if query:
        await query.answer()
    text = ("💬 *Bantuan*\n\n"
            "📌 *Cara Order:*\n"
            "1. Pilih produk\n"
            "2. Pilih metode pembayaran\n"
            "3. Transfer sesuai nominal\n"
            "4. Kirim *foto bukti transfer* ke chat ini\n"
            "   atau ketik `/konfirmasi [ID_ORDER]`\n\n"
            "📌 *Perintah:*\n"
            "`/start` — Menu utama\n"
            "`/konfirmasi [ID]` — Konfirmasi tanpa foto\n\n"
            "📞 Hubungi @AdminKamu untuk bantuan lanjut.")
    keyboard = [[InlineKeyboardButton("🏠 Menu Utama", callback_data="start")]]
    if query:
        await query.edit_message_text(text, reply_markup=InlineKeyboardMarkup(keyboard), parse_mode="Markdown")
    else:
        await update.message.reply_text(text, reply_markup=InlineKeyboardMarkup(keyboard), parse_mode="Markdown")

# ─── NOTIF ADMIN: ORDER BARU ──────────────────────────────────
async def notif_admin_new_order(context, order: dict):
    db = get_db()
    try:
        admin_ids = get_all_admin_ids(db)
    finally:
        db.close()

    text = (f"🔔 *ORDER BARU!*\n\n"
            f"🔖 ID: `{order['id']}`\n"
            f"👤 User: `{order['user_id']}`\n"
            f"📦 Produk: {order['produk_nama']}\n"
            f"💰 Total: {format_rupiah(order['harga'])}\n"
            f"💳 Via: {order['payment_nama']}\n\n"
            f"_Menunggu bukti transfer dari user..._")
    keyboard = [[
        InlineKeyboardButton("✅ Konfirmasi", callback_data=f"admin_conf_{order['id']}"),
        InlineKeyboardButton("❌ Tolak",      callback_data=f"admin_reject_{order['id']}")
    ]]
    for aid in admin_ids:
        try:
            await context.bot.send_message(
                aid, text, reply_markup=InlineKeyboardMarkup(keyboard), parse_mode="Markdown")
        except Exception as e:
            logger.error(f"Gagal notif admin {aid}: {e}")

# ─── AUTO-EXPIRE JOB ──────────────────────────────────────────
async def job_cek_expire_langganan(context: ContextTypes.DEFAULT_TYPE):
    """
    Dijalankan setiap jam.
    - Kirim notif H-3 dan H-1 sebelum expire
    - Nonaktifkan langganan yang sudah expired
    """
    now = datetime.utcnow()
    db  = get_db()
    try:
        aktif_subs = db.query(Subscription).filter_by(aktif=True).all()
        for s in aktif_subs:
            sisa = (s.selesai - now).total_seconds() / 86400   # dalam hari (float)

            # Kirim notif H-3
            if 2 <= sisa < 3 and not s.notif_3hari:
                try:
                    await context.bot.send_message(
                        s.user_id,
                        f"⚠️ *Langganan Hampir Habis!*\n\n"
                        f"📦 *{s.produk_nama}*\n"
                        f"⏳ Berakhir dalam *3 hari* "
                        f"({s.selesai.strftime('%d %b %Y')})\n\n"
                        f"Perpanjang sekarang supaya tidak terputus! 🙏\n"
                        f"Ketik /start untuk lihat paket.",
                        parse_mode="Markdown")
                    s.notif_3hari = True
                except Exception as e:
                    logger.error(f"Gagal kirim notif H-3 ke {s.user_id}: {e}")

            # Kirim notif H-1
            elif 0 < sisa < 1 and not s.notif_1hari:
                try:
                    await context.bot.send_message(
                        s.user_id,
                        f"🚨 *Langganan Berakhir Besok!*\n\n"
                        f"📦 *{s.produk_nama}*\n"
                        f"⏳ Berakhir: *{s.selesai.strftime('%d %b %Y %H:%M')} UTC*\n\n"
                        f"Perpanjang *sekarang* sebelum akses terputus!\n"
                        f"Ketik /start untuk pilih paket.",
                        parse_mode="Markdown")
                    s.notif_1hari = True
                except Exception as e:
                    logger.error(f"Gagal kirim notif H-1 ke {s.user_id}: {e}")

            # Nonaktifkan yang sudah expired
            elif sisa <= 0:
                s.aktif = False
                try:
                    await context.bot.send_message(
                        s.user_id,
                        f"❌ *Langganan Berakhir*\n\n"
                        f"📦 *{s.produk_nama}* sudah berakhir.\n\n"
                        f"Perpanjang sekarang untuk melanjutkan akses. 🙏\n"
                        f"Ketik /start.",
                        parse_mode="Markdown")
                except Exception as e:
                    logger.error(f"Gagal kirim notif expired ke {s.user_id}: {e}")

        db.commit()
    finally:
        db.close()

# ─── CALLBACK ROUTER ──────────────────────────────────────────
async def callback_router(update: Update, context: ContextTypes.DEFAULT_TYPE):
    data = update.callback_query.data
    routes = {
        "start":          start,
        "my_orders":      my_orders,
        "my_subs":        my_subs,
        "help":           help_menu,
        "admin_menu":     admin_menu,
        "admin_orders":   admin_list_orders,
        "admin_input_pay": admin_list_orders,
        "admin_stats":    admin_stats,
        "owner_menu":     owner_menu,
        "owner_produk":   owner_kelola_produk,
        "owner_payment":  owner_kelola_payment,
        "owner_admins":   owner_kelola_admin,
        "owner_laporan":  owner_laporan,
    }
    if data in routes:
        return await routes[data](update, context)
    elif data.startswith("kat_"):              return await show_kategori(update, context)
    elif data.startswith("produk_"):           return await show_produk(update, context)
    elif data.startswith("order_"):            return await proses_order(update, context)
    elif data.startswith("pay_"):              return await pilih_payment(update, context)
    elif data.startswith("admin_conf_"):       return await admin_confirm_order(update, context)
    elif data.startswith("admin_reject_"):     return await admin_reject_order(update, context)
    elif data.startswith("owner_toggle_p_"):   return await owner_toggle_produk(update, context)
    elif data.startswith("owner_toggle_pm_"):  return await owner_toggle_payment(update, context)
    elif data.startswith("owner_upload_qris_"):return await owner_request_upload_qris(update, context)

# ─── MAIN ─────────────────────────────────────────────────────
async def foto_dispatcher(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Dispatcher foto: pisah antara upload QRIS (owner) dan bukti bayar (user)."""
    uid = update.effective_user.id
    if is_owner(uid) and context.user_data.get("upload_qris_pmid"):
        return await owner_terima_foto_qris(update, context)
    return await terima_bukti_pembayaran(update, context)


def main():
    init_db()

    app = Application.builder().token(BOT_TOKEN).build()

    # Command handlers
    app.add_handler(CommandHandler("start",        start))
    app.add_handler(CommandHandler("konfirmasi",   cmd_konfirmasi))
    app.add_handler(CommandHandler("tambah_admin", cmd_tambah_admin))
    app.add_handler(CommandHandler("hapus_admin",  cmd_hapus_admin))
    app.add_handler(CommandHandler("broadcast",    cmd_broadcast))
    app.add_handler(CommandHandler("admin",        admin_menu))
    app.add_handler(CommandHandler("owner",        owner_menu))

    # Callback handler (semua tombol inline)
    app.add_handler(CallbackQueryHandler(callback_router))

    # Handler foto — satu dispatcher untuk user (bukti bayar) & owner (upload QRIS)
    app.add_handler(MessageHandler(
        filters.PHOTO | filters.Document.IMAGE,
        foto_dispatcher
    ))

    # ── Job: cek expire langganan setiap jam ──────────────────
    app.job_queue.run_repeating(
        job_cek_expire_langganan,
        interval=3600,   # setiap 1 jam
        first=60,        # mulai 60 detik setelah bot start
    )

    print("🤖 Bot Store (Volume SQLite + QRIS Upload + Auto-Expire) berjalan...")
    app.run_polling(allowed_updates=Update.ALL_TYPES)

if __name__ == "__main__":
    main()
