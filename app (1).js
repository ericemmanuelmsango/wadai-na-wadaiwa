/* ============ Wadai na Wadaiwa — Debtors & Creditors System ============
   Plain HTML/CSS/JS, no build step. Data is stored in Firebase Firestore
   (cloud database) so every device sees the same data in real time.
   Deploy the whole folder to Netlify / GitHub Pages / any static host.
=========================================================================*/

/* ====================================================================
   STEP 1 — PASTE YOUR OWN FIREBASE CONFIG HERE.
   Get this from: Firebase Console → Project settings → Your apps → Web app
   Everything else in this file already knows what to do with it.
==================================================================== */
const firebaseConfig = {
  apiKey: "AIzaSyCgoZC_HGNZfcDgnyNRd6-rKdpZy1MIIiM",
  authDomain: "shem-rogart-motor-spair-parts.firebaseapp.com",
  projectId: "shem-rogart-motor-spair-parts",
  storageBucket: "shem-rogart-motor-spair-parts.firebasestorage.app",
  messagingSenderId: "94440416659",
  appId: "1:94440416659:web:73df8a204f7b86a016f466",
};

const CONFIG_IS_SET = firebaseConfig.apiKey && !firebaseConfig.apiKey.startsWith("PASTE_");
let db = null;
let docRef = null;
if (CONFIG_IS_SET) {
  firebase.initializeApp(firebaseConfig);
  db = firebase.firestore();
  docRef = db.collection("wadai_na_wadaiwa").doc("data");
}

const LS_SESSION = "ww_session";

let STATE = { users: [], entries: [], products: [], stockItems: [], stockMovements: [], settings: { reportsPassword: "eric1234" } };
let STATE_LOADED = false;
let UI = {
  page: "dashboard",
  search: "",
  expandedOwed: null,
  expandedOwe: null,
  showHistoryOwed: false,
  showHistoryOwe: false,
  formOwed: null,
  formOwe: null,
  receiptEntryId: null,
  authError: null,
  changeMsg: null,
  userMsg: null,
  err: null,
  newUserRole: "staff",
  addItemsTo: null,
  resetUserId: null,
  financialsUnlocked: false,
  finPasswordInput: "",
  finPasswordError: null,
  stockForm: null,
  dispatchForm: null,
  deliveryNoteId: null,
  editingLimitId: null,
  newUserCanViewFinancials: false,
  finSettingsMsg: null,
};
let notifiedKeys = new Set();
let charts = {};

