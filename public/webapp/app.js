const tg = window.Telegram?.WebApp;
tg?.ready();
tg?.expand();
tg?.setHeaderColor?.("#FBEEF2");
tg?.setBackgroundColor?.("#FBEEF2");

const initData = tg?.initData || "";

// ── Catalog data (mirrored from server catalog.js) ──────────────────────────
const CATALOG_PAGES = [
  {
    id: 1, emoji: "✨", title: "Netflix Premium", subtitle: "Streaming film & series HD tanpa batas",
    products: [
      { name: "Netflix 1 Bulan", price: 45000, duration: "30 hari", desc: "Private 4K UHD, semua perangkat" },
      { name: "Netflix 3 Bulan", price: 120000, duration: "90 hari", desc: "Hemat 11%, private 4K UHD" },
      { name: "Netflix 1 Tahun", price: 420000, duration: "365 hari", desc: "Paling hemat, private 4K UHD" },
    ],
  },
  {
    id: 2, emoji: "🎵", title: "Spotify Premium", subtitle: "Musik tanpa iklan, download offline",
    products: [
      { name: "Spotify 1 Bulan", price: 25000, duration: "30 hari", desc: "Individual, tanpa iklan, offline" },
      { name: "Spotify 3 Bulan", price: 65000, duration: "90 hari", desc: "Hemat 13%, individual" },
      { name: "Spotify 1 Tahun", price: 220000, duration: "365 hari", desc: "Harga terbaik, individual" },
    ],
  },
  {
    id: 3, emoji: "🤖", title: "ChatGPT Plus", subtitle: "GPT-4, DALL·E, plugin & lebih cepat",
    products: [
      { name: "ChatGPT Plus 1 Bulan", price: 150000, duration: "30 hari", desc: "Akses GPT-4, DALL·E 3, browsing" },
      { name: "ChatGPT Plus 3 Bulan", price: 420000, duration: "90 hari", desc: "Hemat 7%, semua fitur Plus" },
    ],
  },
  {
    id: 4, emoji: "🎬", title: "Disney+ Hotstar", subtitle: "Marvel, Star Wars, anime & olahraga live",
    products: [
      { name: "Disney+ 1 Bulan", price: 35000, duration: "30 hari", desc: "4K, semua konten eksklusif" },
      { name: "Disney+ 3 Bulan", price: 95000, duration: "90 hari", desc: "Hemat 10%, 4K" },
      { name: "Disney+ 1 Tahun", price: 320000, duration: "365 hari", desc: "Harga terbaik, 4K" },
    ],
  },
  {
    id: 5, emoji: "☁️", title: "Google One / iCloud", subtitle: "Penyimpanan cloud tambahan",
    products: [
      { name: "Google One 100GB 1 Bln", price: 20000, duration: "30 hari", desc: "100 GB Google Drive, Gmail, Foto" },
      { name: "Google One 200GB 1 Bln", price: 32000, duration: "30 hari", desc: "200 GB, cocok untuk keluarga" },
      { name: "iCloud+ 50GB 1 Bln", price: 18000, duration: "30 hari", desc: "50 GB iCloud untuk iPhone/iPad" },
      { name: "iCloud+ 200GB 1 Bln", price: 30000, duration: "30 hari", desc: "200 GB, bisa share ke keluarga" },
    ],
  },
  {
    id: 6, emoji: "🎮", title: "Gaming", subtitle: "Xbox Game Pass, PlayStation Plus & Steam",
    products: [
      { name: "Xbox Game Pass 1 Bln", price: 85000, duration: "30 hari", desc: "Ultimate: 400+ game, EA Play, cloud" },
      { name: "PS Plus Essential 1 Bln", price: 80000, duration: "30 hari", desc: "2–3 game gratis/bulan, online" },
      { name: "PS Plus Extra 1 Bln", price: 120000, duration: "30 hari", desc: "Katalog 400+ game PS4/PS5" },
    ],
  },
  {
    id: 7, emoji: "🛠️", title: "Tools Produktivitas", subtitle: "Canva, Microsoft 365, Notion & Adobe",
    products: [
      { name: "Canva Pro 1 Bulan", price: 55000, duration: "30 hari", desc: "Template premium, background remover" },
      { name: "Canva Pro 1 Tahun", price: 180000, duration: "365 hari", desc: "Hemat 73%, semua fitur Pro" },
      { name: "Microsoft 365 1 Bln", price: 60000, duration: "30 hari", desc: "Word, Excel, PPT, 1 TB OneDrive" },
      { name: "Notion AI 1 Bulan", price: 70000, duration: "30 hari", desc: "Unlimited AI, workspace Plus" },
    ],
  },
  {
    id: 8, emoji: "🌐", title: "VPN & Keamanan", subtitle: "Browsing aman, bypass blokir, privasi",
    products: [
      { name: "NordVPN 1 Bulan", price: 75000, duration: "30 hari", desc: "6 perangkat, 60+ negara, cepat" },
      { name: "NordVPN 1 Tahun", price: 250000, duration: "365 hari", desc: "Hemat 72%, termasuk threat protection" },
      { name: "ExpressVPN 1 Bulan", price: 80000, duration: "30 hari", desc: "5 perangkat, 90+ negara, tercepat" },
    ],
  },
];

