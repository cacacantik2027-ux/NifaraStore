const tg = window.Telegram?.WebApp;
tg?.ready();
tg?.expand();
tg?.setHeaderColor?.("#FBEEF2");
tg?.setBackgroundColor?.("#FBEEF2");

const initData = tg?.initData || "";

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

function formatRupiah(n) {
  return "Rp" + Number(n).toLocaleString("id-ID");
}

function toast(msg) {
  const el = document.getElementById("toast");
  el.textContent = msg;
  el.classList.remove("hidden");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.add("hidden"), 2600);
}

/* ---------- Tabs ---------- */
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

/* ---------- Bootstrapping ---------- */
let PRODUCTS = [];
let PAYMENT_INSTRUCTIONS = "";

async function boot() {
  if (!initData) {
    document.getElementById("catalog-list").innerHTML =
      `<div class="empty-state"><strong>Buka lewat Telegram</strong>Nifara Store hanya bisa diakses dari dalam bot Telegram.</div>`;
    return;
  }

  try {
    const me = await api("/me");
    if (me.user?.is_admin) document.querySelector(".tab-admin").classList.remove("hidden");
  } catch (e) {
    console.error(e);
  }

  await loadCatalog();
}

/* ---------- Katalog ---------- */
async function loadCatalog() {
  const container = document.getElementById("catalog-list");
  try {
    const data = await api("/products");
    PRODUCTS = data.products;
    PAYMENT_INSTRUCTIONS = data.paymentInstructions;

    if (!PRODUCTS.length) {
      container.innerHTML = `<div class="empty-state"><strong>Koleksi belum tersedia</strong>Admin belum menambahkan produk.</div>`;
      return;
    }

    container.innerHTML = PRODUCTS.map(
      (p) => `
      <div class="ticket-card">
        <div class="ticket-main">
          <h3>${escapeHtml(p.name)}</h3>
          <p class="desc">${escapeHtml(p.description || "")}</p>
          <div class="feature-tags">
            ${p.features.map((f) => `<span>${escapeHtml(f)}</span>`).join("")}
          </div>
        </div>
        <div class="ticket-stub">
          <div class="price">${formatRupiah(p.price)}</div>
          <div class="duration">${p.duration_days} hari</div>
          <button onclick="openCheckout(${p.id})">Order</button>
        </div>
      </div>`
    ).join("");
  } catch (e) {
    container.innerHTML = `<div class="empty-state"><strong>Gagal memuat</strong>${escapeHtml(e.message)}</div>`;
  }
}

/* ---------- Checkout Modal ---------- */
let selectedProductId = null;

window.openCheckout = function (productId) {
  const product = PRODUCTS.find((p) => p.id === productId);
  if (!product) return;
  selectedProductId = productId;

  document.getElementById("checkout-title").textContent = product.name;
  document.getElementById("checkout-price").textContent =
    `${formatRupiah(product.price)} · ${product.duration_days} hari`;
  document.getElementById("payment-box").textContent = PAYMENT_INSTRUCTIONS;
  document.getElementById("payment-name").value = "";
  document.getElementById("order-note").value = "";
  document.getElementById("checkout-modal").classList.remove("hidden");
};

document.getElementById("checkout-close").addEventListener("click", () => {
  document.getElementById("checkout-modal").classList.add("hidden");
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
    toast("Pesanan terkirim, tunggu konfirmasi admin 🌸");
    tg?.HapticFeedback?.notificationOccurred?.("success");
  } catch (e) {
    toast(e.message);
  } finally {
    btn.disabled = false;
    btn.textContent = "Kirim Order untuk Dicek Admin";
  }
});

/* ---------- Tiket Saya (Orders) ---------- */
async function loadOrders() {
  const container = document.getElementById("orders-list");
  container.innerHTML = `<div class="skeleton-card"></div>`;
  try {
    const { orders } = await api("/orders/mine");
    if (!orders.length) {
      container.innerHTML = `<div class="empty-state"><strong>Belum ada pesanan</strong>Order dari tab Koleksi akan muncul di sini.</div>`;
      return;
    }
    container.innerHTML = orders
      .map((o) => {
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
            ${formatRupiah(o.price)} · dikirim ${new Date(o.created_at).toLocaleString("id-ID")}<br/>
            Nama transfer: ${escapeHtml(o.payment_name)}
          </div>
        </div>`;
      })
      .join("");
  } catch (e) {
    container.innerHTML = `<div class="empty-state"><strong>Gagal memuat</strong>${escapeHtml(e.message)}</div>`;
  }
}

/* ---------- Langganan Saya ---------- */
async function loadSubs() {
  const container = document.getElementById("subs-list");
  container.innerHTML = `<div class="skeleton-card"></div>`;
  try {
    const { subscriptions } = await api("/subscriptions/mine");
    if (!subscriptions.length) {
      container.innerHTML = `<div class="empty-state"><strong>Belum ada langganan</strong>Setelah order disetujui admin, langganan aktif akan muncul di sini.</div>`;
      return;
    }
    container.innerHTML = subscriptions
      .map((s) => {
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
      })
      .join("");
  } catch (e) {
    container.innerHTML = `<div class="empty-state"><strong>Gagal memuat</strong>${escapeHtml(e.message)}</div>`;
  }
}

/* ---------- Admin Panel ---------- */
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
    container.innerHTML = orders
      .map(
        (o) => `
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
        ${
          status === "pending"
            ? `<div class="admin-actions">
                <button class="btn-approve" onclick="decideOrder(${o.id}, 'approve')">Approve</button>
                <button class="btn-reject" onclick="decideOrder(${o.id}, 'reject')">Reject</button>
              </div>`
            : ""
        }
      </div>`
      )
      .join("");
  } catch (e) {
    container.innerHTML = `<div class="empty-state"><strong>Gagal memuat</strong>${escapeHtml(e.message)}</div>`;
  }
}

window.decideOrder = async function (orderId, action) {
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

function escapeHtml(str) {
  return String(str ?? "").replace(/[&<>"']/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
  ));
}

boot();