/* ---------- helpers ---------- */
function fmt(n) { return "TSh " + Math.round(n || 0).toLocaleString("en-US"); }
function todayStr() { return new Date().toISOString().slice(0, 10); }
function balanceOf(e) { return e.amount - e.payments.reduce((s, p) => s + p.amount, 0); }
function dueStatus(e) {
  const bal = balanceOf(e);
  if (bal <= 0 || !e.dueDate) return null;
  const t = todayStr();
  if (e.dueDate < t) return "overdue";
  if (e.dueDate === t) return "today";
  return null;
}
function lineTotalOf(row, mode) {
  const price = Number(row.price || 0);
  const qty = Number(row.qty || 0);
  if (mode === "percent") {
    const pct = Number(row.discountPercent || 0);
    return price * (1 - pct / 100) * qty;
  }
  return Number(row.discountPrice || row.price || 0) * qty;
}
function uid() { return "id-" + Math.random().toString(36).slice(2) + Date.now().toString(36); }
function sanitizeNum(v) { return v.replace(/[^0-9.]/g, ""); }
function esc(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;"); }

function loadState() {
  if (!CONFIG_IS_SET) return;
  docRef.onSnapshot((doc) => {
    const data = doc.exists ? doc.data() : {};
    STATE.users = data.users || [];
    STATE.entries = data.entries || [];
    STATE.products = data.products || [];
    STATE.stockItems = data.stockItems || [];
    STATE.stockMovements = data.stockMovements || [];
    STATE.settings = data.settings || { reportsPassword: "eric1234" };
    const wasLoaded = STATE_LOADED;
    STATE_LOADED = true;
    if (wasLoaded) checkAlertsForNotification();
    rerender();
  }, (error) => {
    UI.err = "Could not connect to the cloud database. Check your internet connection.";
    STATE_LOADED = true;
    rerender();
  });
}
function saveUsers() { if (docRef) docRef.set({ users: STATE.users }, { merge: true }); }
function saveEntries() { if (docRef) docRef.set({ entries: STATE.entries }, { merge: true }); }
function saveProducts() { if (docRef) docRef.set({ products: STATE.products }, { merge: true }); }
function saveStockItems() { if (docRef) docRef.set({ stockItems: STATE.stockItems }, { merge: true }); }
function saveStockMovements() { if (docRef) docRef.set({ stockMovements: STATE.stockMovements }, { merge: true }); }
function saveSettings() { if (docRef) docRef.set({ settings: STATE.settings }, { merge: true }); }
function currentUser() {
  const id = localStorage.getItem(LS_SESSION);
  return STATE.users.find((u) => u.id === id) || null;
}
function setSession(id) {
  if (id) localStorage.setItem(LS_SESSION, id);
  else localStorage.removeItem(LS_SESSION);
}

/* ---------- render with focus preservation ---------- */
function rerender() {
  const active = document.activeElement;
  const activeId = active && active.id;
  const selStart = active && "selectionStart" in active ? active.selectionStart : null;
  const selEnd = active && "selectionEnd" in active ? active.selectionEnd : null;
  render();
  if (activeId) {
    const el = document.getElementById(activeId);
    if (el) {
      el.focus();
      if (selStart != null && el.setSelectionRange) {
        try { el.setSelectionRange(selStart, selEnd); } catch (e) {}
      }
    }
  }
}

function render() {
  const root = document.getElementById("app");
  if (!CONFIG_IS_SET) {
    root.innerHTML = renderSetupNotice();
    return;
  }
  if (!STATE_LOADED) {
    root.innerHTML = `<div class="login-wrap"><p style="color:#fff">Connecting to your data...</p></div>`;
    return;
  }
  if (STATE.users.length === 0) {
    root.innerHTML = renderLogin("setup");
    return;
  }
  const user = currentUser();
  if (!user) {
    root.innerHTML = renderLogin("login");
    return;
  }
  root.innerHTML = renderShell(user);
  renderCharts();
}

function renderSetupNotice() {
  return `
  <div class="login-wrap">
    <div class="login-card" style="max-width:420px;text-align:left">
      <h1 style="text-align:center">One-time setup needed</h1>
      <p class="login-sub" style="text-align:center">This site needs to be connected to your cloud database before it can be used.</p>
      <p style="font-size:12.5px;color:#6b7280;line-height:1.6">
        Open <code>app.js</code> in the site folder, find the <code>firebaseConfig</code>
        section near the top, and paste in the config values from your Firebase project
        (Firebase Console → Project settings → Your apps → Web app). Save the file and
        re-upload it, then reload this page.
      </p>
    </div>
  </div>`;
}

/* ---------- LOGIN ---------- */
function renderLogin(mode) {
  return `
  <div class="login-wrap">
    <div class="login-card">
      <div class="login-mark">EE</div>
      <h1>E.E.MSANGO COMPANY LIMITED</h1>
      <p class="login-sub">${mode === "setup" ? "Create the first admin account to secure your system" : "Sign in to continue"}</p>
      ${mode === "setup" ? `<input id="login-name" class="field" placeholder="Your name">` : ""}
      <input id="login-username" class="field" placeholder="Username">
      <input id="login-password" class="field" type="password" placeholder="Password" onkeydown="if(event.key==='Enter'){${mode === "setup" ? "" : "handleLogin();"}}">
      ${mode === "setup" ? `<input id="login-password2" class="field" type="password" placeholder="Confirm Password">` : ""}
      ${UI.authError ? `<p class="login-error">${esc(UI.authError)}</p>` : ""}
      <button class="btn btn-primary btn-block" onclick="${mode === "setup" ? "handleSetup()" : "handleLogin()"}">
        ${mode === "setup" ? "Create Admin Account" : "Sign In"}
      </button>
    </div>
  </div>`;
}

function handleSetup() {
  const name = document.getElementById("login-name").value.trim();
  const username = document.getElementById("login-username").value.trim();
  const pw = document.getElementById("login-password").value;
  const pw2 = document.getElementById("login-password2").value;
  UI.authError = null;
  if (!name || !username) { UI.authError = "Please enter your name and a username."; return rerender(); }
  if (!pw || pw.length < 4) { UI.authError = "Password must be at least 4 characters."; return rerender(); }
  if (pw !== pw2) { UI.authError = "Passwords do not match."; return rerender(); }
  const admin = { id: uid(), name, username, password: pw, role: "admin" };
  STATE.users = [admin];
  saveUsers();
  setSession(admin.id);
  rerender();
}

function handleLogin() {
  const username = document.getElementById("login-username").value.trim();
  const pw = document.getElementById("login-password").value;
  UI.authError = null;
  const match = STATE.users.find((u) => u.username === username && u.password === pw);
  if (!match) { UI.authError = "Incorrect username or password."; return rerender(); }
  setSession(match.id);
  rerender();
}

function handleLogout() {
  setSession(null);
  UI.page = "dashboard";
  rerender();
}

/* ---------- SHELL ---------- */
function renderShell(user) {
  const active = STATE.entries.filter((e) => !e.archived);
  const dueCount = active.filter((e) => dueStatus(e)).length + lowStockCount();
  const isAdmin = user.role === "admin";

  const titles = {
    dashboard: ["Dashboard", "Overview of all your debts"],
    owed: ["Debtors", "People who owe you money"],
    owe: ["Creditors", "People you owe money"],
    reports: ["Reports", "Business performance over time"],
    alerts: ["Alerts", "Everything due today or overdue"],
    products: ["Products", "Items you sell, for faster order entry"],
    mainstore: ["Main Store", "Stock received and dispatched"],
    users: ["Users", "Manage who can access this system"],
    settings: ["Settings", "Manage your account security"],
  };
  const [title, sub] = titles[UI.page] || titles.dashboard;

  const canViewFinancials = isAdmin || user.canViewFinancials;
  const menuItems = [
    ["dashboard", "🏠", "Dashboard"],
    ...(canViewFinancials ? [["owed", "👤", "Debtors"], ["owe", "💼", "Creditors"]] : []),
    ["products", "📦", "Products"],
    ["mainstore", "🏬", "Main Store"],
    ...(canViewFinancials ? [["reports", "📊", "Reports"]] : []),
    ["alerts", "🔔", "Alerts"],
    ...(isAdmin ? [["users", "👥", "Users"]] : []),
    ["settings", "⚙️", "Settings"],
  ];

  return `
  <div class="shell">
    <aside class="sidebar">
      <div class="logo">
        <div class="logo-mark">EE</div>
        <div><h2>E.E.MSANGO CO. LTD</h2><small>Manage • Track • Grow</small></div>
      </div>
      <ul class="menu">
        ${menuItems.map(([id, icon, label]) => `
          <li class="${UI.page === id ? "active" : ""}" onclick="setPage('${id}')">
            ${icon} <span>${label}</span>
            ${id === "alerts" && dueCount > 0 ? `<span class="menu-badge">${dueCount}</span>` : ""}
          </li>`).join("")}
      </ul>
      <div class="sidebar-bottom">Better Financial Control<br>for a Stronger Business</div>
    </aside>

    <main class="main">
      <header class="topbar">
        <div class="search">🔍&nbsp;
          <input id="search-input" placeholder="Search by name..." value="${esc(UI.search)}" oninput="UI.search=this.value; rerender();">
        </div>
        <div class="profile">
          <button class="bell-wrap" onclick="setPage('alerts')">🔔${dueCount > 0 ? `<span class="bell-dot">${dueCount}</span>` : ""}</button>
          <div class="avatar"></div>
          <div><strong>${esc(user.name)}</strong><br><small>${user.role === "admin" ? "Administrator" : "Staff"}</small></div>
          <button class="logout-btn" onclick="handleLogout()">⏻ Logout</button>
        </div>
      </header>

      <section class="content">
        <div class="page-header">
          <div><h1>${title}</h1><p>${sub}</p></div>
          <div class="date">📅 Today: ${todayStr()}</div>
        </div>

        ${UI.err ? `<div class="err-banner">${esc(UI.err)}<button onclick="UI.err=null;rerender();">✕</button></div>` : ""}

        ${renderPage(UI.page, user, isAdmin)}
      </section>
    </main>
    ${UI.receiptEntryId ? renderReceiptModal() : ""}
    ${UI.deliveryNoteId ? renderDeliveryNoteModal() : ""}
    <datalist id="product-datalist">
      ${STATE.products.map((p) => `<option value="${esc(p.name)}">`).join("")}
    </datalist>
  </div>`;
}

function setPage(p) { UI.page = p; UI.receiptEntryId = null; rerender(); }

function renderPage(page, user, isAdmin) {
  const canViewFinancials = isAdmin || user.canViewFinancials;
  if (page === "dashboard") return renderDashboard();
  if (page === "reports") return canViewFinancials ? guardFinancials(renderReports) : accessDenied();
  if (page === "alerts") return renderAlerts();
  if (page === "products") return renderProductsPage();
  if (page === "mainstore") return renderMainStorePage();
  if (page === "users" && isAdmin) return renderUsersPage(user);
  if (page === "owed") return canViewFinancials ? guardFinancials(() => renderColumnPage("owed_to_me")) : accessDenied();
  if (page === "owe") return canViewFinancials ? guardFinancials(() => renderColumnPage("i_owe")) : accessDenied();
  if (page === "settings") return renderSettings(user);
  return renderDashboard();
}

function accessDenied() {
  return `<div class="panel"><p class="empty-note">You don't have permission to view this section. Ask an admin for access.</p></div>`;
}

function guardFinancials(renderFn) {
  if (UI.financialsUnlocked) return renderFn();
  return `
  <div class="panel settings-panel">
    <h3>🔒 This section is protected</h3>
    <p style="font-size:12.5px;color:#6b7280;margin-bottom:4px">Enter the reports password to view Debtors, Creditors and Reports.</p>
    <input id="fin-pw" class="field" type="password" placeholder="Password" value="${esc(UI.finPasswordInput)}" oninput="UI.finPasswordInput=this.value" onkeydown="if(event.key==='Enter')unlockFinancials()">
    ${UI.finPasswordError ? `<p class="settings-msg err">${esc(UI.finPasswordError)}</p>` : ""}
    <button class="btn btn-primary" onclick="unlockFinancials()">Unlock</button>
  </div>`;
}
function unlockFinancials() {
  const pw = document.getElementById("fin-pw").value;
  if (pw === (STATE.settings.reportsPassword || "eric1234")) {
    UI.financialsUnlocked = true;
    UI.finPasswordError = null;
  } else {
    UI.finPasswordError = "Incorrect password.";
  }
  rerender();
}

/* ---------- PRODUCTS ---------- */
function renderProductsPage() {
  return `
  <div class="panel">
    <h3>Your Products</h3>
    ${STATE.products.length === 0 ? `<p class="empty-note">No products added yet.</p>` : `
    <div class="user-list">
      ${STATE.products.map((p) => `
        <div class="user-row">
          <div class="user-row-main"><span class="user-name">${esc(p.name)}</span><span class="user-detail">${fmt(p.price)}</span></div>
          <button class="icon-btn" onclick="removeProduct('${p.id}')">🗑️</button>
        </div>`).join("")}
    </div>`}
  </div>
  <div class="panel settings-panel" style="margin-top:16px">
    <h3>➕ Add Product</h3>
    <input id="pr-name" class="field" placeholder="Product name">
    <input id="pr-price" class="field" type="text" inputmode="decimal" placeholder="Default price (TSh)" oninput="this.value=sanitizeNum(this.value)">
    ${UI.userMsg && UI.userMsg.forProduct ? `<p class="settings-msg ${UI.userMsg.ok ? "ok" : "err"}">${esc(UI.userMsg.text)}</p>` : ""}
    <button class="btn btn-primary" onclick="addProduct()">Add Product</button>
  </div>`;
}
function addProduct() {
  const name = document.getElementById("pr-name").value.trim();
  const price = Number(document.getElementById("pr-price").value);
  if (!name) { UI.userMsg = { ok: false, text: "Enter a product name.", forProduct: true }; return rerender(); }
  if (STATE.products.some((p) => p.name.toLowerCase() === name.toLowerCase())) {
    UI.userMsg = { ok: false, text: "That product already exists.", forProduct: true }; return rerender();
  }
  STATE.products.push({ id: uid(), name, price: price || 0 });
  saveProducts();
  UI.userMsg = { ok: true, text: `${name} added.`, forProduct: true };
  rerender();
}
function removeProduct(id) {
  STATE.products = STATE.products.filter((p) => p.id !== id);
  saveProducts();
  rerender();
}

/* ---------- DASHBOARD ---------- */
function renderDashboard() {
  const active = STATE.entries.filter((e) => !e.archived);
  const owed = active.filter((e) => e.kind === "owed_to_me");
  const owe = active.filter((e) => e.kind === "i_owe");
  const totalReceivable = owed.reduce((s, e) => s + Math.max(balanceOf(e), 0), 0);
  const totalPayable = owe.reduce((s, e) => s + Math.max(balanceOf(e), 0), 0);
  const overdueCount = active.filter((e) => dueStatus(e) === "overdue").length;
  const net = totalReceivable - totalPayable;

  const recentPayments = active
    .flatMap((e) => e.payments.map((p) => ({ ...p, name: e.name, kind: e.kind })))
    .sort((a, b) => (a.date < b.date ? 1 : -1))
    .slice(0, 8);

  return `
  <div class="cards">
    ${statCard("Total Debtors", owed.length, "people who owe you", "blue")}
    ${statCard("Total Creditors", owe.length, "people you owe", "purple")}
    ${statCard("Amount to Collect", fmt(totalReceivable), "outstanding receivables", "green")}
    ${statCard("Amount to Pay", fmt(totalPayable), "outstanding payables", "orange")}
    ${statCard("Overdue", overdueCount, "past due date", "red")}
    ${statCard("Net Position", (net >= 0 ? "+" : "") + fmt(net), "overall balance", "cyan")}
  </div>
  ${renderReminderBar(active)}
  <div class="lower">
    <div class="panel">
      <h3>To Collect vs To Pay</h3>
      <div class="chart-container"><canvas id="chart-collect-pay"></canvas></div>
    </div>
    <div class="panel">
      <h3>Recent Payments</h3>
      ${recentPayments.length === 0 ? `<p class="empty-note">No payments yet.</p>` : `
      <table class="recent-table"><tbody>
        ${recentPayments.map((p) => `
          <tr>
            <td>${esc(p.name)}</td>
            <td><span class="badge ${p.kind === "owed_to_me" ? "paid" : "pending"}">${p.kind === "owed_to_me" ? "They paid" : "I paid"}</span></td>
            <td class="rt-amount">${fmt(p.amount)}</td>
            <td class="rt-date">${p.date}</td>
          </tr>`).join("")}
      </tbody></table>`}
    </div>
  </div>`;
}

function statCard(label, value, sub, colorClass) {
  return `<div class="stat-card ${colorClass}"><h4>${label}</h4><h2>${value}</h2><p>${sub}</p></div>`;
}

function renderReminderBar(active) {
  const due = active.filter((e) => dueStatus(e));
  if (due.length === 0) return "";
  const toCollect = due.filter((e) => e.kind === "owed_to_me");
  const toPay = due.filter((e) => e.kind === "i_owe");
  return `
  <div class="reminder-bar">
    <div class="reminder-title">⚠️ Today's Reminders</div>
    ${toPay.length ? `<div class="reminder-group"><span class="reminder-group-label rust">You need to pay:</span>
      ${toPay.map((e) => `<span class="reminder-chip ${dueStatus(e)}">${esc(e.name)} — ${fmt(balanceOf(e))}</span>`).join("")}</div>` : ""}
    ${toCollect.length ? `<div class="reminder-group"><span class="reminder-group-label green">They need to pay you:</span>
      ${toCollect.map((e) => `<span class="reminder-chip ${dueStatus(e)}">${esc(e.name)} — ${fmt(balanceOf(e))}</span>`).join("")}</div>` : ""}
  </div>`;
}

/* ---------- ALERTS ---------- */
function renderAlerts() {
  const active = STATE.entries.filter((e) => !e.archived);
  const overdue = active.filter((e) => dueStatus(e) === "overdue");
  const dueToday = active.filter((e) => dueStatus(e) === "today");
  return `
  <div class="panel">
    <h3>🔴 Overdue (${overdue.length})</h3>
    ${overdue.length === 0 ? `<p class="empty-note">Nothing overdue. Well done!</p>` : overdue.map(alertRow).join("")}
  </div>
  <div class="panel" style="margin-top:16px">
    <h3>🕒 Due Today (${dueToday.length})</h3>
    ${dueToday.length === 0 ? `<p class="empty-note">Nothing due today.</p>` : dueToday.map(alertRow).join("")}
  </div>
  <div class="panel" style="margin-top:16px">
    <h3>📦 Low Stock (${lowStockCount()})</h3>
    ${lowStockCount() === 0 ? `<p class="empty-note">All stock levels are fine.</p>` : STATE.stockItems.filter((it) => isLowStock(it)).map((it) => `
      <div class="alert">
        <div class="alert-icon overdue">📦</div>
        <div class="alert-body"><strong>${esc(it.name)} is running low</strong><small>Only ${qtyOf(it.id)} left (limit: ${it.lowStockLimit})</small></div>
      </div>`).join("")}
  </div>`;
}
function alertRow(e) {
  const status = dueStatus(e);
  const isPay = e.kind === "i_owe";
  return `
  <div class="alert">
    <div class="alert-icon ${status}">${status === "overdue" ? "⛔" : "🕒"}</div>
    <div class="alert-body">
      <strong>${isPay ? "Pay " + esc(e.name) : "Collect from " + esc(e.name)} — ${fmt(balanceOf(e))}</strong>
      <small>${status === "overdue" ? "Overdue since" : "Due"} ${e.dueDate}${e.phone ? " · " + esc(e.phone) : ""}</small>
    </div>
    <div class="alert-dir ${isPay ? "rust" : "green"}">${isPay ? "↑" : "↓"}</div>
  </div>`;
}

/* ---------- REPORTS ---------- */
function renderReports() {
  const all = STATE.entries;
  const active = all.filter((e) => !e.archived);
  const owed = active.filter((e) => e.kind === "owed_to_me");
  const owe = active.filter((e) => e.kind === "i_owe");

  const topOwed = [...owed].sort((a, b) => balanceOf(b) - balanceOf(a)).filter((e) => balanceOf(e) > 0).slice(0, 5);
  const topOwe = [...owe].sort((a, b) => balanceOf(b) - balanceOf(a)).filter((e) => balanceOf(e) > 0).slice(0, 5);

  const totalIssuedOwed = owed.reduce((s, e) => s + e.amount, 0);
  const totalIssuedOwe = owe.reduce((s, e) => s + e.amount, 0);
  const totalCollected = owed.reduce((s, e) => s + e.payments.reduce((x, p) => x + p.amount, 0), 0);
  const totalPaidOut = owe.reduce((s, e) => s + e.payments.reduce((x, p) => x + p.amount, 0), 0);

  return `
  <div class="cards" style="grid-template-columns:repeat(4,1fr)">
    ${statCard("Issued to Debtors", fmt(totalIssuedOwed), "total credit given", "blue")}
    ${statCard("Collected So Far", fmt(totalCollected), "received from debtors", "green")}
    ${statCard("Owed to Creditors", fmt(totalIssuedOwe), "total credit received", "purple")}
    ${statCard("Paid So Far", fmt(totalPaidOut), "paid to creditors", "orange")}
  </div>
  <div class="panel" style="margin-top:16px">
    <h3>Monthly Volume</h3>
    <div class="chart-container"><canvas id="chart-monthly"></canvas></div>
  </div>
  <div class="lower">
    <div class="panel">
      <h3>Top Outstanding Debtors</h3>
      ${topOwed.length === 0 ? `<p class="empty-note">Nothing outstanding.</p>` : topOwed.map((e) => `
        <div class="rank-row"><span>${esc(e.name)}</span><span class="rank-amt green">${fmt(balanceOf(e))}</span></div>`).join("")}
    </div>
    <div class="panel">
      <h3>Top Outstanding Creditors</h3>
      ${topOwe.length === 0 ? `<p class="empty-note">Nothing outstanding.</p>` : topOwe.map((e) => `
        <div class="rank-row"><span>${esc(e.name)}</span><span class="rank-amt rust">${fmt(balanceOf(e))}</span></div>`).join("")}
    </div>
  </div>`;
}

/* ---------- USERS ---------- */
function renderUsersPage(user) {
  return `
  <div class="panel">
    <h3>Team Members</h3>
    <div class="user-list">
      ${STATE.users.map((u) => `
        <div class="user-row">
          <div class="user-row-main">
            <span class="user-name">${esc(u.name)} ${u.role === "admin" ? "🛡️" : ""}</span>
            <span class="user-detail">@${esc(u.username)} · ${u.role === "admin" ? "Admin" : "Staff"}</span>
          </div>
          ${u.id !== user.id ? `
            <div style="display:flex;gap:6px;align-items:center">
              ${UI.resetUserId === u.id ? `
                <input id="reset-pw-${u.id}" class="field field-sm" type="password" placeholder="New password" style="width:140px">
                <button class="btn btn-sm btn-primary" onclick="submitResetPassword('${u.id}')">Save</button>
                <button class="btn btn-sm btn-ghost" onclick="UI.resetUserId=null;rerender();">Cancel</button>
              ` : `
                <button class="btn btn-sm btn-ghost" onclick="UI.resetUserId='${u.id}';rerender();">🔑 Reset Password</button>
                <button class="icon-btn" onclick="removeUser('${u.id}')">🗑️</button>
              `}
            </div>` : ""}
        </div>`).join("")}
    </div>
  </div>
  <div class="panel settings-panel" style="margin-top:16px">
    <h3>➕ Add Team Member</h3>
    <input id="nu-name" class="field" placeholder="Full name">
    <input id="nu-username" class="field" placeholder="Username">
    <input id="nu-password" class="field" type="password" placeholder="Password">
    <div class="discount-mode-toggle">
      <span>Role:</span>
      <button class="chip-btn ${UI.newUserRole === "staff" ? "active" : ""}" onclick="UI.newUserRole='staff';rerender();">Staff</button>
      <button class="chip-btn ${UI.newUserRole === "admin" ? "active" : ""}" onclick="UI.newUserRole='admin';rerender();">Admin</button>
    </div>
    <label style="display:flex;align-items:center;gap:8px;font-size:12.5px;color:#6b7280;margin-top:2px">
      <input type="checkbox" ${UI.newUserCanViewFinancials ? "checked" : ""} onchange="UI.newUserCanViewFinancials=this.checked;rerender();">
      Can access Debtors / Creditors / Reports
    </label>
    ${UI.userMsg && !UI.userMsg.forProduct ? `<p class="settings-msg ${UI.userMsg.ok ? "ok" : "err"}">${esc(UI.userMsg.text)}</p>` : ""}
    <button class="btn btn-primary" onclick="addUser()">Add Member</button>
  </div>`;
}
function addUser() {
  const name = document.getElementById("nu-name").value.trim();
  const username = document.getElementById("nu-username").value.trim();
  const password = document.getElementById("nu-password").value;
  UI.userMsg = null;
  if (!name || !username || !password) { UI.userMsg = { ok: false, text: "All fields are required." }; return rerender(); }
  if (STATE.users.some((u) => u.username === username)) { UI.userMsg = { ok: false, text: "That username is already taken." }; return rerender(); }
  STATE.users.push({ id: uid(), name, username, password, role: UI.newUserRole, canViewFinancials: UI.newUserCanViewFinancials });
  saveUsers();
  UI.userMsg = { ok: true, text: `${name} added.` };
  UI.newUserCanViewFinancials = false;
  rerender();
}
function submitResetPassword(id) {
  const input = document.getElementById("reset-pw-" + id);
  const pw = input.value;
  if (!pw || pw.length < 4) { UI.userMsg = { ok: false, text: "Password must be at least 4 characters." }; return rerender(); }
  STATE.users = STATE.users.map((u) => (u.id === id ? { ...u, password: pw } : u));
  saveUsers();
  UI.resetUserId = null;
  UI.userMsg = { ok: true, text: "Password reset." };
  rerender();
}
function removeUser(id) {
  STATE.users = STATE.users.filter((u) => u.id !== id);
  saveUsers();
  rerender();
}

/* ---------- SETTINGS ---------- */
function renderSettings(user) {
  const notifStatus = ("Notification" in window) ? Notification.permission : "unsupported";
  return `
  <div class="panel settings-panel">
    <h3>Change My Password</h3>
    <input id="cp-old" class="field" type="password" placeholder="Current password">
    <input id="cp-new" class="field" type="password" placeholder="New password">
    <input id="cp-new2" class="field" type="password" placeholder="Confirm new password">
    ${UI.changeMsg ? `<p class="settings-msg ${UI.changeMsg.ok ? "ok" : "err"}">${esc(UI.changeMsg.text)}</p>` : ""}
    <button class="btn btn-primary" onclick="changePassword()">Save New Password</button>
  </div>

  <div class="panel settings-panel" style="margin-top:16px">
    <h3>🔔 Phone / Browser Alerts</h3>
    <p style="font-size:12px;color:#6b7280">Get an on-screen alert for overdue debts and low stock while this site is open on your phone or computer.</p>
    <p style="font-size:12px;color:#8290a4">Status: ${notifStatus === "granted" ? "Enabled ✅" : notifStatus === "denied" ? "Blocked — enable it in your browser settings" : "Not enabled yet"}</p>
    <button class="btn btn-primary" onclick="enableNotifications()">Enable Alerts</button>
  </div>

  ${user.role === "admin" ? `
  <div class="panel settings-panel" style="margin-top:16px">
    <h3>🔒 Reports Password</h3>
    <p style="font-size:12px;color:#6b7280">This password protects Debtors, Creditors and Reports.</p>
    <input id="fp-current" class="field" type="password" placeholder="Current reports password">
    <input id="fp-new" class="field" type="password" placeholder="New reports password">
    ${UI.finSettingsMsg ? `<p class="settings-msg ${UI.finSettingsMsg.ok ? "ok" : "err"}">${esc(UI.finSettingsMsg.text)}</p>` : ""}
    <button class="btn btn-primary" onclick="changeReportsPassword()">Save Reports Password</button>
  </div>` : ""}`;
}
function enableNotifications() {
  if (!("Notification" in window)) { UI.err = "Your browser does not support notifications."; return rerender(); }
  Notification.requestPermission().then(() => rerender());
}
function changeReportsPassword() {
  const current = document.getElementById("fp-current").value;
  const next = document.getElementById("fp-new").value;
  if (current !== (STATE.settings.reportsPassword || "eric1234")) { UI.finSettingsMsg = { ok: false, text: "Current reports password is incorrect." }; return rerender(); }
  if (!next || next.length < 4) { UI.finSettingsMsg = { ok: false, text: "New password must be at least 4 characters." }; return rerender(); }
  STATE.settings.reportsPassword = next;
  saveSettings();
  UI.finSettingsMsg = { ok: true, text: "Reports password updated." };
  rerender();
}
function changePassword() {
  const user = currentUser();
  const oldPw = document.getElementById("cp-old").value;
  const newPw = document.getElementById("cp-new").value;
  const newPw2 = document.getElementById("cp-new2").value;
  if (oldPw !== user.password) { UI.changeMsg = { ok: false, text: "Current password is incorrect." }; return rerender(); }
  if (!newPw || newPw.length < 4) { UI.changeMsg = { ok: false, text: "New password must be at least 4 characters." }; return rerender(); }
  if (newPw !== newPw2) { UI.changeMsg = { ok: false, text: "New passwords do not match." }; return rerender(); }
  STATE.users = STATE.users.map((u) => (u.id === user.id ? { ...u, password: newPw } : u));
  saveUsers();
  UI.changeMsg = { ok: true, text: "Password changed." };
  rerender();
}

/* ---------- COLUMN PAGE (Debtors / Creditors) ---------- */
function renderColumnPage(kind) {
  const isOwed = kind === "owed_to_me";
  const active = STATE.entries.filter((e) => e.kind === kind && !e.archived);
  const search = UI.search.trim().toLowerCase();
  const filtered = search ? active.filter((e) => e.name.toLowerCase().includes(search)) : active;
  const history = STATE.entries.filter((e) => e.kind === kind && e.archived);
  const total = filtered.reduce((s, e) => s + Math.max(balanceOf(e), 0), 0);
  const accent = isOwed ? "green" : "rust";
  const formKey = isOwed ? "formOwed" : "formOwe";
  const expandedKey = isOwed ? "expandedOwed" : "expandedOwe";
  const showHistKey = isOwed ? "showHistoryOwed" : "showHistoryOwe";

  return `
  <div class="columns single">
    <div class="column ${accent}">
      <div class="column-header">
        <div><h2>${isOwed ? "Debtors" : "Creditors"}</h2><p class="column-sub">${isOwed ? "People who owe you money" : "People you owe money"}</p></div>
        <div class="column-total"><span class="column-total-label">Total</span><span class="column-total-val">${fmt(total)}</span></div>
      </div>
      <div class="column-list">
        ${filtered.length === 0 && !UI[formKey] ? `<p class="empty-note">No records yet.</p>` : ""}
        ${filtered.map((e) => renderCard(e, expandedKey)).join("")}
        ${UI[formKey] ? renderEntryForm(kind) : ""}
      </div>
      ${!UI[formKey] ? `<button class="add-btn" onclick="startAdd('${kind}')">＋ Add ${isOwed ? "Debtor" : "Creditor"}</button>` : ""}
      <button class="history-toggle" onclick="UI.${showHistKey}=!UI.${showHistKey};rerender();">
        🕘 History (${history.length}) ${UI[showHistKey] ? "▲" : "▼"}
      </button>
      ${UI[showHistKey] ? `
        <div class="history-list">
          ${history.length === 0 ? `<p class="empty-note">No history yet.</p>` : history.map((e) => `
            <div class="history-row">
              <div class="history-row-main"><span class="history-name">${esc(e.name)}</span><span class="history-detail">${fmt(e.payments.reduce((s, p) => s + p.amount, 0))} · closed ${e.archivedDate}</span></div>
              <button class="icon-btn restore" onclick="restoreEntry('${e.id}')">↩️</button>
            </div>`).join("")}
        </div>` : ""}
    </div>
  </div>`;
}

function startAdd(kind) {
  const key = kind === "owed_to_me" ? "formOwed" : "formOwe";
  UI[key] = {
    mode: "simple", discountMode: "price", name: "", phone: "", note: "", dueDate: "", amount: "",
    rows: [{ id: uid(), name: "", price: "", discountPrice: "", discountPercent: "", qty: "1" }],
  };
  rerender();
}
function cancelAdd(kind) {
  UI[kind === "owed_to_me" ? "formOwed" : "formOwe"] = null;
  rerender();
}

function renderEntryForm(kind) {
  const key = kind === "owed_to_me" ? "formOwed" : "formOwe";
  const f = UI[key];
  const grandTotal = f.rows.reduce((s, r) => s + lineTotalOf(r, f.discountMode), 0);

  return `
  <div class="entry-form">
    <div class="mode-toggle">
      <button class="mode-btn ${f.mode === "simple" ? "active" : ""}" onclick="setFormField('${kind}','mode','simple')">✎ Simple Amount</button>
      <button class="mode-btn ${f.mode === "items" ? "active" : ""}" onclick="setFormField('${kind}','mode','items')">☰ Itemized Order</button>
    </div>
    <input id="ef-name" class="field" placeholder="Name" value="${esc(f.name)}" oninput="setFormField('${kind}','name',this.value)">
    <input id="ef-phone" class="field" placeholder="Phone (optional)" value="${esc(f.phone)}" oninput="setFormField('${kind}','phone',this.value)">
    ${f.mode === "simple" ? `
      <input id="ef-amount" class="field" type="text" inputmode="decimal" placeholder="Amount (TSh)" value="${esc(f.amount)}" oninput="this.value=sanitizeNum(this.value);setFormField('${kind}','amount',this.value)">
    ` : `
      <div class="items-block">
        <div class="discount-mode-toggle">
          <span>Discount type:</span>
          <button class="chip-btn ${f.discountMode === "price" ? "active" : ""}" onclick="setFormField('${kind}','discountMode','price')">Discounted Price</button>
          <button class="chip-btn ${f.discountMode === "percent" ? "active" : ""}" onclick="setFormField('${kind}','discountMode','percent')">% Discount</button>
        </div>
        <div class="item-row item-row-head">
          <span>Item</span><span>Price</span><span>${f.discountMode === "percent" ? "% Discount" : "Discounted Price"}</span><span>Qty</span><span>Total</span><span></span>
        </div>
        ${f.rows.map((r) => `
          <div class="item-row">
            <input list="product-datalist" id="row-name-${r.id}" class="field field-sm" placeholder="Item" value="${esc(r.name)}" oninput="setRowField('${kind}','${r.id}','name',this.value)" onchange="onRowNameChange('${kind}','${r.id}',this.value)">
            <input id="row-price-${r.id}" class="field field-sm" type="text" inputmode="decimal" placeholder="Price" value="${esc(r.price)}" oninput="this.value=sanitizeNum(this.value);setRowField('${kind}','${r.id}','price',this.value)">
            ${f.discountMode === "percent" ? `
              <input id="row-dp-${r.id}" class="field field-sm" type="text" inputmode="decimal" placeholder="% Discount" value="${esc(r.discountPercent)}" oninput="this.value=sanitizeNum(this.value);setRowField('${kind}','${r.id}','discountPercent',this.value)">
            ` : `
              <input id="row-dp-${r.id}" class="field field-sm" type="text" inputmode="decimal" placeholder="Discounted Price" value="${esc(r.discountPrice)}" oninput="this.value=sanitizeNum(this.value);setRowField('${kind}','${r.id}','discountPrice',this.value)">
            `}
            <input id="row-qty-${r.id}" class="field field-sm" type="text" inputmode="numeric" placeholder="Qty" value="${esc(r.qty)}" oninput="this.value=sanitizeNum(this.value);setRowField('${kind}','${r.id}','qty',this.value)">
            <span class="item-line-total">${fmt(lineTotalOf(r, f.discountMode))}</span>
            ${f.rows.length > 1 ? `<button class="icon-btn" onclick="removeRow('${kind}','${r.id}')">🗑️</button>` : `<span></span>`}
          </div>`).join("")}
        <button class="add-row-btn" onclick="addRow('${kind}')">＋ Add Item</button>
        <div class="grand-total-row"><span>Grand Total</span><span>${fmt(grandTotal)}</span></div>
      </div>
    `}
    <input id="ef-note" class="field" placeholder="Note (optional)" value="${esc(f.note)}" oninput="setFormField('${kind}','note',this.value)">
    <label class="due-label">📅 Due Date (optional — used for reminders)</label>
    <input id="ef-due" class="field" type="date" value="${esc(f.dueDate)}" oninput="setFormField('${kind}','dueDate',this.value)">
    <div class="form-actions">
      <button class="btn btn-ghost" onclick="cancelAdd('${kind}')">Cancel</button>
      <button class="btn btn-primary" onclick="submitEntry('${kind}')">Save</button>
    </div>
  </div>`;
}

function setFormField(kind, field, value) {
  const key = kind === "owed_to_me" ? "formOwed" : "formOwe";
  UI[key][field] = value;
  rerender();
}
function setRowField(kind, rowId, field, value) {
  const key = kind === "owed_to_me" ? "formOwed" : "formOwe";
  UI[key].rows = UI[key].rows.map((r) => (r.id === rowId ? { ...r, [field]: value } : r));
  rerender();
}
function onRowNameChange(kind, rowId, name) {
  const p = STATE.products.find((p) => p.name.toLowerCase() === name.trim().toLowerCase());
  if (p) setRowField(kind, rowId, "price", String(p.price));
}
function addRow(kind) {
  const key = kind === "owed_to_me" ? "formOwed" : "formOwe";
  UI[key].rows.push({ id: uid(), name: "", price: "", discountPrice: "", discountPercent: "", qty: "1" });
  rerender();
}
function removeRow(kind, rowId) {
  const key = kind === "owed_to_me" ? "formOwed" : "formOwe";
  UI[key].rows = UI[key].rows.filter((r) => r.id !== rowId);
  rerender();
}

function submitEntry(kind) {
  const key = kind === "owed_to_me" ? "formOwed" : "formOwe";
  const f = UI[key];
  if (!f.name.trim()) return;
  const grandTotal = f.rows.reduce((s, r) => s + lineTotalOf(r, f.discountMode), 0);
  const finalAmount = f.mode === "simple" ? Number(f.amount) : grandTotal;
  if (!finalAmount || finalAmount <= 0) return;

  let items;
  if (f.mode === "items") {
    items = f.rows.filter((r) => r.name.trim()).map((r) => {
      const price = Number(r.price || 0);
      const qty = Number(r.qty || 0);
      let discountPrice, discountPercent = null;
      if (f.discountMode === "percent") {
        discountPercent = Number(r.discountPercent || 0);
        discountPrice = price * (1 - discountPercent / 100);
      } else {
        discountPrice = Number(r.discountPrice || r.price || 0);
      }
      return { name: r.name.trim(), price, discountPrice, discountPercent, qty, lineTotal: discountPrice * qty };
    });
  }

  const entry = {
    id: uid(), kind, name: f.name.trim(), phone: f.phone.trim(), amount: finalAmount,
    note: f.note.trim(), dueDate: f.dueDate || null, dateCreated: todayStr(), payments: [],
    ...(items && items.length ? { items } : {}),
  };
  STATE.entries.push(entry);
  saveEntries();
  UI[key] = null;
  if (entry.items && entry.items.length) UI.receiptEntryId = entry.id;
  rerender();
}

/* ---------- CARD ---------- */
function renderCard(entry, expandedKey) {
  const paid = entry.payments.reduce((s, p) => s + p.amount, 0);
  const balance = balanceOf(entry);
  const isCleared = balance <= 0;
  const accent = entry.kind === "owed_to_me" ? "green" : "rust";
  const status = dueStatus(entry);
  const expanded = UI[expandedKey] === entry.id;

  return `
  <div class="card ${accent} ${isCleared ? "cleared" : ""}">
    <button class="card-head" onclick="toggleCard('${expandedKey}','${entry.id}')">
      <div class="card-head-main">
        <span class="card-name">${esc(entry.name)}</span>
        <div class="card-meta-row">
          ${entry.phone ? `<span class="card-phone">📞 ${esc(entry.phone)}</span>` : ""}
          ${status ? `<span class="due-badge ${status}">${status === "overdue" ? "Overdue" : "Due Today"} · ${entry.dueDate}</span>` : ""}
        </div>
      </div>
      <div class="card-head-right">
        <span class="card-balance">${isCleared ? "Paid" : fmt(balance)}</span>
        <span>${expanded ? "▲" : "▼"}</span>
      </div>
    </button>
    ${expanded ? `
      <div class="card-body">
        ${entry.note ? `<p class="card-note">${esc(entry.note)}</p>` : ""}
        ${entry.items && entry.items.length ? `
          <div class="items-summary">
            ${entry.items.map((it) => `
              <div class="items-summary-row">
                <span>${esc(it.name)}${it.dateAdded && it.dateAdded !== entry.dateCreated ? ` <span style="color:#a3aebe;font-size:10.5px">(added ${it.dateAdded})</span>` : ""}</span>
                <span class="isr-detail">${it.qty} × ${fmt(it.discountPrice)}${it.discountPercent ? ` (-${it.discountPercent}%)` : ""}</span>
                <span class="isr-total">${fmt(it.lineTotal)}</span>
              </div>`).join("")}
          </div>
          <button class="receipt-link-btn" onclick="UI.receiptEntryId='${entry.id}';rerender();">🖨️ View Receipt</button>
        ` : ""}
        <div class="card-stats">
          <div><span class="stat-label">Total</span><span class="stat-val">${fmt(entry.amount)}</span></div>
          <div><span class="stat-label">Paid</span><span class="stat-val">${fmt(paid)}</span></div>
          <div><span class="stat-label">Remaining Balance</span><span class="stat-val strong">${fmt(Math.max(balance, 0))}</span></div>
        </div>
        ${entry.payments.length ? `
          <div class="payment-history">
            ${entry.payments.map((p) => `<div class="payment-row">📅 <span>${p.date}</span><span class="payment-amt">+${fmt(p.amount)}</span></div>`).join("")}
          </div>` : ""}
        ${!isCleared ? `
          <div class="pay-row">
            <input id="pay-${entry.id}" class="field field-sm" type="text" inputmode="decimal" placeholder="Amount paid" oninput="this.value=sanitizeNum(this.value)" onkeydown="if(event.key==='Enter')recordPayment('${entry.id}')">
            <input id="pay-date-${entry.id}" class="field field-sm" type="date" value="${todayStr()}" title="Payment date">
            <button class="btn btn-sm btn-primary" onclick="recordPayment('${entry.id}')">✓ Record Payment</button>
          </div>` : `
          <button class="archive-btn" onclick="archiveEntry('${entry.id}')">🗄️ Move to History</button>`}
        ${entry.items && entry.items.length ? renderAddItemsSection(entry) : ""}
      </div>` : ""}
  </div>`;
}

function toggleCard(expandedKey, id) {
  UI[expandedKey] = UI[expandedKey] === id ? null : id;
  rerender();
}
function recordPayment(id) {
  const input = document.getElementById("pay-" + id);
  const dateInput = document.getElementById("pay-date-" + id);
  const val = Number(input.value);
  const date = (dateInput && dateInput.value) || todayStr();
  if (!val || val <= 0) return;
  STATE.entries = STATE.entries.map((e) => (e.id === id ? { ...e, payments: [...e.payments, { amount: val, date }].sort((a, b) => (a.date < b.date ? -1 : 1)) } : e));
  saveEntries();
  rerender();
}
function archiveEntry(id) {
  STATE.entries = STATE.entries.map((e) => (e.id === id ? { ...e, archived: true, archivedDate: todayStr() } : e));
  saveEntries();
  rerender();
}
function restoreEntry(id) {
  STATE.entries = STATE.entries.map((e) => (e.id === id ? { ...e, archived: false, archivedDate: null } : e));
  saveEntries();
  rerender();
}

/* ---------- ADD MORE ITEMS TO AN EXISTING ORDER ---------- */
function renderAddItemsSection(entry) {
  const isOpen = UI.addItemsTo && UI.addItemsTo.entryId === entry.id;
  if (!isOpen) {
    return `<button class="add-btn" style="margin-top:8px" onclick="startAddItems('${entry.id}')">＋ Add More Items (another day)</button>`;
  }
  const f = UI.addItemsTo;
  const grandTotal = f.rows.reduce((s, r) => s + lineTotalOf(r, f.discountMode), 0);
  return `
  <div class="items-block" style="margin-top:10px">
    <div class="discount-mode-toggle">
      <span>Discount type:</span>
      <button class="chip-btn ${f.discountMode === "price" ? "active" : ""}" onclick="setAddItemsField('discountMode','price')">Discounted Price</button>
      <button class="chip-btn ${f.discountMode === "percent" ? "active" : ""}" onclick="setAddItemsField('discountMode','percent')">% Discount</button>
    </div>
    <label class="due-label">📅 Date of this addition</label>
    <input id="add-items-date" class="field field-sm" type="date" value="${esc(f.date)}" oninput="setAddItemsField('date',this.value)">
    <div class="item-row item-row-head">
      <span>Item</span><span>Price</span><span>${f.discountMode === "percent" ? "% Discount" : "Discounted Price"}</span><span>Qty</span><span>Total</span><span></span>
    </div>
    ${f.rows.map((r) => `
      <div class="item-row">
        <input list="product-datalist" id="ai-name-${r.id}" class="field field-sm" placeholder="Item" value="${esc(r.name)}" oninput="setAddItemRow('${r.id}','name',this.value)" onchange="onAddItemNameChange('${r.id}',this.value)">
        <input id="ai-price-${r.id}" class="field field-sm" type="text" inputmode="decimal" placeholder="Price" value="${esc(r.price)}" oninput="this.value=sanitizeNum(this.value);setAddItemRow('${r.id}','price',this.value)">
        ${f.discountMode === "percent" ? `
          <input id="ai-dp-${r.id}" class="field field-sm" type="text" inputmode="decimal" placeholder="% Discount" value="${esc(r.discountPercent)}" oninput="this.value=sanitizeNum(this.value);setAddItemRow('${r.id}','discountPercent',this.value)">
        ` : `
          <input id="ai-dp-${r.id}" class="field field-sm" type="text" inputmode="decimal" placeholder="Discounted Price" value="${esc(r.discountPrice)}" oninput="this.value=sanitizeNum(this.value);setAddItemRow('${r.id}','discountPrice',this.value)">
        `}
        <input id="ai-qty-${r.id}" class="field field-sm" type="text" inputmode="numeric" placeholder="Qty" value="${esc(r.qty)}" oninput="this.value=sanitizeNum(this.value);setAddItemRow('${r.id}','qty',this.value)">
        <span class="item-line-total">${fmt(lineTotalOf(r, f.discountMode))}</span>
        ${f.rows.length > 1 ? `<button class="icon-btn" onclick="removeAddItemRow('${r.id}')">🗑️</button>` : `<span></span>`}
      </div>`).join("")}
    <button class="add-row-btn" onclick="addAddItemRow()">＋ Add Item</button>
    <div class="grand-total-row"><span>New Items Total</span><span>${fmt(grandTotal)}</span></div>
    <div class="form-actions">
      <button class="btn btn-ghost" onclick="UI.addItemsTo=null;rerender();">Cancel</button>
      <button class="btn btn-primary" onclick="submitAddItems('${entry.id}')">Save Additions</button>
    </div>
  </div>`;
}
function startAddItems(entryId) {
  UI.addItemsTo = { entryId, discountMode: "price", date: todayStr(), rows: [{ id: uid(), name: "", price: "", discountPrice: "", discountPercent: "", qty: "1" }] };
  rerender();
}
function setAddItemsField(field, value) { UI.addItemsTo[field] = value; rerender(); }
function setAddItemRow(rowId, field, value) {
  UI.addItemsTo.rows = UI.addItemsTo.rows.map((r) => (r.id === rowId ? { ...r, [field]: value } : r));
  rerender();
}
function onAddItemNameChange(rowId, name) {
  const p = STATE.products.find((p) => p.name.toLowerCase() === name.trim().toLowerCase());
  if (p) setAddItemRow(rowId, "price", String(p.price));
}
function addAddItemRow() {
  UI.addItemsTo.rows.push({ id: uid(), name: "", price: "", discountPrice: "", discountPercent: "", qty: "1" });
  rerender();
}
function removeAddItemRow(rowId) {
  UI.addItemsTo.rows = UI.addItemsTo.rows.filter((r) => r.id !== rowId);
  rerender();
}
function submitAddItems(entryId) {
  const f = UI.addItemsTo;
  const newItems = f.rows.filter((r) => r.name.trim() && Number(r.qty) > 0).map((r) => {
    const price = Number(r.price || 0);
    const qty = Number(r.qty || 0);
    let discountPrice, discountPercent = null;
    if (f.discountMode === "percent") {
      discountPercent = Number(r.discountPercent || 0);
      discountPrice = price * (1 - discountPercent / 100);
    } else {
      discountPrice = Number(r.discountPrice || r.price || 0);
    }
    return { name: r.name.trim(), price, discountPrice, discountPercent, qty, lineTotal: discountPrice * qty, dateAdded: f.date };
  });
  if (newItems.length === 0) return;
  const addedTotal = newItems.reduce((s, it) => s + it.lineTotal, 0);
  STATE.entries = STATE.entries.map((e) =>
    e.id === entryId ? { ...e, items: [...e.items, ...newItems], amount: e.amount + addedTotal } : e
  );
  saveEntries();
  UI.addItemsTo = null;
  rerender();
}

/* ---------- MAIN STORE ---------- */
const STOCK_CATEGORIES = ["Sinoray", "Kinglion", "Bicycle", "Normal", "Sali Limited", "Other"];

function qtyOf(itemId) {
  return STATE.stockMovements
    .filter((m) => m.itemId === itemId)
    .reduce((s, m) => s + (m.type === "in" ? m.qty : -m.qty), 0);
}
function isLowStock(item) {
  return item.lowStockLimit != null && item.lowStockLimit !== "" && qtyOf(item.id) <= Number(item.lowStockLimit);
}
function lowStockCount() {
  return STATE.stockItems.filter((it) => isLowStock(it)).length;
}

function renderMainStorePage() {
  const receiveOpen = UI.stockForm !== null;
  const dispatchOpen = UI.dispatchForm !== null;
  return `
  ${lowStockCount() > 0 ? `
  <div class="reminder-bar">
    <div class="reminder-title">⚠️ Low Stock</div>
    <div class="reminder-group">
      ${STATE.stockItems.filter((it) => isLowStock(it)).map((it) => `<span class="reminder-chip overdue">${esc(it.name)} — ${qtyOf(it.id)} left</span>`).join("")}
    </div>
  </div>` : ""}

  <div class="panel">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
      <h3 style="margin:0">Current Stock</h3>
      <div style="display:flex;gap:8px">
        <button class="btn btn-sm btn-primary" onclick="startReceiveStock()">📥 Receive Stock</button>
        <button class="btn btn-sm btn-primary" onclick="startDispatchStock()">📤 Dispatch Stock</button>
      </div>
    </div>
    ${STATE.stockItems.length === 0 ? `<p class="empty-note">No stock items yet. Receive your first delivery to get started.</p>` : `
    <table class="recent-table" style="width:100%">
      <thead><tr><th style="text-align:left;font-size:10.5px;color:#8290a4;padding:6px">Item</th><th style="text-align:left;font-size:10.5px;color:#8290a4;padding:6px">Category</th><th style="text-align:right;font-size:10.5px;color:#8290a4;padding:6px">In Stock</th><th style="text-align:right;font-size:10.5px;color:#8290a4;padding:6px">Low-Stock Limit</th><th></th></tr></thead>
      <tbody>
        ${STATE.stockItems.map((it) => `
          <tr>
            <td style="padding:8px 6px">${esc(it.name)}</td>
            <td style="padding:8px 6px"><span class="badge pending">${esc(it.category)}</span></td>
            <td style="padding:8px 6px;text-align:right;font-weight:700;${isLowStock(it) ? "color:#dc2636" : ""}">${qtyOf(it.id)}</td>
            <td style="padding:8px 6px;text-align:right">
              ${UI.editingLimitId === it.id ? `
                <input id="limit-${it.id}" class="field field-sm" style="width:70px;display:inline-block" type="text" inputmode="numeric" value="${esc(it.lowStockLimit ?? "")}" oninput="this.value=sanitizeNum(this.value)">
                <button class="btn btn-sm btn-primary" onclick="saveLimit('${it.id}')">Save</button>
              ` : `
                ${it.lowStockLimit ?? "—"} <button class="icon-btn" onclick="UI.editingLimitId='${it.id}';rerender();">✏️</button>
              `}
            </td>
            <td style="padding:8px 6px">${isLowStock(it) ? `<span class="badge pending">Low Stock</span>` : `<span class="badge paid">OK</span>`}</td>
          </tr>`).join("")}
      </tbody>
    </table>`}
  </div>

  ${receiveOpen ? renderReceiveForm() : ""}
  ${dispatchOpen ? renderDispatchForm() : ""}

  <div class="panel" style="margin-top:16px">
    <h3>Recent Stock Movements</h3>
    ${STATE.stockMovements.length === 0 ? `<p class="empty-note">No movements yet.</p>` : `
    <table class="recent-table"><tbody>
      ${[...STATE.stockMovements].sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, 12).map((m) => {
        const item = STATE.stockItems.find((it) => it.id === m.itemId);
        return `<tr>
          <td>${item ? esc(item.name) : "—"}</td>
          <td><span class="badge ${m.type === "in" ? "paid" : "pending"}">${m.type === "in" ? "Received" : "Dispatched"}</span></td>
          <td class="rt-amount">${m.qty}</td>
          <td>${m.type === "in" ? esc(m.supplier || "") : esc(m.destination || "")}</td>
          <td class="rt-date">${m.date}</td>
        </tr>`;
      }).join("")}
    </tbody></table>`}
  </div>`;
}