let currentCatalogPage = 1;
let PAYMENT_INSTRUCTIONS = "";
let DB_PRODUCTS = []; // products from server DB (for checkout)
let LIVE_CHAT_URL = ""; // grup live chat URL

// ── Utility ─────────────────────────────────────────────────────────────────

function formatRupiah(n) {
  return "Rp" + Number(n).toLocaleString("id-ID");
}

function toast(msg) {
  const el = document.getElementById("toast");
  el.textContent = msg;
  el.classList.remove("hidden");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.add("hidden"), 2800);
}

function escapeHtml(str) {
  return String(str ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );
}

async function api(path, options = {}) {
  const res = await fetch(`/api${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      "X-Telegram-Init-Data": initData,
      ...(options.headers || {}),
    },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request gagal (${res.status})`);
  return data;
}

// ── Tabs ─────────────────────────────────────────────────────────────────────

document.querySelectorAll(".tab").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach((b) => b.classList.remove("active"));
    document.querySelectorAll(".view").forEach((v) => v.classList.remove("active"));
    btn.classList.add("active");
    document.getElementById(`view-${btn.dataset.tab}`).classList.add("active");
    if (btn.dataset.tab === "orders") loadOrders();
    if (btn.dataset.tab === "subs") loadSubs();
    if (btn.dataset.tab === "admin") loadAdminOrders("pending");
  });
});

// ── Boot ─────────────────────────────────────────────────────────────────────

async function boot() {
  if (!initData) {
    document.getElementById("catalog-list").innerHTML =
      `<div class="empty-state"><strong>Buka lewat Telegram</strong>Nifara Store hanya bisa diakses dari dalam bot Telegram.</div>`;
    return;
  }

  try {
    const me = await api("/me");
    if (me.user?.is_admin) document.querySelector(".tab-admin").classList.remove("hidden");
  } catch (e) { console.error(e); }

  // Load DB products for checkout
  try {
    const data = await api("/products");
    DB_PRODUCTS = data.products;
    PAYMENT_INSTRUCTIONS = data.paymentInstructions;
    // Try to get live chat URL from meta tag or window config
    LIVE_CHAT_URL = window.LIVE_CHAT_URL || "";
  } catch (e) { console.error(e); }

  buildCatNav();
  renderCatalogPage(currentCatalogPage);
}

// ── Category Navigation ───────────────────────────────────────────────────────