function startReceiveStock() {
  UI.stockForm = { name: "", category: STOCK_CATEGORIES[0], qty: "", supplier: "", date: todayStr(), price: "", lowStockLimit: "" };
  rerender();
}
function renderReceiveForm() {
  const f = UI.stockForm;
  return `
  <div class="entry-form" style="margin-top:12px">
    <h3 style="margin-bottom:4px">📥 Receive Stock</h3>
    <input list="product-datalist" id="rs-name" class="field" placeholder="Item name" value="${esc(f.name)}" oninput="setStockField('name',this.value)">
    <div class="discount-mode-toggle" style="flex-wrap:wrap">
      <span>Category:</span>
      ${STOCK_CATEGORIES.map((c) => `<button class="chip-btn ${f.category === c ? "active" : ""}" onclick="setStockField('category','${c}')">${c}</button>`).join("")}
    </div>
    <input id="rs-qty" class="field" type="text" inputmode="numeric" placeholder="Quantity received" value="${esc(f.qty)}" oninput="this.value=sanitizeNum(this.value);setStockField('qty',this.value)">
    <input id="rs-supplier" class="field" placeholder="From (supplier)" value="${esc(f.supplier)}" oninput="setStockField('supplier',this.value)">
    <label class="due-label">📅 Date received</label>
    <input id="rs-date" class="field" type="date" value="${esc(f.date)}" oninput="setStockField('date',this.value)">
    <input id="rs-price" class="field" type="text" inputmode="decimal" placeholder="Price per unit (optional)" value="${esc(f.price)}" oninput="this.value=sanitizeNum(this.value);setStockField('price',this.value)">
    <input id="rs-limit" class="field" type="text" inputmode="numeric" placeholder="Low-stock alert limit (optional)" value="${esc(f.lowStockLimit)}" oninput="this.value=sanitizeNum(this.value);setStockField('lowStockLimit',this.value)">
    <div class="form-actions">
      <button class="btn btn-ghost" onclick="UI.stockForm=null;rerender();">Cancel</button>
      <button class="btn btn-primary" onclick="submitReceiveStock()">Save</button>
    </div>
  </div>`;
}
function setStockField(field, value) { UI.stockForm[field] = value; rerender(); }
function submitReceiveStock() {
  const f = UI.stockForm;
  if (!f.name.trim() || !f.qty) return;
  let item = STATE.stockItems.find((it) => it.name.toLowerCase() === f.name.trim().toLowerCase());
  if (!item) {
    item = { id: uid(), name: f.name.trim(), category: f.category, lowStockLimit: f.lowStockLimit || null };
    STATE.stockItems.push(item);
  } else if (f.lowStockLimit) {
    item.lowStockLimit = f.lowStockLimit;
  }
  STATE.stockMovements.push({
    id: uid(), itemId: item.id, type: "in", qty: Number(f.qty), supplier: f.supplier.trim(),
    date: f.date || todayStr(), price: f.price ? Number(f.price) : null,
  });
  saveStockItems();
  saveStockMovements();
  UI.stockForm = null;
  rerender();
}
function saveLimit(itemId) {
  const val = document.getElementById("limit-" + itemId).value;
  STATE.stockItems = STATE.stockItems.map((it) => (it.id === itemId ? { ...it, lowStockLimit: val || null } : it));
  saveStockItems();
  UI.editingLimitId = null;
  rerender();
}

function startDispatchStock() {
  UI.dispatchForm = { itemId: STATE.stockItems[0] ? STATE.stockItems[0].id : "", qty: "", destination: "", date: todayStr() };
  rerender();
}
function renderDispatchForm() {
  const f = UI.dispatchForm;
  return `
  <div class="entry-form" style="margin-top:12px">
    <h3 style="margin-bottom:4px">📤 Dispatch Stock</h3>
    <select id="ds-item" class="field" onchange="setDispatchField('itemId',this.value)">
      ${STATE.stockItems.map((it) => `<option value="${it.id}" ${f.itemId === it.id ? "selected" : ""}>${esc(it.name)} (${qtyOf(it.id)} in stock)</option>`).join("")}
    </select>
    <input id="ds-qty" class="field" type="text" inputmode="numeric" placeholder="Quantity to dispatch" value="${esc(f.qty)}" oninput="this.value=sanitizeNum(this.value);setDispatchField('qty',this.value)">
    <input id="ds-dest" class="field" placeholder="Going to (customer / place)" value="${esc(f.destination)}" oninput="setDispatchField('destination',this.value)">
    <label class="due-label">📅 Date</label>
    <input id="ds-date" class="field" type="date" value="${esc(f.date)}" oninput="setDispatchField('date',this.value)">
    <div class="form-actions">
      <button class="btn btn-ghost" onclick="UI.dispatchForm=null;rerender();">Cancel</button>
      <button class="btn btn-primary" onclick="submitDispatchStock()">Save &amp; Create Delivery Note</button>
    </div>
  </div>`;
}
function setDispatchField(field, value) { UI.dispatchForm[field] = value; rerender(); }
function submitDispatchStock() {
  const f = UI.dispatchForm;
  const qty = Number(f.qty);
  if (!f.itemId || !qty || qty <= 0 || !f.destination.trim()) return;
  const available = qtyOf(f.itemId);
  if (qty > available) { UI.err = "Not enough stock available for that quantity."; return rerender(); }
  const movement = { id: uid(), itemId: f.itemId, type: "out", qty, destination: f.destination.trim(), date: f.date || todayStr() };
  STATE.stockMovements.push(movement);
  saveStockMovements();
  UI.dispatchForm = null;
  UI.deliveryNoteId = movement.id;
  rerender();
}