function buildCatNav() {
  const nav = document.getElementById("cat-nav");
  nav.innerHTML = CATALOG_PAGES.map((p) =>
    `<button class="cat-pill${p.id === 1 ? " active" : ""}" data-page="${p.id}">
      ${p.emoji} ${p.title}
    </button>`
  ).join("");

  nav.querySelectorAll(".cat-pill").forEach((btn) => {
    btn.addEventListener("click", () => {
      nav.querySelectorAll(".cat-pill").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      currentCatalogPage = Number(btn.dataset.page);
      renderCatalogPage(currentCatalogPage);
      // Smooth scroll catalog back to top
      document.getElementById("catalog-list").scrollIntoView({ behavior: "smooth", block: "start" });
    });
  });
}

// ── Render Catalog Page ───────────────────────────────────────────────────────

function renderCatalogPage(pageId) {
  const page = CATALOG_PAGES.find((p) => p.id === pageId);
  if (!page) return;
  const container = document.getElementById("catalog-list");

  container.innerHTML = `
    <div class="cat-header">
      <div class="cat-emoji">${page.emoji}</div>
      <div>
        <h2 class="cat-title">${escapeHtml(page.title)}</h2>
        <p class="cat-subtitle">${escapeHtml(page.subtitle)}</p>
      </div>
    </div>
    <div class="page-indicator">Halaman ${pageId} dari ${CATALOG_PAGES.length}</div>
    ${page.products.map((prod, idx) => renderProductCard(page, prod, idx)).join("")}
    <div class="cat-pagination">
      ${pageId > 1 ? `<button class="page-btn" onclick="changePage(${pageId - 1})">◀ Sebelumnya</button>` : `<span></span>`}
      ${pageId < CATALOG_PAGES.length ? `<button class="page-btn page-btn-next" onclick="changePage(${pageId + 1})">Selanjutnya ▶</button>` : `<span></span>`}
    </div>
  `;
}

function renderProductCard(page, prod, idx) {
  // Try to find matching DB product for mini-app checkout
  const dbProd = DB_PRODUCTS.find((p) => p.name === prod.name);
  const hasDbProduct = !!dbProd;

  return `
    <div class="ticket-card">
      <div class="ticket-main">
        <h3>${escapeHtml(prod.name)}</h3>
        <p class="desc">${escapeHtml(prod.desc)}</p>
        <div class="feature-tags">
          <span>⏱ ${escapeHtml(prod.duration)}</span>
        </div>
      </div>
      <div class="ticket-stub">
        <div class="price">${formatRupiah(prod.price)}</div>
        <div class="duration">${escapeHtml(prod.duration)}</div>
        <button onclick="openOrder(${page.id}, ${idx})">Order</button>
      </div>
    </div>`;
}

window.changePage = function(pageId) {
  currentCatalogPage = pageId;
  // update pill
  document.querySelectorAll(".cat-pill").forEach((b) => {
    b.classList.toggle("active", Number(b.dataset.page) === pageId);
  });
  renderCatalogPage(pageId);
  window.scrollTo({ top: 0, behavior: "smooth" });
};

// ── Order Flow ────────────────────────────────────────────────────────────────

window.openOrder = function(pageId, prodIdx) {
  const page = CATALOG_PAGES.find((p) => p.id === pageId);
  if (!page) return;
  const prod = page.products[prodIdx];
  if (!prod) return;

  // Check if this product exists in DB (for mini-app checkout)
  const dbProd = DB_PRODUCTS.find((p) => p.name === prod.name);

  if (dbProd) {
    // Has DB entry — use normal checkout modal
    openCheckout(dbProd.id, prod);
  } else {
    // No DB entry — open direct chat to admin modal
    openDirectOrder(prod);
  }
};

// Mini-app checkout (via API + payment form)
let selectedProductId = null;

function openCheckout(dbProductId, prod) {
  selectedProductId = dbProductId;
  document.getElementById("checkout-title").textContent = prod.name;
  document.getElementById("checkout-price").textContent =
    `${formatRupiah(prod.price)} · ${prod.duration}`;
  document.getElementById("payment-box").textContent = PAYMENT_INSTRUCTIONS;
  document.getElementById("payment-name").value = "";
  document.getElementById("order-note").value = "";
  document.getElementById("checkout-modal").classList.remove("hidden");
}

// Direct order to admin live chat
function openDirectOrder(prod) {
  document.getElementById("direct-order-title").textContent = prod.name;
  document.getElementById("direct-order-price").textContent =
    `${formatRupiah(prod.price)} · ${prod.duration}`;

  // Build pre-filled message for admin
  const msg = encodeURIComponent(
    `Halo admin Nifara Store!\n\nSaya ingin order:\n📦 ${prod.name}\n💰 ${formatRupiah(prod.price)} · ${prod.duration}\n\nMohon info pembayarannya ya 🙏`
  );

  // Use bot link or live chat group
  const chatLink = LIVE_CHAT_URL
    ? LIVE_CHAT_URL
    : `https://t.me/${window.ADMIN_USERNAME || "NifaraStoreAdmin"}?text=${msg}`;

  document.getElementById("direct-order-link").href = chatLink;
  document.getElementById("direct-order-modal").classList.remove("hidden");
}

// ── Checkout Modal handlers ───────────────────────────────────────────────────

document.getElementById("checkout-close").addEventListener("click", () => {
  document.getElementById("checkout-modal").classList.add("hidden");
});
document.getElementById("direct-order-close").addEventListener("click", () => {
  document.getElementById("direct-order-modal").classList.add("hidden");
});

document.getElementById("submit-order").addEventListener("click", async () => {
  const paymentName = document.getElementById("payment-name").value.trim();
  const note = document.getElementById("order-note").value.trim();

  if (!paymentName) {
    toast("Isi dulu nama pengirim transfer ya");
    return;
  }

  const btn = document.getElementById("submit-order");
  btn.disabled = true;
  btn.textContent = "Mengirim...";

  try {
    await api("/orders", {
      method: "POST",
      body: JSON.stringify({ productId: selectedProductId, paymentName, note }),
    });
    document.getElementById("checkout-modal").classList.add("hidden");
    toast("Pesanan terkirim! Tunggu konfirmasi admin 🌸");
    tg?.HapticFeedback?.notificationOccurred?.("success");
  } catch (e) {
    toast(e.message);
  } finally {
    btn.disabled = false;
    btn.textContent = "Kirim Pesanan ke Admin";
  }
});

// ── Orders ────────────────────────────────────────────────────────────────────

async function loadOrders() {
  const container = document.getElementById("orders-list");
  container.innerHTML = `<div class="skeleton-card"></div>`;
  try {
    const { orders } = await api("/orders/mine");
    if (!orders.length) {
      container.innerHTML = `<div class="empty-state"><strong>Belum ada pesanan</strong>Order dari tab Katalog akan muncul di sini.</div>`;
      return;
    }
    container.innerHTML = orders.map((o) => {
      const stampClass = o.status === "pending" ? "pending" : o.status === "approved" ? "approved" : "rejected";
      const stampText = o.status === "pending" ? "Pending" : o.status === "approved" ? "Disetujui" : "Ditolak";
      return `
      <div class="order-card">
        <div class="order-top">
          <div>
            <h4>${escapeHtml(o.productName)}</h4>
            <div class="order-id mono">Pesanan #${o.id}</div>
          </div>
          <span class="stamp ${stampClass}">${stampText}</span>
        </div>
        <div class="order-meta">
          ${formatRupiah(o.price)} · ${new Date(o.created_at).toLocaleString("id-ID")}<br/>
          Nama transfer: ${escapeHtml(o.payment_name)}
        </div>
      </div>`;
    }).join("");
  } catch (e) {
    container.innerHTML = `<div class="empty-state"><strong>Gagal memuat</strong>${escapeHtml(e.message)}</div>`;
  }
}