function renderDeliveryNoteModal() {
  const m = STATE.stockMovements.find((x) => x.id === UI.deliveryNoteId);
  if (!m) return "";
  const item = STATE.stockItems.find((it) => it.id === m.itemId);
  return `
  <div class="modal-overlay">
    <div class="modal-stack" style="max-width:520px">
      <div class="receipt-print">
        <div style="text-align:center;margin-bottom:14px">
          <h2 style="margin:0">E.E.MSANGO COMPANY LIMITED</h2>
          <p style="font-size:11.5px;color:#6b7280;margin-top:4px">TIN NO: 118-065-771 &nbsp;·&nbsp; P.O. Box, Arusha</p>
          <p style="font-size:13px;font-weight:700;margin-top:8px;text-decoration:underline">DELIVERY NOTE</p>
        </div>
        <div class="receipt-meta">
          <div>Date: ${m.date}</div>
        </div>
        <table class="receipt-table">
          <thead><tr><th>Item</th><th>Going To</th><th>Quantity</th></tr></thead>
          <tbody><tr><td>${item ? esc(item.name) : ""}</td><td>${esc(m.destination)}</td><td>${m.qty}</td></tr></tbody>
        </table>
        <div class="receipt-total-row"><span>Total Quantity</span><span>${m.qty}</span></div>
        <div style="display:flex;justify-content:space-between;margin-top:40px;gap:20px">
          <div style="flex:1;text-align:center">
            <div style="border-top:1px solid #172033;margin-top:30px;padding-top:4px;font-size:11.5px">Sender's Signature</div>
          </div>
          <div style="flex:1;text-align:center">
            <div style="border-top:1px solid #172033;margin-top:30px;padding-top:4px;font-size:11.5px">Receiver's Signature</div>
          </div>
        </div>
      </div>
      <div class="modal-actions no-print">
        <button class="btn btn-ghost" onclick="UI.deliveryNoteId=null;rerender();">Close</button>
        <button class="btn btn-primary" onclick="window.print()">🖨️ Print</button>
      </div>
    </div>
  </div>`;
}

/* ---------- NOTIFICATIONS (best-effort, only while this site is open) ---------- */
function checkAlertsForNotification() {
  if (!("Notification" in window) || Notification.permission !== "granted") return;
  const active = STATE.entries.filter((e) => !e.archived);
  active.filter((e) => dueStatus(e)).forEach((e) => {
    const key = "due-" + e.id + "-" + e.dueDate;
    if (!notifiedKeys.has(key)) {
      notifiedKeys.add(key);
      new Notification("Payment reminder", { body: `${e.name} — ${fmt(balanceOf(e))} (${dueStatus(e) === "overdue" ? "overdue" : "due today"})` });
    }
  });
  STATE.stockItems.filter((it) => isLowStock(it)).forEach((it) => {
    const key = "stock-" + it.id;
    if (!notifiedKeys.has(key)) {
      notifiedKeys.add(key);
      new Notification("Low stock", { body: `${it.name} — only ${qtyOf(it.id)} left` });
    }
  });
}

/* ---------- RECEIPT ---------- */
function renderReceiptModal() {
  const entry = STATE.entries.find((e) => e.id === UI.receiptEntryId);
  if (!entry) return "";
  return `
  <div class="modal-overlay">
    <div class="modal-stack">
      <div class="receipt-print">
        <h2 class="receipt-title">Receipt</h2>
        <div class="receipt-meta">
          <div><strong>${esc(entry.name)}</strong>${entry.phone ? " · " + esc(entry.phone) : ""}</div>
          <div>Date: ${entry.dateCreated}</div>
          ${entry.dueDate ? `<div>Due Date: ${entry.dueDate}</div>` : ""}
        </div>
        <table class="receipt-table">
          <thead><tr><th>Item</th><th>Price</th><th>Discount</th><th>Qty</th><th>Total</th></tr></thead>
          <tbody>
            ${entry.items.map((it) => `<tr><td>${esc(it.name)}</td><td>${fmt(it.price)}</td><td>${it.discountPercent ? it.discountPercent + "%" : fmt(it.discountPrice)}</td><td>${it.qty}</td><td>${fmt(it.lineTotal)}</td></tr>`).join("")}
          </tbody>
        </table>
        <div class="receipt-total-row"><span>Grand Total</span><span>${fmt(entry.amount)}</span></div>
        ${entry.note ? `<p style="margin-top:10px;font-style:italic;color:#6b7280;font-size:12px">${esc(entry.note)}</p>` : ""}
      </div>
      <div class="modal-actions no-print">
        <button class="btn btn-ghost" onclick="UI.receiptEntryId=null;rerender();">Close</button>
        <button class="btn btn-primary" onclick="window.print()">🖨️ Print</button>
      </div>
    </div>
  </div>`;
}