// ── Subscriptions ─────────────────────────────────────────────────────────────

async function loadSubs() {
  const container = document.getElementById("subs-list");
  container.innerHTML = `<div class="skeleton-card"></div>`;
  try {
    const { subscriptions } = await api("/subscriptions/mine");
    if (!subscriptions.length) {
      container.innerHTML = `<div class="empty-state"><strong>Belum ada langganan</strong>Setelah order disetujui admin, langganan aktif akan muncul di sini.</div>`;
      return;
    }
    container.innerHTML = subscriptions.map((s) => {
      const stampClass = s.isExpired ? "expired" : "active";
      const stampText = s.isExpired ? "Berakhir" : "Aktif";
      return `
      <div class="sub-card">
        <div class="sub-top">
          <div>
            <h4>${escapeHtml(s.productName)}</h4>
            <div class="sub-expiry mono">s/d ${new Date(s.expires_at).toLocaleString("id-ID")}</div>
          </div>
          <span class="stamp ${stampClass}">${stampText}</span>
        </div>
        <div class="feature-tags" style="margin-top:10px;">
          ${s.features.map((f) => `<span>${escapeHtml(f)}</span>`).join("")}
        </div>
      </div>`;
    }).join("");
  } catch (e) {
    container.innerHTML = `<div class="empty-state"><strong>Gagal memuat</strong>${escapeHtml(e.message)}</div>`;
  }
}

// ── Admin Panel ───────────────────────────────────────────────────────────────

document.querySelectorAll(".chip").forEach((chip) => {
  chip.addEventListener("click", () => {
    document.querySelectorAll(".chip").forEach((c) => c.classList.remove("active"));
    chip.classList.add("active");
    loadAdminOrders(chip.dataset.status);
  });
});

async function loadAdminOrders(status) {
  const container = document.getElementById("admin-list");
  container.innerHTML = `<div class="skeleton-card"></div>`;
  try {
    const { orders } = await api(`/admin/orders?status=${status}`);
    if (!orders.length) {
      container.innerHTML = `<div class="empty-state"><strong>Kosong</strong>Tidak ada order dengan status ini.</div>`;
      return;
    }
    container.innerHTML = orders.map((o) => `
      <div class="order-card">
        <div class="order-top">
          <div>
            <h4>${escapeHtml(o.productName)}</h4>
            <div class="order-id mono">Tiket #${o.id} · @${escapeHtml(o.username || o.userId)}</div>
          </div>
          <span class="stamp pending mono">${formatRupiah(o.price)}</span>
        </div>
        <div class="order-meta">
          Nama transfer: <strong>${escapeHtml(o.paymentName)}</strong><br/>
          ${o.note ? `Catatan: ${escapeHtml(o.note)}<br/>` : ""}
          Dikirim: ${new Date(o.created_at).toLocaleString("id-ID")}
        </div>
        ${status === "pending"
          ? `<div class="admin-actions">
              <button class="btn-approve" onclick="decideOrder(${o.id}, 'approve')">✅ Approve</button>
              <button class="btn-reject" onclick="decideOrder(${o.id}, 'reject')">❌ Reject</button>
            </div>`
          : ""}
      </div>`).join("");
  } catch (e) {
    container.innerHTML = `<div class="empty-state"><strong>Gagal memuat</strong>${escapeHtml(e.message)}</div>`;
  }
}

window.decideOrder = async function(orderId, action) {
  try {
    await api(`/admin/orders/${orderId}/decide`, {
      method: "POST",
      body: JSON.stringify({ action }),
    });
    toast(action === "approve" ? "Order disetujui ✅" : "Order ditolak");
    tg?.HapticFeedback?.notificationOccurred?.("success");
    const activeChip = document.querySelector(".chip.active").dataset.status;
    loadAdminOrders(activeChip);
  } catch (e) {
    toast(e.message);
  }
};

boot();