/* ---------- CHARTS ---------- */
function renderCharts() {
  Object.values(charts).forEach((c) => c && c.destroy());
  charts = {};

  const collectCanvas = document.getElementById("chart-collect-pay");
  if (collectCanvas) {
    const active = STATE.entries.filter((e) => !e.archived);
    const owed = active.filter((e) => e.kind === "owed_to_me");
    const owe = active.filter((e) => e.kind === "i_owe");
    const totalReceivable = owed.reduce((s, e) => s + Math.max(balanceOf(e), 0), 0);
    const totalPayable = owe.reduce((s, e) => s + Math.max(balanceOf(e), 0), 0);
    charts.collectPay = new Chart(collectCanvas, {
      type: "bar",
      data: { labels: ["To Collect", "To Pay"], datasets: [{ data: [totalReceivable, totalPayable], backgroundColor: ["#1677ff", "#e2632b"], borderRadius: 6 }] },
      options: { plugins: { legend: { display: false } }, scales: { y: { ticks: { callback: (v) => (v / 1000).toFixed(0) + "k" } } }, maintainAspectRatio: false },
    });
  }

  const monthlyCanvas = document.getElementById("chart-monthly");
  if (monthlyCanvas) {
    const map = {};
    STATE.entries.forEach((e) => {
      const key = e.dateCreated.slice(0, 7);
      if (!map[key]) map[key] = { Debtors: 0, Creditors: 0 };
      if (e.kind === "owed_to_me") map[key].Debtors += e.amount;
      else map[key].Creditors += e.amount;
    });
    const months = Object.keys(map).sort().slice(-6);
    charts.monthly = new Chart(monthlyCanvas, {
      type: "bar",
      data: {
        labels: months,
        datasets: [
          { label: "Debtors", data: months.map((m) => map[m].Debtors), backgroundColor: "#08b66c", borderRadius: 6 },
          { label: "Creditors", data: months.map((m) => map[m].Creditors), backgroundColor: "#e2632b", borderRadius: 6 },
        ],
      },
      options: { scales: { y: { ticks: { callback: (v) => (v / 1000).toFixed(0) + "k" } } }, maintainAspectRatio: false },
    });
  }
}

/* ---------- boot ---------- */
loadState();
render();
