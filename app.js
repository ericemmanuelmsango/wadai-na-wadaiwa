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
let auth = null;
let docRef = null;
if (CONFIG_IS_SET) {
  firebase.initializeApp(firebaseConfig);
  db = firebase.firestore();
  auth = firebase.auth();
  docRef = db.collection("wadai_na_wadaiwa").doc("data");
}

let STATE = { entries: [], products: [], stockItems: [], stockMovements: [], sales: [], settings: { appPassword: null, reportsPassword: "eric1234" } };
let STATE_LOADED = false;
let AUTH_READY = false;
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
  addItemsTo: null,
  financialsUnlocked: false,
  finPasswordInput: "",
  finPasswordError: null,
  stockForm: null,
  dispatchForm: null,
  deliveryNoteId: null,
  editingLimitId: null,
  editingProductId: null,
  showProductTrash: false,
  showSalesReport: false,
  salesReportUnlocked: false,
  saleForm: null,
  saleMsg: null,
  plFrom: "",
  plTo: "",
  editingMovementId: null,
  logoMsg: null,
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

function logoSvg(size) {
  return `<svg width="${size}" height="${size}" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="eelogo" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="#1677ff"/>
        <stop offset="100%" stop-color="#0b1b30"/>
      </linearGradient>
    </defs>
    <path d="M50 4 L59 14 L73 12 L76 26 L90 31 L86 45 L96 55 L86 65 L90 79 L76 84 L73 98 L59 96 L50 106 L41 96 L27 98 L24 84 L10 79 L14 65 L4 55 L14 45 L10 31 L24 26 L27 12 L41 14 Z"
      transform="scale(0.9) translate(5,-3)" fill="url(#eelogo)"/>
    <circle cx="50" cy="50" r="33" fill="#0d2038"/>
    <text x="50" y="59" font-family="Georgia, serif" font-size="30" font-weight="700" fill="#fff" text-anchor="middle">EE</text>
  </svg>`;
}
function companyLogo(size) {
  if (STATE.settings && STATE.settings.logoBase64) {
    return `<img src="${STATE.settings.logoBase64}" style="width:${size}px;height:${size}px;object-fit:contain;border-radius:${Math.round(size * 0.2)}px">`;
  }
  return logoSvg(size);
}
function handleLogoUpload(input) {
  const file = input.files && input.files[0];
  if (!file) return;
  if (file.size > 700000) { UI.logoMsg = { ok: false, text: "Please choose an image smaller than 700KB." }; return rerender(); }
  const reader = new FileReader();
  reader.onload = () => {
    STATE.settings.logoBase64 = reader.result;
    saveSettings();
    UI.logoMsg = { ok: true, text: "Logo updated." };
    rerender();
  };
  reader.readAsDataURL(file);
}
function removeLogo() {
  STATE.settings.logoBase64 = null;
  saveSettings();
  UI.logoMsg = { ok: true, text: "Removed — using default logo." };
  rerender();
}

function loadState() {
  if (!CONFIG_IS_SET) return;
  // Sign in anonymously in the background — invisible to the user — purely so
  // Firestore's security rules can require "someone went through our app" and
  // block raw outside access. The real gate the user sees is the app password below.
  auth.signInAnonymously().catch(() => {
    UI.err = "Could not connect to the cloud database. Check your internet connection.";
    AUTH_READY = true;
    rerender();
  });
  auth.onAuthStateChanged((u) => {
    if (!u) return;
    AUTH_READY = true;
    if (!docRef._unsub) {
      docRef._unsub = docRef.onSnapshot((doc) => {
        const data = doc.exists ? doc.data() : {};
        STATE.entries = data.entries || [];
        STATE.products = data.products || [];
        STATE.stockItems = data.stockItems || [];
        STATE.stockMovements = data.stockMovements || [];
        STATE.sales = data.sales || [];
        STATE.settings = data.settings || { appPassword: null, reportsPassword: "eric1234" };
        const wasLoaded = STATE_LOADED;
        STATE_LOADED = true;
        if (wasLoaded) checkAlertsForNotification();
        rerender();
      }, () => {
        UI.err = "Access denied by the database. Check your Firestore security rules.";
        STATE_LOADED = true;
        rerender();
      });
    }
    rerender();
  });
}
function saveEntries() { if (docRef) docRef.set({ entries: STATE.entries }, { merge: true }); }
function saveProducts() { if (docRef) docRef.set({ products: STATE.products }, { merge: true }); }
function saveStockItems() { if (docRef) docRef.set({ stockItems: STATE.stockItems }, { merge: true }); }
function saveStockMovements() { if (docRef) docRef.set({ stockMovements: STATE.stockMovements }, { merge: true }); }
function saveSales() { if (docRef) docRef.set({ sales: STATE.sales }, { merge: true }); }
function saveSettings() { if (docRef) docRef.set({ settings: STATE.settings }, { merge: true }); }

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
  if (!AUTH_READY || !STATE_LOADED) {
    root.innerHTML = loadingScreen();
    return;
  }
  if (!STATE.settings.appPassword) {
    root.innerHTML = renderLogin("setup");
    return;
  }
  if (!appUnlocked()) {
    root.innerHTML = renderLogin("login");
    return;
  }
  root.innerHTML = renderShell();
  renderCharts();
}
function loadingScreen() {
  return `<div class="login-wrap"><div class="login-card" style="text-align:center">
    <p style="color:#172033">Connecting to your data...</p>
    ${UI.err ? `<p class="login-error" style="margin-top:10px">${esc(UI.err)}</p>` : ""}
  </div></div>`;
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

/* ---------- LOGIN (one shared app password) ---------- */
function appUnlocked() { return localStorage.getItem("ww_unlocked") === "1"; }

function renderLogin(mode) {
  return `
  <div class="login-wrap">
    <div class="login-card">
      <div class="login-mark">${companyLogo(52)}</div>
      <h1>E.E.MSANGO COMPANY LIMITED</h1>
      <p class="login-sub">${mode === "setup" ? "Set the password that will protect your system" : "Enter the password to continue"}</p>
      <input id="login-password" class="field" type="password" placeholder="Password" onkeydown="if(event.key==='Enter'){${mode === "setup" ? "handleSetup();" : "handleLogin();"}}">
      ${mode === "setup" ? `<input id="login-password2" class="field" type="password" placeholder="Confirm Password" onkeydown="if(event.key==='Enter')handleSetup();">` : ""}
      ${UI.authError ? `<p class="login-error">${esc(UI.authError)}</p>` : ""}
      <button class="btn btn-primary btn-block" onclick="${mode === "setup" ? "handleSetup()" : "handleLogin()"}">
        ${mode === "setup" ? "Set Password" : "Enter"}
      </button>
    </div>
  </div>`;
}

function handleSetup() {
  const pw = document.getElementById("login-password").value;
  const pw2 = document.getElementById("login-password2").value;
  UI.authError = null;
  if (!pw || pw.length < 4) { UI.authError = "Password must be at least 4 characters."; return rerender(); }
  if (pw !== pw2) { UI.authError = "Passwords do not match."; return rerender(); }
  STATE.settings.appPassword = pw;
  saveSettings();
  localStorage.setItem("ww_unlocked", "1");
  rerender();
}

function handleLogin() {
  const pw = document.getElementById("login-password").value;
  UI.authError = null;
  if (pw !== STATE.settings.appPassword) { UI.authError = "Incorrect password."; return rerender(); }
  localStorage.setItem("ww_unlocked", "1");
  rerender();
}

function handleLogout() {
  localStorage.removeItem("ww_unlocked");
  UI.page = "dashboard";
  UI.financialsUnlocked = false;
  rerender();
}

function renderShell() {
  const active = STATE.entries.filter((e) => !e.archived);
  const dueCount = active.filter((e) => dueStatus(e)).length + lowStockCount();

  const titles = {
    dashboard: ["Dashboard", "Overview of all your debts"],
    owed: ["Debtors", "People who owe you money"],
    owe: ["Creditors", "People you owe money"],
    reports: ["Reports", "Business performance over time"],
    alerts: ["Alerts", "Everything due today or overdue"],
    products: ["Products", "Items you sell, for faster order entry"],
    mainstore: ["Main Store", "Stock received and dispatched"],
    sales: ["Sales", "Record what you sold today"],
    settings: ["Settings", "Manage your passwords"],
  };
  const [title, sub] = titles[UI.page] || titles.dashboard;

  const menuItems = [
    ["dashboard", "🏠", "Dashboard"],
    ["owed", "👤", "Debtors"],
    ["owe", "💼", "Creditors"],
    ["products", "📦", "Products"],
    ["mainstore", "🏬", "Main Store"],
    ["sales", "💰", "Sales"],
    ["reports", "📊", "Reports"],
    ["alerts", "🔔", "Alerts"],
    ["settings", "⚙️", "Settings"],
  ];

  return `
  <div class="shell">
    <aside class="sidebar">
      <div class="logo">
        <div class="logo-mark">${companyLogo(38)}</div>
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
          <button class="logout-btn" onclick="handleLogout()">⏻ Lock</button>
        </div>
      </header>

      <section class="content">
        <div class="page-header">
          <div><h1>${title}</h1><p>${sub}</p></div>
          <div class="date">📅 Today: ${todayStr()}</div>
        </div>

        ${UI.err ? `<div class="err-banner">${esc(UI.err)}<button onclick="UI.err=null;rerender();">✕</button></div>` : ""}

        ${renderPage(UI.page)}
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

function renderPage(page) {
  if (page === "dashboard") return renderDashboard();
  if (page === "reports") return guardFinancials(renderReports);
  if (page === "alerts") return renderAlerts();
  if (page === "products") return renderProductsPage();
  if (page === "mainstore") return renderMainStorePage();
  if (page === "sales") return renderSalesPage();
  if (page === "owed") return guardFinancials(() => renderColumnPage("owed_to_me"));
  if (page === "owe") return guardFinancials(() => renderColumnPage("i_owe"));
  if (page === "settings") return renderSettings();
  return renderDashboard();
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
const BULK_PRODUCTS = [
  { name: "SWICH FUNGUO RGM", price: 4000 },
  { name: "SWICH FUNGUO TVS", price: 7000 },
  { name: "SWITCH FUNGUO BM", price: 6000 },
  { name: "SWITCH FUNGUO GN", price: 3500 },
  { name: "SWITCH FUNGUO KING", price: 5000 },
  { name: "SWITCH FUNGUO RGM", price: 4000 },
  { name: "SWITCH FUNGUO SINO 250", price: 6000 },
  { name: "SWITCH FUNGUO SINO GN", price: 6000 },
  { name: "SWITCH FUNGUO SINO YAI", price: 10000 },
  { name: "SWITCH FUNGUO TOP RICH", price: 4000 },
  { name: "SWITCH FUNGUO TVS", price: 6000 },
  { name: "SWITCH KUSHOTO OLD", price: 6000 },
  { name: "T YA CHINI GUTA", price: 38000 },
  { name: "TAA KAPORI SINO R", price: 13000 },
  { name: "TAA KUCHAJI", price: 8500 },
  { name: "TAA MTB BETTRY R/F", price: 7500 },
  { name: "TAA SEWA", price: 4500 },
  { name: "TAA YA GUTA FKN/KING", price: 8000 },
  { name: "TAA ZA KUCHAJI", price: 9000 },
  { name: "TAA ZA KUCHAJI/HORN", price: 9000 },
  { name: "TAIL LAMP BM", price: 6000 },
  { name: "TAIL LAMP CG", price: 8000 },
  { name: "TAIL LAMP GLASS AUJIO", price: 3000 },
  { name: "TAIL LAMP GLASS GN", price: 2000 },
  { name: "TAIL LAMP GLASS XL", price: 2000 },
  { name: "TAIL LAMP GN", price: 10000 },
  { name: "TAIL LAMP GUTA FUPI", price: 5500 },
  { name: "TAIL LAMP GUTA KINGLION", price: 8500 },
  { name: "TAIL LAMP GUTA SINO BIG", price: 6000 },
  { name: "TAIL LAMP GUTA SINO NDOGO", price: 6000 },
  { name: "TAIL LAMP HLX", price: 4500 },
  { name: "TAIL LAMP LENS BM", price: 1800 },
  { name: "TAIL LAMP R SIMBA", price: 15000 },
  { name: "TAIL LAMP XL", price: 4500 },
  { name: "TAIL LAMP XL UREMBO", price: 10000 },
  { name: "TAILAMP AUJIO KAWAIDA", price: 12000 },
  { name: "TAILAMP AUJIO SINO", price: 15000 },
  { name: "TAILAMP GLASS HLX", price: 2000 },
  { name: "TAILAMP YANGA", price: 14000 },
  { name: "TAMBI PANCHA", price: 5500 },
  { name: "TANG BLACK BM OLD", price: 70000 },
  { name: "TANG BLACK SINO", price: 67000 },
  { name: "TANG BMX 125", price: 70000 },
  { name: "TANG BOXER BLACK", price: 70000 },
  { name: "TANG BOXER BLACK RED", price: 70000 },
  { name: "TANG CG", price: 45000 },
  { name: "TANG FLOWER BLACK", price: 65000 },
  { name: "TANG FLOWER RED", price: 65000 },
  { name: "TANG GUTA SINO", price: 90000 },
  { name: "TANG KING YAI RED", price: 80000 },
  { name: "TANG RED SINO", price: 67000 },
  { name: "TANG SIMBA BLACK", price: 65000 },
  { name: "TANG SIMBA RED", price: 65000 },
  { name: "TANG SINO", price: 67000 },
  { name: "TANG SINO MAYAI BLACK", price: 77000 },
  { name: "TANG SINO MAYAI RED", price: 77000 },
  { name: "TANG SINORAY", price: 65000 },
  { name: "TANK MAFUTA GUTA", price: 35000 },
  { name: "TAPET LOW BM", price: 10000 },
  { name: "TAPET LOW BMX125", price: 12000 },
  { name: "TAPET LOW GN", price: 3500 },
  { name: "TAPET LOW KINGLION", price: 6000 },
  { name: "TAPET LOW SINO", price: 6000 },
  { name: "TAPET LOW SINO YAI", price: 12000 },
  { name: "TAPET LOW TAW", price: 4000 },
  { name: "TAPET LOW YUAO", price: 4000 },
  { name: "TAPET SINO YAI", price: 12000 },
  { name: "TAPET TIMING CHAIN 180 SINO", price: 12000 },
  { name: "TAPET UP 150 GN", price: 6000 },
  { name: "TAPET UP GUTTA", price: 12000 },
  { name: "TYRE 110/16 KINGLION", price: 53000 },
  { name: "TYRE 110/16 MITCHEL", price: 46000 },
  { name: "TYRE 110/16 SINORAY", price: 55000 },
  { name: "TYRE 110/16 TOP", price: 56000 },
  { name: "TYRE 110/17 CC", price: 48000 },
  { name: "TYRE 110/17 D.LIFE", price: 52000 },
  { name: "TYRE 110/17 KINGLION", price: 53000 },
  { name: "TYRE 110/17 SINORAY KASHATA", price: 60000 },
  { name: "TYRE 110/16 SINO TOLEO", price: 55000 },
  { name: "TYRE 110/17 SINO TOLEO", price: 55000 },
  { name: "TYRE 110-16 OLAWE", price: 42000 },
  { name: "TYRE 110X16 SANMOTO", price: 58000 },
  { name: "TYRE 275/17 D.LIFE", price: 36000 },
  { name: "TYRE 275/17 TUBELESS SINO", price: 40000 },
  { name: "TYRE 275/18 CC TUBELESS", price: 36000 },
  { name: "TYRE 275/18 D.LIFE KASHATA", price: 36000 },
  { name: "TYRE 275/18 D.LIFE TOLEO", price: 36000 },
  { name: "TYRE 275/18 DOUBLE LIFE", price: 36000 },
  { name: "TYRE 275/18 SANMOTO", price: 38000 },
  { name: "TYRE 275/18 SINO", price: 36000 },
  { name: "TYRE 275/18 TUBE", price: 30000 },
  { name: "TYRE 275/18 CC TOLEO", price: 36000 },
  { name: "TYRE 300/17 DOUBLE LIFE", price: 36000 },
  { name: "TYRE 300/17 KING", price: 43000 },
  { name: "TYRE 300/17 TUBELESS CC", price: 36000 },
  { name: "TYRE 300/18 LE", price: 35000 },
  { name: "TYRE 300/17 KINGLION F", price: 42000 },
  { name: "TYRE 300-18 CC KASHATA TUBELESS", price: 36000 },
  { name: "TYRE 350/18", price: 54000 },
  { name: "TYRE 410/18", price: 50000 },
  { name: "TYRE 500/12 SINO", price: 95000 },
  { name: "TYRE BM 100/17 HAIROD", price: 52000 },
  { name: "TYRE DIAMOND PH", price: 9000 },
  { name: "TYRE F FARASI", price: 30000 },
  { name: "TYRE GUTA RAHISI", price: 75000 },
  { name: "TYRE HARTEX PH", price: 15000 },
  { name: "TYRE KING 500/12", price: 60000 },
  { name: "TYRE KINGSTONE 110/16", price: 60000 },
  { name: "TYRE KINGSTONE 275/18", price: 40000 },
  { name: "TYRE MTB HARTEX 26", price: 13000 },
  { name: "TYRE MTB METRO PANA", price: 15000 },
  { name: "TYRE MTB RALSON 26", price: 13500 },
  { name: "TYRE MTB SZ24", price: 10000 },
  { name: "TYRE MTB SZ26 MTB RAHISI", price: 11000 },
  { name: "TYRE R FARASI", price: 40000 },
  { name: "TYRE RALSON SZ20", price: 9000 },
  { name: "TYRE SINORAY F", price: 33000 },
  { name: "TYRE SIZE 14", price: 6500 },
  { name: "TYRE SONLNK GUTA", price: 88000 },
  { name: "TYRE SZ12", price: 6500 },
  { name: "TYRE SZ14", price: 9000 },
  { name: "TYRE SZ16", price: 8500 },
  { name: "TYRE SZ18", price: 8000 },
  { name: "TYRE SZ18 MTB", price: 7500 },
  { name: "TYRE SZ20", price: 9000 },
  { name: "TYRE SZ22", price: 8000 },
  { name: "TYRE SZ24 SPORT", price: 10000 },
  { name: "TYRE SZ26 SPORT HARTEX", price: 10000 },
  { name: "TYRE SZ27 SPORT", price: 10000 },
  { name: "TYRE SZ27 SPORT KON", price: 10000 },
  { name: "TYRE SZ28 HARTEX SPORT", price: 13000 },
  { name: "TYRE TOPRICH KASHATA R", price: 75000 },
  { name: "U BOLT", price: 500 },
  { name: "U BOLT GUTA", price: 5000 },
  { name: "ULANGA MACHO 12", price: 8000 },
  { name: "UMA AVON", price: 12500 },
  { name: "UMA MTB CHUCHU", price: 7500 },
  { name: "UMA NEELAM PH", price: 9500 },
  { name: "UMA PH ACL", price: 10000 },
  { name: "VALVE SEAL GN", price: 300 },
  { name: "VALVE SEAL TVS", price: 1000 },
  { name: "VALVU KEY SPAANA", price: 700 },
  { name: "VIBATI KINGLION", price: 1500 },
  { name: "VIBATI KINGLION COMP", price: 4000 },
  { name: "VIBATI MADGUD SINO", price: 2000 },
  { name: "VIBATI SHOKUP", price: 3000 },
  { name: "VIBATI SHOKUP SKGO", price: 2000 },
  { name: "VIBATI SINO NEW", price: 2000 },
  { name: "VIBATI TOYO", price: 1000 },
  { name: "VIGOZ PAMP", price: 2000 },
  { name: "VIN TAPE DENKA", price: 750 },
  { name: "VIN TAPE RAHISI", price: 600 },
  { name: "VIRAKA BIG", price: 2500 },
  { name: "VIRAKA KATI", price: 2000 },
  { name: "VIRUNGU INDICATOR", price: 10000 },
  { name: "VIRUNGU STERLING", price: 6500 },
  { name: "VISOR BM", price: 2000 },
  { name: "VISOR HLX", price: 5000 },
  { name: "WAKA WAKA POLICE MACHO 2", price: 2000 },
  { name: "WAKA WAKA POLICE MACHO 4", price: 3000 },
  { name: "WAKAWAKA SIMBA", price: 3000 },
  { name: "WAKAWAKA YANGA", price: 3000 },
  { name: "WATER PUMP", price: 6000 },
  { name: "WATER PUMP COMP SINO", price: 20000 },
  { name: "WATER PUMP GUTA KAWAIDA", price: 12000 },
  { name: "WIRE LOCK BIG", price: 5000 },
  { name: "WIRE PLUG", price: 1200 },
  { name: "WIRE RING BM", price: 10000 },
  { name: "WIRELOCK NO", price: 4000 },
  { name: "WIRELOCK STAR", price: 4000 },
  { name: "WIRERING", price: 22000 },
  { name: "WIRERING BM", price: 10000 },
  { name: "WIRERING GN TAW", price: 12000 },
  { name: "WIRERING GN YUAO", price: 10000 },
  { name: "UMA SZ 20", price: 5500 },
  { name: "UNYAYO BULLDOG", price: 4000 },
  { name: "UREMBO MACHO", price: 5000 },
  { name: "UREMBO SPOKU RANGI", price: 7000 },
  { name: "UZI MOTA BM", price: 300 },
  { name: "UZI MOTO GUTA", price: 1500 },
  { name: "UZI MOTO MNENE", price: 300 },
  { name: "VALI NALI", price: 1000 },
  { name: "VALI SPECIAL", price: 250 },
  { name: "VALVE INGINE TVS", price: 3500 },
  { name: "VALVE ENGINE BM", price: 2000 },
  { name: "VALVE GARD BM", price: 2000 },
  { name: "VALVE GARD GN", price: 2000 },
  { name: "VALVE GUIDE BM", price: 2500 },
  { name: "VALVE GUIDE TVS 150", price: 2000 },
  { name: "VALVE INGINE 180 SINO", price: 8000 },
  { name: "VALVE INGINE 200 SINO", price: 10000 },
  { name: "VALVE INGINE BM 150", price: 3500 },
  { name: "VALVE INGINE BMX 125", price: 3500 },
  { name: "VALVE INGINE CBF", price: 6000 },
  { name: "VALVE INGINE CC200 KICHWA REFU", price: 4000 },
  { name: "VALVE INGINE KINGLION", price: 5000 },
  { name: "VALVE INGINE SINO 150", price: 7500 },
  { name: "VALVE INGINE SINO CC250", price: 11000 },
  { name: "VALVE INGNINE 125 BMX", price: 3500 },
  { name: "VALVE INGNINE 125 GN", price: 2000 },
  { name: "VALVE INGNINE 150 YUAO", price: 2000 },
  { name: "VALVE INGNINE GUTA CC200", price: 4000 },
  { name: "VALVE INGNINE GUTA CC250", price: 4000 },
  { name: "VALVE INGNINE KINGLION 150", price: 7000 },
  { name: "VALVE INGNINE KINGLION T/CHAIN", price: 12000 },
  { name: "VALVE INGNINE LDY GN", price: 2000 },
  { name: "VALVE INGNINE SINO CC200", price: 10000 },
  { name: "VALVE MPIRA", price: 3000 },
  { name: "VALVE SEAL BM", price: 500 },
  { name: "SAPRESA PLUG", price: 500 },
  { name: "SEAL 32-44", price: 500 },
  { name: "SEAL 14-28", price: 500 },
  { name: "SEAL 16-28", price: 500 },
  { name: "SEAL 20-34", price: 500 },
  { name: "SEAL 20-35", price: 500 },
  { name: "SEAL 25-52", price: 4500 },
  { name: "SEAL 27-37 CG", price: 1200 },
  { name: "SEAL 27-38", price: 1500 },
  { name: "SEAL 27-52", price: 3000 },
  { name: "SEAL 29-38", price: 1500 },
  { name: "SEAL 30-40", price: 750 },
  { name: "SEAL 30-42", price: 750 },
  { name: "SEAL 31-43", price: 500 },
  { name: "SEAL 32/43", price: 500 },
  { name: "SEAL 42-55", price: 3000 },
  { name: "SEAL 50-63", price: 3000 },
  { name: "SEAL 55-75", price: 3000 },
  { name: "SEAL BM PC", price: 600 },
  { name: "SEAL GEAR LIVER BM", price: 500 },
  { name: "SEAL GUTA 30-47", price: 2500 },
  { name: "SEAL GUTA MIX", price: 1500 },
  { name: "SEAL KIOO GN", price: 1000 },
  { name: "SEAL KIT GN", price: 1500 },
  { name: "SEAL KITI BM", price: 1500 },
  { name: "SEAL MIGUU SINO", price: 4500 },
  { name: "SEAL SHOKUP 31/43 PAIR", price: 1000 },
  { name: "SEAL SHOKUP BM", price: 500 },
  { name: "SEAL SHOKUP CG", price: 600 },
  { name: "SEAL SHOKUP GUTA SINO", price: 4500 },
  { name: "SEAL SHOKUP TVS", price: 600 },
  { name: "SEAL WATER PUMP", price: 5000 },
  { name: "SEAT BM", price: 30000 },
  { name: "SEAT CG", price: 40000 },
  { name: "SEAT COVER BALL", price: 4000 },
  { name: "SPEED METER CABLE TVS", price: 2000 },
  { name: "SPEED MITA CABLE BM", price: 1700 },
  { name: "SPEED MITA CABLE GN", price: 1300 },
  { name: "SPEED MITA CABLE GUTA", price: 3500 },
  { name: "SPOCKET COVER BM", price: 4000 },
  { name: "SPOCKET COVER TVS", price: 4000 },
  { name: "SPOK MTB SZ26", price: 9000 },
  { name: "SPOKERT F TVS", price: 1500 },
  { name: "SPOKU PH", price: 9000 },
  { name: "SPOKU SZ 24", price: 10000 },
  { name: "SPOKU SZ 26 MTB", price: 10000 },
  { name: "SPOKU SZ 26 SPORT", price: 12000 },
  { name: "SPOKU SZ 27 SPORT", price: 8500 },
  { name: "SPOKU SZ20", price: 9000 },
  { name: "SPOKU TURBO", price: 15000 },
  { name: "SPONCH CLEANER BM", price: 3500 },
  { name: "SPONCH CLEANER GN", price: 1000 },
  { name: "SPONCH STERLING", price: 3500 },
  { name: "SPORKET F BM", price: 1500 },
  { name: "SPORKET F GN", price: 1200 },
  { name: "SPORKET F SINO", price: 1500 },
  { name: "SPORKET F T18", price: 3000 },
  { name: "SPORKET F TIMING", price: 4000 },
  { name: "SPORKET F TIMING CHAIN", price: 3000 },
  { name: "SPORKET F TVS", price: 1500 },
  { name: "SPORKET F WITH LOCK", price: 1200 },
  { name: "SPORKET KINGLION F", price: 2000 },
  { name: "SPORKET SET BM", price: 6500 },
  { name: "SPORKET SET CG", price: 6000 },
  { name: "SPORKET SET GN", price: 5500 },
  { name: "SPORKET T30 NYUMA", price: 8500 },
  { name: "SPORKET T36 NYUMA", price: 8500 },
  { name: "SPORKET TIMING CHAIN BM JUU", price: 3000 },
  { name: "SPORKET XL SET", price: 8000 },
  { name: "SPORT LIGHT 52 BEADS MACHO NYINGI", price: 13000 },
  { name: "SPORT LIGHT ALM", price: 13000 },
  { name: "SPORT LIGHT BB2208", price: 13000 },
  { name: "SPORT LIGHT BLACK", price: 3000 },
  { name: "SPORT LIGHT BOLT NEW", price: 3500 },
  { name: "SPORT LIGHT BULB", price: 4000 },
  { name: "SPORT LIGHT BULB GN", price: 5000 },
  { name: "SPORT LIGHT CG", price: 14000 },
  { name: "SPORT LIGHT FUVU", price: 35000 },
  { name: "SPORT LIGHT FUVU RAHISI", price: 20000 },
  { name: "SPORT LIGHT FUVU WAKAWAKA", price: 37000 },
  { name: "SPORT LIGHT JICHO", price: 5000 },
  { name: "SPORT LIGHT JICHO 2", price: 9000 },
  { name: "SPORT LIGHT KIJANI", price: 4000 },
  { name: "SPORT LIGHT M 3 KIBATI", price: 13000 },
  { name: "SPORT LIGHT MACHO 12", price: 10000 },
  { name: "SPORT LIGHT MACHO3 MOTORDAFISH", price: 10000 },
  { name: "SPORT LIGHT MAINA", price: 12000 },
  { name: "SPORT LIGHT MKANDA", price: 3500 },
  { name: "SPORT LIGHT MWANGA ORG", price: 15000 },
  { name: "SPORT LIGHT NEW", price: 17000 },
  { name: "SPORT LIGHT ORG NO2", price: 12000 },
  { name: "SPORT LIGHT PANA", price: 12000 },
  { name: "SPORT LIGHT RANGI MACHO 2 NEW", price: 45000 },
  { name: "SPORT LIGHT SHANGA", price: 1200 },
  { name: "SPORT LIGHT SQUARE CG", price: 15000 },
  { name: "SPORT LIGHT SUPER MACHO 4", price: 14000 },
  { name: "SPORT LIGHT T2", price: 13000 },
  { name: "SPRAY BLACK", price: 3000 },
  { name: "SPRAY KIJANI", price: 2750 },
  { name: "SPRING BREAK BM", price: 1000 },
  { name: "SPRING JEMB CG", price: 300 },
  { name: "SPRING JEMBE BREAK GN", price: 300 },
  { name: "SIDE COVER BM150 5G RED AND YELLOW", price: 9000 },
  { name: "SIDE COVER BM150 RED", price: 10000 },
  { name: "SIDE COVER BMX", price: 12000 },
  { name: "SIDE COVER CG BLACK", price: 6500 },
  { name: "SIDE COVER CG RED", price: 6500 },
  { name: "SIDE COVER FLOWER BLACK KAWAIDA", price: 7500 },
  { name: "SIDE COVER FLOWER RED KAWAIDA", price: 7500 },
  { name: "SIDE COVER GN 125 BLACK", price: 5000 },
  { name: "SIDE COVER GN 125 RED", price: 5000 },
  { name: "SIDE COVER GN 150 BLACK", price: 6000 },
  { name: "SIDE COVER GN 150 RED", price: 5000 },
  { name: "SIDE COVER GN BLUE", price: 5000 },
  { name: "SIDE COVER GN TAW", price: 7000 },
  { name: "SIDE COVER GUTA", price: 45000 },
  { name: "SIDE COVER HJ 125 BLACK", price: 5500 },
  { name: "SIDE COVER HJ 125 RED", price: 6500 },
  { name: "SIDE COVER HLX 125 BLACK", price: 13000 },
  { name: "SIDE COVER HLX 125 BLUE", price: 12000 },
  { name: "SIDE COVER HLX 125 RED", price: 12000 },
  { name: "SIDE COVER HLX 150 5GEAR BLACK", price: 13000 },
  { name: "SIDE COVER HLX 150 BLACK", price: 13000 },
  { name: "SIDE COVER HLX 150 BLUE", price: 12000 },
  { name: "SIDE COVER HLX 150 NEW", price: 15000 },
  { name: "SIDE COVER HLX 150 RED", price: 12000 },
  { name: "SIDE COVER KING YAI BLACK NEW", price: 22000 },
  { name: "SIDE COVER KING FLOWER RED", price: 13000 },
  { name: "SIDE COVER KING SIMBA BLACK", price: 13000 },
  { name: "SIDE COVER KING SIMBA RED", price: 13000 },
  { name: "SIDE COVER KL 150 BLACK", price: 7500 },
  { name: "SIDE COVER KL 150 CLASSIC BLACK", price: 23000 },
  { name: "SIDE COVER KL 150 RED", price: 8000 },
  { name: "SIDE COVER KL15O CLASS BLK", price: 22000 },
  { name: "SIDE COVER NEW BLACK 180", price: 22000 },
  { name: "SEAT COVER GN", price: 3500 },
  { name: "SEAT COVER KINGLION", price: 4000 },
  { name: "SEAT COVER PH", price: 1000 },
  { name: "SEAT HYROD", price: 39000 },
  { name: "SEAT KING GN", price: 40000 },
  { name: "SEAT SINO KAWAIDA", price: 35000 },
  { name: "SEAT SINO YAI", price: 42000 },
  { name: "SEAT SINORAY UPELE", price: 38000 },
  { name: "SELECTA GEAR", price: 1500 },
  { name: "SELECTOR GEAR FULL", price: 2500 },
  { name: "SENSA GEAR CC 200", price: 5000 },
  { name: "SENSER GEAR GN", price: 2000 },
  { name: "SENSER GEAR GUTTA", price: 4500 },
  { name: "SENSER REJETA GUTA", price: 4000 },
  { name: "SHAFT GEARBOX", price: 9000 },
  { name: "SHAFT SEHEWA", price: 4500 },
  { name: "SHAFT SPORKET BM 5G", price: 6000 },
  { name: "SHAFT SPORKET GUTA SINO", price: 9000 },
  { name: "SHAFT STAND BIG", price: 1500 },
  { name: "SHAFTI SPORKET BM", price: 5500 },
  { name: "SHAFTI SPORKET GN", price: 3500 },
  { name: "SHINGO MTB", price: 3500 },
  { name: "SHOCK UP RUBBER BM", price: 2000 },
  { name: "SHOKUP BM F", price: 65000 },
  { name: "SHOKUP CG F", price: 48000 },
  { name: "SHOKUP F GUTA", price: 265000 },
  { name: "SHOKUP F SANMOTO", price: 65000 },
  { name: "SHOKUP F TVS", price: 65000 },
  { name: "SHOKUP GN F", price: 55000 },
  { name: "SHOKUP GUTA KAVU", price: 50000 },
  { name: "SHOKUP KINGLION GN F", price: 65000 },
  { name: "SHOKUP KINGLION R", price: 40000 },
  { name: "SHOKUP MTB TRED", price: 25000 },
  { name: "SHOKUP R APSONIC", price: 35000 },
  { name: "SHOKUP R BM", price: 35000 },
  { name: "SIDE COVER OG", price: 17000 },
  { name: "SIDE COVER RED", price: 6000 },
  { name: "SIDE COVER SINO 150 YAI RED", price: 16000 },
  { name: "SIDE COVER SINO BLACK KAWAIDA", price: 12000 },
  { name: "SIDE COVER SINO RED KAWAIDA", price: 12000 },
  { name: "SIDE COVER SINO YAI NEW", price: 22000 },
  { name: "SIDE MIRA BM", price: 5500 },
  { name: "SIDE MIRA GUTA", price: 5500 },
  { name: "SIDE MIRA HONDA", price: 5000 },
  { name: "SIDE MIRA KINGLION", price: 7000 },
  { name: "SIDE MIRA NDOGO", price: 6000 },
  { name: "SIDE MIRA TVS", price: 5000 },
  { name: "SIDE MIRROR BJ 100", price: 4000 },
  { name: "SIDE MIRROR BM KEGE", price: 5000 },
  { name: "SIDE MIRROR BM150", price: 5000 },
  { name: "SIDE MIRROR GN", price: 7000 },
  { name: "SIDE MIRROR HLX", price: 5000 },
  { name: "SIDE MIRROR KEGE NDOGO", price: 5000 },
  { name: "SIDE MIRROR NDOGO RANGI", price: 5000 },
  { name: "SIDE MIRROR ROUND BIG", price: 5000 },
  { name: "SILKON BIG BOX", price: 33000 },
  { name: "SILKON BIG PC", price: 2800 },
  { name: "SILKON NDOGO", price: 1500 },
  { name: "SILKON NDOGO BOX", price: 18500 },
  { name: "SOLUTION BIG", price: 11000 },
  { name: "SOLUTION NDOGO", price: 3500 },
  { name: "SPANA BB SET", price: 6000 },
  { name: "SPANA CHAIN GN", price: 5000 },
  { name: "SPANA FRAWIL", price: 5500 },
  { name: "SPANA JEMBE MTB", price: 6000 },
  { name: "SPANA SPOKU", price: 1000 },
  { name: "SPEED GEAR BM", price: 3500 },
  { name: "SPEED GEAR GN", price: 3000 },
  { name: "SPEED METER BM", price: 3000 },
  { name: "SPEED METER CABLE", price: 1700 },
  { name: "SPRING KIKI BM", price: 3500 },
  { name: "SPRING SET BRAKE GUTA", price: 5000 },
  { name: "SPRING SET GN", price: 1000 },
  { name: "SPRING SET GUTA R", price: 115000 },
  { name: "SPRING SHOKUP F", price: 3000 },
  { name: "SPRING SHOKUP GN", price: 5500 },
  { name: "SPRING SHOKUP GUTA", price: 125000 },
  { name: "SPRING SHOKUP MTB", price: 7000 },
  { name: "SPRING STAND BIG", price: 350 },
  { name: "SPRING STAND BM", price: 2000 },
  { name: "SPRING STAND NDOGO", price: 350 },
  { name: "SPRING VALVE BM", price: 3500 },
  { name: "SPRING VALVE GN", price: 3000 },
  { name: "STAD GUTA", price: 2500 },
  { name: "STAD SPORKET BM", price: 1200 },
  { name: "STAD SPORKET CG", price: 1000 },
  { name: "STAD SPORKET GN", price: 1200 },
  { name: "STAND BETTRY", price: 3500 },
  { name: "STAND BIG BM", price: 12000 },
  { name: "STAND BIG GN", price: 7000 },
  { name: "STAND BIG KINGLION", price: 10000 },
  { name: "STAND BIG SINO", price: 10000 },
  { name: "STAND KIBOBO ALMNM", price: 2400 },
  { name: "STAND KUBWA KING LION", price: 10000 },
  { name: "STAND KUBWA SINO", price: 11000 },
  { name: "STAND MAJI ALUM", price: 3000 },
  { name: "STAND MTB", price: 3000 },
  { name: "STAND NDOGO BM", price: 2500 },
  { name: "STAND NDOGO GN", price: 2500 },
  { name: "STAND NDOGO KING", price: 3500 },
  { name: "STAND NDOGO SINO", price: 5000 },
  { name: "STAND PH", price: 7500 },
  { name: "STATA MOTOR TVS 125", price: 28000 },
  { name: "STATER MOTOR 180 SINO", price: 32000 },
  { name: "STATER MOTOR BM", price: 24000 },
  { name: "NATI OIL NO17", price: 300 },
  { name: "NATI SHOKUP GN", price: 400 },
  { name: "NEMBO TANG GN", price: 3000 },
  { name: "NGAO BM", price: 11000 },
  { name: "NGAO BM SET", price: 12000 },
  { name: "NGAO LOVE", price: 15000 },
  { name: "NGAO NGAZI GN", price: 13000 },
  { name: "NGAO RIFLECTOR", price: 30000 },
  { name: "NGAO SILVER SINO", price: 25000 },
  { name: "NGAO TAA F KING", price: 20000 },
  { name: "NGAO TVS", price: 13000 },
  { name: "OIL DUMU MAGIC PETROL", price: 85000 },
  { name: "OIL BRITON", price: 6000 },
  { name: "OIL COOLER GN", price: 3000 },
  { name: "OIL COOLER GUTA", price: 4500 },
  { name: "OIL COOLER GUTA SINO", price: 11000 },
  { name: "OIL COOLER SINO 150-18", price: 10000 },
  { name: "OIL DUMU MAGIC DESEL", price: 85000 },
  { name: "OIL DUMU RAHISI DESEL", price: 80000 },
  { name: "OIL DUMU RAHISI PETROL", price: 80000 },
  { name: "OIL KUPIMA", price: 2500 },
  { name: "OIL MOGAS", price: 8500 },
  { name: "OIL N0 90", price: 3500 },
  { name: "OIL NGUVU", price: 7500 },
  { name: "OIL NO 40", price: 125000 },
  { name: "OIL NO 90", price: 6000 },
  { name: "OIL PUMP CBF KING", price: 11000 },
  { name: "OIL PUMP GN TAW", price: 5000 },
  { name: "OIL PUMP GN YUAO", price: 4500 },
  { name: "OIL PUMP GUTA SINO", price: 10000 },
  { name: "OIL PUMP KINGLION", price: 6000 },
  { name: "OIL RAHISI", price: 5500 },
  { name: "OIL SAL 20W50", price: 6200 },
  { name: "OIL SAL SEA40", price: 6200 },
  { name: "OIL SINORAY", price: 6500 },
  { name: "SHOKUP R DABLE SPRING GN", price: 35000 },
  { name: "SHOKUP R SANMOTO", price: 40000 },
  { name: "SHOKUP R SINO BLK/SILVER", price: 38000 },
  { name: "SHOKUP R V6", price: 35000 },
  { name: "SHOKUP SINO KAWAIDA F", price: 80000 },
  { name: "SHOKUP SINO MAYAI F", price: 80000 },
  { name: "SHOKUP TVS 125 R", price: 36000 },
  { name: "SHOKUP XL", price: 35000 },
  { name: "SHOO MAD", price: 1500 },
  { name: "SHOW SHOKUP KING", price: 5000 },
  { name: "SHOW SHOKUP KING SILVER", price: 4000 },
  { name: "SHOW SHOKUP SINO YAI", price: 12000 },
  { name: "SHOW SHOKUP SINORAY BLK", price: 5000 },
  { name: "SHOW SHOKUP SINORAY SILVER", price: 5000 },
  { name: "SHOW TAA SINO BLACK", price: 10000 },
  { name: "SHOW YA TAA SINO MAYAI PLASTIC RED", price: 10000 },
  { name: "SIDE COVER 125 SILVER BM", price: 9000 },
  { name: "SIDE COVER BM X150 SILVER", price: 9000 },
  { name: "SIDE COVER KING FLOWER BLK", price: 13000 },
  { name: "SIDE COVER SINO YAI BLACK", price: 16000 },
  { name: "SIDE COVER 125 BM BLACK NEW", price: 9000 },
  { name: "SIDE COVER 150 BM BLACK NEW", price: 9000 },
  { name: "SIDE COVER 180 SHAVU BLACK KAWAIDA", price: 18000 },
  { name: "SIDE COVER 180 SINO BLACK", price: 13000 },
  { name: "SIDE COVER 180 SINO RED", price: 13000 },
  { name: "SIDE COVER AUJW BLK", price: 6000 },
  { name: "SIDE COVER AUJW RED", price: 6000 },
  { name: "SIDE COVER BJ100 BLK NA RED", price: 10000 },
  { name: "SIDE COVER BLACK", price: 8000 },
  { name: "SIDE COVER BM", price: 10000 },
  { name: "SIDE COVER BM 150 BLACK", price: 9000 },
  { name: "SIDE COVER BM NEW BLACK", price: 11000 },
  { name: "STATER MOTOR BMX150", price: 30000 },
  { name: "STATER MOTOR CBF", price: 35000 },
  { name: "STATER MOTOR GN", price: 16500 },
  { name: "STATER MOTOR GUTA", price: 23000 },
  { name: "STATER MOTOR KING", price: 25000 },
  { name: "STATER MOTOR SINO 150", price: 22000 },
  { name: "STATER MOTOR SINO 250", price: 35000 },
  { name: "STATER MOTOR TAW", price: 18000 },
  { name: "STATER MOTOR TVS", price: 35000 },
  { name: "STERLING BM", price: 7000 },
  { name: "STERLING GN", price: 6500 },
  { name: "STERLING KINGLION", price: 10000 },
  { name: "STERLING MTB", price: 10000 },
  { name: "STERLING PH", price: 10000 },
  { name: "STERLING ROAD PH", price: 5000 },
  { name: "STERLING SINO", price: 11000 },
  { name: "BREAK BM", price: 1500 },
  { name: "STICK BREAK CC200 GUTTA", price: 6000 },
  { name: "STICK BREAK GN", price: 1000 },
  { name: "STICK OIL", price: 500 },
  { name: "STOP ENGINE GUTA", price: 8000 },
  { name: "STOP ENGINE SINO", price: 8000 },
  { name: "STOP INGINE BM", price: 5000 },
  { name: "STOP INGINE GN", price: 4000 },
  { name: "STOP INGINE NEW", price: 5000 },
  { name: "STUDY ENGINE GN", price: 3500 },
  { name: "SUPER GLUE", price: 300 },
  { name: "SWICH FUNGUO GUTA KAWAIDA Q7", price: 5000 },
  { name: "SWICH FUNGUO BM", price: 6000 },
  { name: "SWICH FUNGUO CG", price: 3000 },
  { name: "SWICH FUNGUO GN", price: 3500 },
  { name: "SWICH FUNGUO GN SINO", price: 6000 },
  { name: "SWICH FUNGUO GN TOP", price: 4000 },
  { name: "SWICH FUNGUO GUTA KING", price: 6000 },
  { name: "SWICH FUNGUO GUTA SINO", price: 6000 },
  { name: "TUBE 500-12", price: 6500 },
  { name: "TUBE HARTEX MTB 26", price: 3200 },
  { name: "TUBE HARTEX PH", price: 3000 },
  { name: "TUBE MTB 26 RAHIS", price: 2500 },
  { name: "TUBE MTB NALI GARI", price: 3000 },
  { name: "TUBE MTB RALSON PANA", price: 5500 },
  { name: "TUBE MTB SZ 29", price: 13000 },
  { name: "TUBE MTB SZ24", price: 3000 },
  { name: "TUBE MTB SZ26", price: 3000 },
  { name: "TUBE PH", price: 3000 },
  { name: "TUBE SPORT 28 NALI NDEFU", price: 9000 },
  { name: "TUBE SPORT SZ24", price: 2600 },
  { name: "TUBE SZ 275/21", price: 4500 },
  { name: "TUBE SZ12", price: 2700 },
  { name: "TUBE SZ14", price: 2700 },
  { name: "TUBE SZ16", price: 2800 },
  { name: "TUBE SZ18", price: 2800 },
  { name: "TUBE SZ20", price: 3000 },
  { name: "TUBE SZ22", price: 2600 },
  { name: "TUBE SZ26 SPORT", price: 3000 },
  { name: "TUBE SZ27", price: 3000 },
  { name: "TULBOX", price: 3000 },
  { name: "TURBO", price: 7000 },
  { name: "TWITER", price: 5000 },
  { name: "TYRE 110/16 SINORAY KASHATA", price: 60000 },
  { name: "TYRE 100/17 D LIFE R", price: 52000 },
  { name: "TYRE 100/17 BM KINGLION R KASHATA", price: 52000 },
  { name: "TYRE 100/17 SINO GALI", price: 60000 },
  { name: "TYRE 100/17 SINO RAHISI", price: 54000 },
  { name: "TYRE 110/16", price: 55000 },
  { name: "TYRE 110/16 CC KASHATA", price: 47000 },
  { name: "TYRE 110/16 CC TOLEO", price: 47000 },
  { name: "TYRE 110/16 D.LIFE KASHATA", price: 53000 },
  { name: "TYRE 110/16 D.LIFE TOLEO", price: 53000 },
  { name: "TAPET UP SINO GUTA", price: 17000 },
  { name: "TENSHEN RABA BM", price: 3000 },
  { name: "TENSHEN RABA TVS", price: 3500 },
  { name: "TENSHENA RABA SINO 150-6", price: 9000 },
  { name: "TERMINAL WIRE RED/BLK", price: 600 },
  { name: "TERMINAL/FIUZ", price: 800 },
  { name: "TIMING CHAIN BM", price: 3500 },
  { name: "TIMING CHAIN KING", price: 10000 },
  { name: "TIMING CHAIN SINO", price: 10000 },
  { name: "TIMING CHAIN TVS", price: 3500 },
  { name: "TOOL BOX", price: 3000 },
  { name: "TOP BM", price: 18000 },
  { name: "TOP CHINI BM", price: 16000 },
  { name: "TOP CHINI CG", price: 12000 },
  { name: "TOP CHINI SINO GN", price: 22000 },
  { name: "TOP CHINI SINO YAI 150", price: 22000 },
  { name: "TOP COVER", price: 12000 },
  { name: "TOP COVER BM", price: 10000 },
  { name: "TOP JUU GN", price: 8500 },
  { name: "TOP JUU SINO GN", price: 18000 },
  { name: "TOP JUU SINO GUTA", price: 38000 },
  { name: "TOP STERLING YA CHINI GN", price: 10000 },
  { name: "TOTAL HIPER CTN", price: 115000 },
  { name: "TOTAL HIPER PC", price: 9700 },
  { name: "TOTAL QUARTS CTN", price: 135000 },
  { name: "TOTAL QUARTS PC", price: 11250 },
  { name: "TRYE 90/90", price: 43000 },
  { name: "TRYE SZ 29", price: 20000 },
  { name: "TUBE 110-16", price: 5000 },
  { name: "TUBE 110-17", price: 4500 },
  { name: "TUBE 275-14", price: 4000 },
  { name: "TUBE 300/18", price: 3500 },
  { name: "TUBE 300-17", price: 4000 },
  { name: "TUBE 400-8", price: 4500 },
  { name: "TUBE 410-18", price: 5000 },
  { name: "WIRERING GUTA SINO", price: 40000 },
  { name: "WIRERING KING", price: 20000 },
  { name: "WIRERING SINORAI", price: 20000 },
  { name: "AJAST TIMING TVS", price: 3000 },
  { name: "ALARM SET", price: 17000 },
  { name: "ANTENA WAKA WAKA", price: 7000 },
  { name: "ARADAIT", price: 3500 },
  { name: "ARADAIT BIG", price: 2750 },
  { name: "ARADAIT BIG BOX", price: 33000 },
  { name: "ARADAIT NDOGO", price: 1200 },
  { name: "B B CUPS BMX KATI", price: 5500 },
  { name: "BALL RANCE BM/VIKOMBE BM", price: 3500 },
  { name: "BALL RANCE CG", price: 3000 },
  { name: "BALL RANCE GN LDY", price: 4000 },
  { name: "BALL RANCE GN/VIKOMBE GN", price: 3500 },
  { name: "BALL RANCE KINGLION", price: 5000 },
  { name: "BALL RANCE SINO", price: 5000 },
  { name: "BALL RANCE TAW", price: 3500 },
  { name: "BALL RANCE TVS", price: 3500 },
  { name: "BATTAN BRAKE MTB", price: 2000 },
  { name: "BATTAN CLUTCH WIRE", price: 300 },
  { name: "BB CUPS FLY PH", price: 1500 },
  { name: "BB CUPS KID PH", price: 1700 },
  { name: "BB CUPS MTB BIG", price: 6000 },
  { name: "BB CUPS MTB NECO", price: 2000 },
  { name: "BB CUPS SEWA", price: 1500 },
  { name: "BB EXCEL ACL PH", price: 1500 },
  { name: "BB EXCEL FLY PH", price: 18000 },
  { name: "BB EXCEL KID PH", price: 21000 },
  { name: "BB EXCEL MTB NUT", price: 20000 },
  { name: "BB SET MTB", price: 5500 },
  { name: "BB SET PH", price: 5500 },
  { name: "BEARING 6001", price: 1000 },
  { name: "BEARING CLUCH CENTER GUTA", price: 2000 },
  { name: "BEARING CLUCH CENTER SET 150", price: 2500 },
  { name: "BEARING CLUCH CETER SET125", price: 2500 },
  { name: "BEARING CLUTCH CENTER 125", price: 2500 },
  { name: "BENDEX GN", price: 4000 },
  { name: "INDICATOR GUTA SINO", price: 4500 },
  { name: "INDICATOR NDOGO GN", price: 2000 },
  { name: "INDICATOR ORG RAHISI", price: 7500 },
  { name: "INDICATOR ORG RGM NJANO", price: 8500 },
  { name: "INDICATOR RGM NEW", price: 10000 },
  { name: "INDICATOR RGM OLD RAHISI", price: 7500 },
  { name: "INDICATOR RGM ORIGINAL WHITE", price: 8500 },
  { name: "INDICATOR SINO FKN ORG", price: 4500 },
  { name: "INDICATOR SINO MAYAI", price: 4500 },
  { name: "INDICATOR TVS/HLX", price: 1800 },
  { name: "INDICATOR XL", price: 2500 },
  { name: "JEMBE BRAKE CG", price: 3500 },
  { name: "JEMBE BREAK BM", price: 7000 },
  { name: "JEMBE BREAK CG", price: 3500 },
  { name: "JEMBE BREAK GN MKUNJO", price: 4000 },
  { name: "JEMBE BREAK GN PANA", price: 4000 },
  { name: "JEMBE BREAK PANGA BLACK", price: 7500 },
  { name: "JEMBE BREAK PANGA BLUE", price: 8500 },
  { name: "JEMBE BREAK PANGA RED", price: 7500 },
  { name: "JEMBE BREAK TVS", price: 7000 },
  { name: "JINO 12 SINORAY", price: 9000 },
  { name: "JINO GEAR BOX KING", price: 15000 },
  { name: "JINO GEAR BOX KINGLION", price: 11000 },
  { name: "JINO GEAR NO 3", price: 5000 },
  { name: "JINO GUTTA SINO T15", price: 10000 },
  { name: "JINO NO11,12 NA13", price: 4000 },
  { name: "JINO OIL COOLER GUTTA", price: 6000 },
  { name: "JINO OIL PUMP", price: 5000 },
  { name: "JINO STAR GUTA", price: 5000 },
  { name: "JINO STATER GN", price: 5000 },
  { name: "JINO STATER GUTA", price: 13000 },
  { name: "JINO T13", price: 4000 },
  { name: "JINO T14-17", price: 10000 },
  { name: "JINO T8", price: 10000 },
  { name: "JINO T9", price: 10000 },
  { name: "KATA CHAIN", price: 6000 },
  { name: "KATA CHAIN BAISKEL", price: 2000 },
  { name: "KATA UPEPO NDOGO", price: 3500 },
  { name: "KENGELE 2TONE", price: 1800 },
  { name: "KENGELE DIRA", price: 1500 },
  { name: "KENGELE PH", price: 2000 },
  { name: "KENGELE RAHISI", price: 1000 },
  { name: "KERIA BM", price: 35000 },
  { name: "KERIA KINGLION", price: 65000 },
  { name: "KERIA MFUPA SINO", price: 40000 },
  { name: "KERIA MTB", price: 9000 },
  { name: "KERIA R SINO SILVER", price: 28000 },
  { name: "KERIA SET GN", price: 45000 },
  { name: "KERIA SINO MFUPA", price: 40000 },
  { name: "KERIA SINORAY BLACK", price: 30000 },
  { name: "KIBAO SINO", price: 2000 },
  { name: "KIBATI PLATE NO AUJIO", price: 2500 },
  { name: "KICK CC200 SINO", price: 10000 },
  { name: "KIFUA CHA CHINI BM", price: 17000 },
  { name: "KIFUA CHA CHINI CG", price: 9000 },
  { name: "KIFUA CHA CHINI GN", price: 11000 },
  { name: "KIFUA CHA JUU GN", price: 9000 },
  { name: "KIFUA ENGINE SINO", price: 11000 },
  { name: "KIFUA FULLY CC200", price: 260000 },
  { name: "KIFUA JUU BM", price: 15500 },
  { name: "KIFUA PH", price: 600 },
  { name: "KIFUA SINO", price: 10000 },
  { name: "KIKI SHAFT BM G5", price: 6000 },
  { name: "KIKI SHAFTI BM", price: 9000 },
  { name: "KIKI SHAFTI GN", price: 6000 },
  { name: "KIKI STATER BM", price: 6000 },
  { name: "KIKI STATER CG", price: 4500 },
  { name: "KIKI STATER GN", price: 3500 },
  { name: "KIKI STATER GUTA BOLT2", price: 6500 },
  { name: "KIKI STATER GUTA SINO", price: 10000 },
  { name: "KIKI STATER KINGLION", price: 8000 },
  { name: "KIKI STATER XL", price: 8000 },
  { name: "KITI MTB KID", price: 7500 },
  { name: "KITI MTB NYATI", price: 8000 },
  { name: "KITI MTB PANA ORG", price: 12000 },
  { name: "KITI MTB PLANET", price: 7000 },
  { name: "KITI MTB RAHISI", price: 6000 },
  { name: "KITI PH BATANI", price: 700 },
  { name: "KITI SEWA", price: 6500 },
  { name: "KITI TOTO", price: 5000 },
  { name: "KOKI MAFUTA BM", price: 3500 },
  { name: "KOKI MAFUTA CG", price: 3500 },
  { name: "KOKI MAFUTA FUNGUO", price: 5000 },
  { name: "KOKI MAFUTA GN", price: 3500 },
  { name: "KOKI MAFUTA GUTA", price: 5000 },
  { name: "KOKI MAFUTA GUTA SINO", price: 4000 },
  { name: "KOKI MAFUTA TVS", price: 1500 },
  { name: "KOKI OIL FULL NO24", price: 1500 },
  { name: "KOKI OIL NO24", price: 500 },
  { name: "LAKE OIL", price: 6500 },
  { name: "LOCK CABLE GN", price: 300 },
  { name: "LOCK CHAIN GN", price: 300 },
  { name: "LOCK CRANK", price: 1000 },
  { name: "LOCK MLANGO GUTA", price: 5000 },
  { name: "LOCK PAD", price: 500 },
  { name: "LOCK SET SINO MAYAI", price: 22000 },
  { name: "LOCK SET BM", price: 15000 },
  { name: "LOCK SET GN", price: 8000 },
  { name: "LOCK SET GN SINO", price: 17000 },
  { name: "LOCK SET KINGLION", price: 25000 },
  { name: "LOCK SET SINO 250", price: 22000 },
  { name: "LOCK SET SINO KAWAIDA", price: 17000 },
  { name: "LOCK SIDE COVER", price: 2500 },
  { name: "LOCK SPOKET GN", price: 500 },
  { name: "MADGUD PLASTIC BLACK KAWAIDA", price: 17000 },
  { name: "MADGUD PLASTIC DOLPHIN", price: 12000 },
  { name: "MADGUD PLASTIC F RED", price: 20000 },
  { name: "MADGUD PLASTIC MSTARI KAPORI BLK", price: 20000 },
  { name: "MADGUD PLASTIC MSTARI KAPORI RED", price: 20000 },
  { name: "MADGUD PLASTIC SHAVU BLACK F", price: 23000 },
  { name: "MADGUD PLASTIC SHAVU RED F", price: 23000 },
  { name: "MADGUD R CHUMA", price: 11000 },
  { name: "MADGUD SINO KAPORI BLACK R", price: 19000 },
  { name: "MADGUD SINO KAPORI RED R", price: 19000 },
  { name: "MADGUD SINO NEW", price: 17000 },
  { name: "MADGUD XL PLASTIC F", price: 10000 },
  { name: "MAEMBE", price: 13000 },
  { name: "MAFTA BREAK BATI", price: 2500 },
  { name: "MAFUTA BREAK", price: 1660 },
  { name: "MAGNETO COIL KINGLION", price: 27000 },
  { name: "MAGNETO COIL BM", price: 16000 },
  { name: "MAGNETO COIL GUTA", price: 17000 },
  { name: "MAGNETO COIL GUTA SINO", price: 24000 },
  { name: "MAGNETO COIL GUTTA T18CC", price: 28000 },
  { name: "MAGNETO COIL HAIROD", price: 10000 },
  { name: "MAGNETO COIL KID", price: 8500 },
  { name: "MAGNETO COIL RGM", price: 10000 },
  { name: "MAGNETO COIL SINO", price: 23000 },
  { name: "MAGNETO COIL TAW", price: 14000 },
  { name: "MAGNETO COIL TOP", price: 12000 },
  { name: "MAGNETO COIL TVS", price: 16000 },
  { name: "MAGNETO COIL YUAO", price: 9500 },
  { name: "MAGNETO COVER COIL KING", price: 27000 },
  { name: "MAGNETO SMAKU CC200", price: 20000 },
  { name: "MAGNETO SMAKU GN", price: 12500 },
  { name: "MAGNETO SMAKU KING", price: 17000 },
  { name: "LOCK SPORKET BM", price: 500 },
  { name: "LOCK VALVE", price: 300 },
  { name: "LUBEX OIL", price: 6750 },
  { name: "MADFLAP BLUE", price: 2000 },
  { name: "MADFLAP F MIX", price: 2000 },
  { name: "MADFLAP R SINO", price: 2000 },
  { name: "MADFLAP RED", price: 2000 },
  { name: "MADFLAP SINO NEW", price: 2000 },
  { name: "MADFLAP YELLOW", price: 2000 },
  { name: "MADFLUP GREEN", price: 2000 },
  { name: "MADFLUP SINORAY 3D", price: 4000 },
  { name: "MADGADI", price: 8000 },
  { name: "MADGUD CHOPA BM", price: 15000 },
  { name: "MADGUD CHUMA AUJIO BLACK R", price: 15000 },
  { name: "MADGUD CHUMA AUJIO BLUE R", price: 15000 },
  { name: "MADGUD CHUMA AUJIO RED R", price: 14000 },
  { name: "MADGUD CHUMA AUJIO SILVER R", price: 15000 },
  { name: "MADGUD CHUMA BM BLACK F", price: 17000 },
  { name: "MADGUD CHUMA F", price: 11000 },
  { name: "MADGUD CHUMA XL BLACK", price: 20000 },
  { name: "MADGUD CHUMA XL BLUE", price: 20000 },
  { name: "MADGUD CHUMA XL RED", price: 20000 },
  { name: "MADGUD COBRA BLACK", price: 23000 },
  { name: "MADGUD COBRA RED", price: 24000 },
  { name: "MADGUD F CG", price: 12000 },
  { name: "MADGUD F GUTA", price: 19000 },
  { name: "MADGUD F TVS BLACK", price: 17000 },
  { name: "MADGUD F TVS BLUE", price: 17000 },
  { name: "MADGUD F TVS RED", price: 17000 },
  { name: "MADGUD GN PLASTIC R", price: 3500 },
  { name: "MADGUD GN R", price: 11000 },
  { name: "MADGUD GUTA F", price: 14000 },
  { name: "MADGUD MTB NDEFU", price: 5000 },
  { name: "MADGUD MTB SAMAKI", price: 5000 },
  { name: "MADGUD PLASTIC BLACK F", price: 17000 },
  { name: "MFUPA EXLETA GN", price: 500 },
  { name: "MGONGO WA KUKU", price: 5000 },
  { name: "MIKONO BREAK ALMNM", price: 4500 },
  { name: "MIKONO BREK MTUMBA", price: 2500 },
  { name: "MIRA HOLDA BM LEFT", price: 1500 },
  { name: "MIRA HOLDA BM RIGHT", price: 1500 },
  { name: "MIRA HOLDA COMP P", price: 3000 },
  { name: "MIRA HOLDA GN", price: 1200 },
  { name: "MIRA HOLDA GN NEW", price: 1500 },
  { name: "MIRA HOLDA SINO", price: 2000 },
  { name: "MIRA HOLDA TVS", price: 2000 },
  { name: "MIRA HOLDER GUTTA", price: 3500 },
  { name: "MIRIJA PUMP", price: 1000 },
  { name: "MIRROR HOLDA COMP P", price: 3000 },
  { name: "MIRROR HOLDA OLD GN", price: 1500 },
  { name: "MIWANI", price: 5000 },
  { name: "MKAA CARBURATOR", price: 300 },
  { name: "MKANDA BETTRY GN", price: 500 },
  { name: "MKANDA SEAT GN", price: 1500 },
  { name: "MKASI BREAK PH", price: 1000 },
  { name: "MKASI GN NO 17", price: 18000 },
  { name: "MKASI KINGLION", price: 22000 },
  { name: "MKASI KIUNO BM", price: 32000 },
  { name: "MKASI KIUNO GN NO19", price: 18000 },
  { name: "MKASI SINORAY", price: 22000 },
  { name: "MKIA BM F", price: 1500 },
  { name: "MKIA BM R", price: 2000 },
  { name: "MKIA ZUCHU", price: 20000 },
  { name: "MOGAS CTN", price: 175000 },
  { name: "MWAMVULI TOYO", price: 36000 },
  { name: "NALI CHUMA", price: 500 },
  { name: "NALI PLASTIC", price: 500 },
  { name: "NAT SEAT GN", price: 500 },
  { name: "NATI NO 17 NA 19", price: 300 },
  { name: "NATI OIL BM", price: 1500 },
  { name: "FRAWIL T16 PH", price: 2500 },
  { name: "FRAWIL T18 PH", price: 2500 },
  { name: "FRAWIL T20", price: 2500 },
  { name: "FREM GN", price: 135000 },
  { name: "FRENJ HUB GUTA", price: 38000 },
  { name: "FRENJA HUB BLACK", price: 13000 },
  { name: "FRENJA HUB BM 150", price: 12000 },
  { name: "FRENJA HUB CG", price: 9000 },
  { name: "FRENJA HUB GN", price: 9000 },
  { name: "FRENJA HUB TVS", price: 15000 },
  { name: "FRONT MAD FLAPER", price: 800 },
  { name: "FULL BREAK CHOMEKA", price: 6500 },
  { name: "FULL BREAK MTB NDEFU", price: 4500 },
  { name: "FULL BREAK PH", price: 7000 },
  { name: "FULL BREAK SPORT MKASI", price: 8000 },
  { name: "GASKET A 150", price: 1500 },
  { name: "GASKET A BLOCK TVS", price: 500 },
  { name: "GASKET A CC200", price: 3500 },
  { name: "GASKET A CC250 GUTA", price: 3500 },
  { name: "GASKET BIG FULL 125", price: 2500 },
  { name: "GASKET BIG FULL 150", price: 2500 },
  { name: "GASKET BLOCK 125", price: 500 },
  { name: "GASKET BLOCK 150 GN", price: 500 },
  { name: "GASKET BLOCK BM", price: 500 },
  { name: "GASKET BLOCK TVS", price: 500 },
  { name: "GASKET CLUCH BM", price: 500 },
  { name: "GASKET CLUCH GN", price: 500 },
  { name: "GASKET CLUTCH BMX125", price: 500 },
  { name: "GASKET CLUTCH SINO", price: 1500 },
  { name: "GASKET CLUTCH TVS", price: 500 },
  { name: "GASKET COIL", price: 500 },
  { name: "GASKET COIL BJ 100", price: 1000 },
  { name: "GASKET COIL BM", price: 500 },
  { name: "GASKET COIL BMX125", price: 500 },
  { name: "GASKET COIL TVS", price: 500 },
  { name: "OIL TOP", price: 6200 },
  { name: "OIL TOTAL", price: 9000 },
  { name: "OKO BIG CTN", price: 55000 },
  { name: "OKO BIG SAL", price: 2000 },
  { name: "OKO NDOGO CTN", price: 72000 },
  { name: "OKO NDOGO SAL", price: 1500 },
  { name: "OPENA GEAR BM", price: 5000 },
  { name: "OPENA GEAR CBF", price: 6000 },
  { name: "OPENA GEAR CG", price: 3500 },
  { name: "OPENA GEAR GN", price: 3500 },
  { name: "OPENA GEAR GUTA", price: 6000 },
  { name: "OPENA GEAR KING", price: 6000 },
  { name: "OPENA GEAR SINO GN", price: 6000 },
  { name: "OPENA GEAR TVS", price: 5000 },
  { name: "ORXY", price: 8000 },
  { name: "ORXY CTN", price: 190000 },
  { name: "PASS BREAK GN", price: 8000 },
  { name: "PEDAL MTB", price: 3500 },
  { name: "PEDAL MTB ALMNM", price: 5000 },
  { name: "PEDAL MTB MSUMARI MDOGO", price: 3500 },
  { name: "PEDAL MTB SKY", price: 3000 },
  { name: "PEDAL PH", price: 4000 },
  { name: "PEDAL SEWA", price: 3000 },
  { name: "PEDAL TOTO", price: 3000 },
  { name: "PEDEL SILVER", price: 8000 },
  { name: "PINION SINO T11", price: 20000 },
  { name: "PINION T10", price: 27000 },
  { name: "PINION T11 NDEFU", price: 10000 },
  { name: "PINION T12", price: 10000 },
  { name: "PINION T13 NDEFU", price: 10000 },
  { name: "PINION T17", price: 17000 },
  { name: "PIPE CALP", price: 3500 },
  { name: "PIPE HYDROLIC GUTA NDEFU", price: 5000 },
  { name: "PIPE HYDROLIC GUTA FUPI", price: 5000 },
  { name: "PIPE KATA", price: 500 },
  { name: "MAGNETO SMAKU SINO GN", price: 20000 },
  { name: "MAGNETO SMAKU SINO GUTA", price: 35000 },
  { name: "MAGNETO SUMAKU BM 150", price: 35000 },
  { name: "MAGNETO SUMAKU KINGLION", price: 17000 },
  { name: "MAIN FORD BM", price: 3500 },
  { name: "MAIN FORD GN", price: 2000 },
  { name: "MAIN FORD GUTA", price: 2500 },
  { name: "MAIN FORD SINO", price: 4000 },
  { name: "MAJI BETRI BARID", price: 17000 },
  { name: "MASHINE BULB", price: 165000 },
  { name: "MASIKIO CG", price: 1200 },
  { name: "MASIKIO INDICATOR GN", price: 1200 },
  { name: "MASIKIO PH BREAK", price: 15000 },
  { name: "MASK", price: 8000 },
  { name: "MASKIO PH", price: 12000 },
  { name: "MASKIO TAA F", price: 6000 },
  { name: "MASKIO TAA MAYAI SINO", price: 12000 },
  { name: "MASTER GUTA SINO", price: 22000 },
  { name: "MBERA NDEFU", price: 500 },
  { name: "MBERA NO 10 BLUE", price: 1000 },
  { name: "MBERA NO 10 GOLD", price: 1000 },
  { name: "MBERA NO 10 NDEFU", price: 500 },
  { name: "MBERA NO 10 NDEFU RANGI", price: 1000 },
  { name: "MBERA NO 13 NDEFU", price: 500 },
  { name: "MENO SET GUTTA", price: 13000 },
  { name: "MFUNIKO COVER COIL", price: 2500 },
  { name: "MFUNIKO OIL BM", price: 1200 },
  { name: "MFUNIKO OIL TVS", price: 2000 },
  { name: "MFUNIKO TANG BM", price: 7000 },
  { name: "MFUNIKO TANG CG", price: 2500 },
  { name: "MFUNIKO TANG GN", price: 3500 },
  { name: "MFUNIKO TANG TVS", price: 6000 },
  { name: "MFUNIKO TANG YAI", price: 10000 },
  { name: "MFUNIKO TANK GUTA", price: 10000 },
  { name: "MFUNIKO TANK MAYAYI", price: 10000 },
  { name: "PLUG GENARETOR", price: 1200 },
  { name: "PLUG GN", price: 1000 },
  { name: "PLUG SINORAY", price: 1200 },
  { name: "PLUG SINORAY TVS", price: 2500 },
  { name: "PLUG SPARK INDIA", price: 1300 },
  { name: "PLUG TAW", price: 1400 },
  { name: "PLUG TVS BAJAJI", price: 1300 },
  { name: "PLUG TVS CROCODILE", price: 1300 },
  { name: "PLUG TVS IRIDIUM", price: 1300 },
  { name: "PLUG TVS ONLY", price: 1300 },
  { name: "PLUG TVS SONLIK", price: 1300 },
  { name: "PLUG YOG", price: 1300 },
  { name: "PRIZA PIPE", price: 1500 },
  { name: "PUMP BIG BLACK", price: 11000 },
  { name: "PUMP BIG PLASTIK", price: 9000 },
  { name: "PUMP BLAC NDOG", price: 6000 },
  { name: "PUMP MTUNGI", price: 10000 },
  { name: "PUMP T MTUNGI", price: 5500 },
  { name: "PUMP T NDOGO", price: 4000 },
  { name: "PUSH ROAD GN", price: 2000 },
  { name: "PUSH ROAD GUTA", price: 6000 },
  { name: "R P M CABLE GN", price: 1200 },
  { name: "RABA BREAK BLACK ALNKEY", price: 10000 },
  { name: "RABA BREAK CHOMEKA", price: 9000 },
  { name: "RABA BREAK PH", price: 6000 },
  { name: "RABA BREAK RAHISI ALNKEY", price: 9000 },
  { name: "RABA BREAK SPORT", price: 5000 },
  { name: "RABA BREK MTUMBA", price: 4000 },
  { name: "RABA FOOT REST BM", price: 2500 },
  { name: "RABA FOOT REST RANGI BM", price: 4000 },
  { name: "RABA TOP COVER BM", price: 1000 },
  { name: "RADIO BIG FUNGUO", price: 25000 },
  { name: "RADIO BLUETOOTH TAXI", price: 15000 },
  { name: "RADIO SINO", price: 21000 },
  { name: "RADIO SPIKA RAOUND", price: 25000 },
  { name: "PIPE SHOKUP BM", price: 20000 },
  { name: "PISTON KITI AUJW", price: 8000 },
  { name: "PISTON 180 SINO", price: 170000 },
  { name: "PISTON CC200 SINO", price: 20000 },
  { name: "PISTON KIT 150 TVS", price: 8000 },
  { name: "PISTON KIT 150+", price: 6000 },
  { name: "PISTON KIT 150++", price: 6000 },
  { name: "PISTON KIT AUJIO 125", price: 8000 },
  { name: "PISTON KIT BMX 125", price: 8000 },
  { name: "PISTON KIT CBF 150", price: 12000 },
  { name: "PISTON KITI BM 150 PLUS2", price: 6000 },
  { name: "PISTON KITI CC200 SINO ONLY", price: 11000 },
  { name: "PISTON KITI 125 BMX PLUS1", price: 8000 },
  { name: "PISTON KITI 125 BMX PLUS2", price: 8000 },
  { name: "PISTON KITI 125 GN", price: 6000 },
  { name: "PISTON KITI 125 TAW", price: 8000 },
  { name: "PISTON KITI 125 TVS", price: 10000 },
  { name: "PISTON KITI 150 YUAO", price: 6500 },
  { name: "PISTON KITI BM 150 PLUS1", price: 8000 },
  { name: "PISTON KITI CC200 KAWAIDA", price: 10000 },
  { name: "PISTON KITI KING 150", price: 11000 },
  { name: "PISTON KITI KING CBF", price: 18000 },
  { name: "PISTON KITI KLP9A++", price: 12000 },
  { name: "PISTON KITI P9 KINGLION", price: 12000 },
  { name: "PISTON KITI SINO 150", price: 9000 },
  { name: "PISTON KITI SINO 250", price: 11000 },
  { name: "PISTON KITI TAW 150", price: 8500 },
  { name: "PISTON KITI TIMEN CHAIN", price: 12000 },
  { name: "PLATE CLUTCH GUTA", price: 6000 },
  { name: "PLATE CLUTCH KING", price: 5000 },
  { name: "PLATE CLUTCH TVS", price: 3500 },
  { name: "PLET DISC", price: 1500 },
  { name: "PLUG SINO TVS", price: 2500 },
  { name: "PLUG BM", price: 1400 },
  { name: "PLUG BM TAW", price: 1500 },
  { name: "BOOT RUBER BM RED", price: 3000 },
  { name: "BOOT RUBER GN BLACK", price: 3000 },
  { name: "BRAKE CALPER GN", price: 13000 },
  { name: "BRAKE HARM BM 150", price: 3000 },
  { name: "BRAKE HARM CG", price: 1200 },
  { name: "BRAKE HARM GN", price: 1500 },
  { name: "BRAKE HARM GUTTA", price: 3500 },
  { name: "BRAKE MASTER RANGI GN KIOO", price: 10000 },
  { name: "BRAKE MASTER GN", price: 7000 },
  { name: "BRAKE MASTER KING", price: 9000 },
  { name: "BRAKE PAD GN", price: 1000 },
  { name: "BRAKE PANEL BM", price: 15000 },
  { name: "BRAKE PANEL CG", price: 9000 },
  { name: "BRAKE PANEL CG BLUE", price: 14000 },
  { name: "BRAKE PANEL GN", price: 10000 },
  { name: "BRAKE PANEL GN BLACK", price: 14000 },
  { name: "BRAKE PANEL GUTA F", price: 20000 },
  { name: "BRAKE PANEL GUTA R 250 SINO", price: 38000 },
  { name: "BRAKE PEDAL SINO", price: 6500 },
  { name: "BRAKE PUMP GUTTA", price: 10000 },
  { name: "BRAKE SHOE GN", price: 2500 },
  { name: "BRAKE SHOE GN SFQZ", price: 3500 },
  { name: "BRAKE SHOE GUTA", price: 6500 },
  { name: "BRAKE SHOE GUTTA ORG SINO 250", price: 11000 },
  { name: "BRAKE SHOE TAW", price: 3500 },
  { name: "BRAKE SWICH F", price: 500 },
  { name: "BRAKE SWICH R", price: 600 },
  { name: "BRASH BM 150 CRODILE", price: 3500 },
  { name: "BRASH BM 4G", price: 3000 },
  { name: "BRASH BMX 125", price: 3500 },
  { name: "BRASH TOYO", price: 3000 },
  { name: "BRASH TVS", price: 3000 },
  { name: "BREAK MASTER GUTA", price: 10000 },
  { name: "BREAK MASTER NEW", price: 35000 },
  { name: "BREAK MASTER RANGI KIOO", price: 10000 },
  { name: "BREAK MASTER SINO YAI", price: 16000 },
  { name: "BREAK PAD KINGLION", price: 1200 },
  { name: "BREAK PAD SINO", price: 1500 },
  { name: "BREAK PANEL R CC200 KAWAIDA", price: 38000 },
  { name: "BREAK SHOE SINORAY", price: 2300 },
  { name: "BREAK SHOE XL", price: 2500 },
  { name: "BREAK SWITCH R", price: 500 },
  { name: "BREAKE SHOE CG", price: 2500 },
  { name: "BREAKE SHOE TAW", price: 2800 },
  { name: "BULB DASH BORD GN RANGI", price: 300 },
  { name: "BULB DASH WAKA WAKA", price: 500 },
  { name: "BULB F BOXER", price: 1500 },
  { name: "BULB F SINO", price: 2500 },
  { name: "BULB FENI", price: 14000 },
  { name: "BULB INDICATOR GN", price: 150 },
  { name: "BULB JICHO WAKA WAKA PEMBENI", price: 5000 },
  { name: "BULB KICHUPA", price: 1300 },
  { name: "BULB PAKING RANG", price: 400 },
  { name: "BULB PAKING WHITE", price: 200 },
  { name: "BULB R GN", price: 250 },
  { name: "BULB R RANGI", price: 1500 },
  { name: "BULB RAHISI F", price: 1200 },
  { name: "BULB SPORT LIGHT WAKA PEMBENI BM", price: 5000 },
  { name: "BULB ZA R RANGI", price: 2000 },
  { name: "BUSH CHUMA TVS NYUMA", price: 3500 },
  { name: "BUSH CLUCH CENTER", price: 3500 },
  { name: "BUSH JEMBE YAI", price: 3000 },
  { name: "BUSH KIUNO NO19", price: 2000 },
  { name: "BUSH SHOKUP", price: 1000 },
  { name: "BUSH SIDE COVER", price: 800 },
  { name: "BUSH SPORKET BM", price: 3500 },
  { name: "BUSH SPORKET GN", price: 1500 },
  { name: "CLUTCH HOUSING 125", price: 9000 },
  { name: "CLUTCH HOUSING 180 SINO", price: 20000 },
  { name: "CLUTCH HOUSING 250 SINO", price: 28000 },
  { name: "CLUTCH HOUSING BM", price: 35000 },
  { name: "CLUTCH HOUSING COMP 180", price: 40000 },
  { name: "CLUTCH HOUSING KING CBF", price: 28000 },
  { name: "CLUTCH HOUSING KING P9", price: 20000 },
  { name: "CLUTCH HOUSING KING SET P9", price: 40000 },
  { name: "CLUTCH HOUSING TAW", price: 13000 },
  { name: "CLUTCH HOUSING TVS", price: 35000 },
  { name: "CLUTCH PLATE SFQZ", price: 4000 },
  { name: "CLUTCH PLATE SINO GN", price: 6000 },
  { name: "CLUTCH RELEASE 125", price: 2500 },
  { name: "COIL KING D", price: 8500 },
  { name: "COIL V6", price: 10000 },
  { name: "COTAPIN KAIT", price: 2000 },
  { name: "COVER BETTRY", price: 5500 },
  { name: "COVER CARBURATOR", price: 5000 },
  { name: "COVER CLUCH CDI", price: 17000 },
  { name: "COVER CLUCH KINGLION", price: 28000 },
  { name: "COVER CLUCH SINO", price: 45000 },
  { name: "COVER CLUCH TOYO", price: 20000 },
  { name: "COVER CLUTCH GUTA", price: 45000 },
  { name: "COVER COIL KINGLION", price: 27000 },
  { name: "COVER COIL SINO", price: 34000 },
  { name: "COVER COIL TOYO", price: 25000 },
  { name: "COVER EXLETA GN", price: 1000 },
  { name: "COVER INGINE 150 BLACK", price: 80000 },
  { name: "COVER INGINE 150 GN SILVER", price: 75000 },
  { name: "COVER INGINE CC250", price: 70000 },
  { name: "COVER INGINE SINO", price: 145000 },
  { name: "COVER PEDAL BIG", price: 2000 },
  { name: "COVER PEDAL NYAU", price: 1500 },
  { name: "COVER POSTION", price: 1200 },
  { name: "COVER SHOKUP PROTAPE", price: 5000 },
  { name: "COVER SPORKET AUJIO", price: 5000 },
  { name: "COVER SPORKET BM", price: 7000 },
  { name: "COVER SPORKET KIDOLE GN", price: 5500 },
  { name: "COVER SPORKET KING", price: 8000 },
  { name: "COVER SPORKET SINO", price: 10000 },
  { name: "COVER SPORKET TOYO", price: 10000 },
  { name: "COVER SWICH GN", price: 1000 },
  { name: "COVER TANG MAJI", price: 12000 },
  { name: "COWLING BLACK BM", price: 7000 },
  { name: "COWLING BM 150 BLACK NEW", price: 5500 },
  { name: "COWLING BM150 RED", price: 7000 },
  { name: "COWLING BM150 RED 5GEAR", price: 5500 },
  { name: "COWLING HLX 150 BLUE", price: 9000 },
  { name: "COWLING HLX BLACK 150", price: 9000 },
  { name: "COWLING HLX RED", price: 9000 },
  { name: "CRANK SHAFT 150 KING", price: 50000 },
  { name: "CRANK SHAFT 150 KING P9A", price: 60000 },
  { name: "CRANK SHAFT 150 MIX", price: 35000 },
  { name: "CRANK SHAFT 150 TAW", price: 38000 },
  { name: "CRANK SHAFT 150 YUAO", price: 36000 },
  { name: "CRANK SHAFT BM 150", price: 36000 },
  { name: "CRANK SHAFT CBF KING", price: 75000 },
  { name: "CRANK SHAFT CC200 KAWAIDA", price: 45000 },
  { name: "CRANK SHAFT CC200 SINO", price: 72000 },
  { name: "CRANK SHAFT CC250 SINO", price: 72000 },
  { name: "CRANK SHAFT KING 150", price: 50000 },
  { name: "CRANK SHAFT SINO 180-18", price: 62000 },
  { name: "CRANK SHAFT SINO 250", price: 70000 },
  { name: "CRANK SHAFT SINO CC200", price: 70000 },
  { name: "CRANK SHAFT TVS 150", price: 40000 },
  { name: "CRANK SHAFTI 125 GN", price: 35000 },
  { name: "CRANK SHAFTI 150 KING D", price: 35000 },
  { name: "CRANK SHAFTI 150 KING P9", price: 55000 },
  { name: "CRANK SHAFTI 150 NGUVU", price: 35000 },
  { name: "CRANK SHAFTI 150 SOMON", price: 35000 },
  { name: "CRANK SHAFTI SINO 150-6", price: 65000 },
  { name: "CRANKSHAFT W8", price: 110000 },
  { name: "CRANKSHAFT 125 TVS", price: 35000 },
  { name: "CRANKSHAFT BM 150", price: 35000 },
  { name: "CRANKSHAFT BMX 150", price: 45000 },
  { name: "CRANKSHAFT BMX125", price: 45000 },
  { name: "CRANKSHAFT KING P9", price: 55000 },
  { name: "CRANKSHAFT SINO 150", price: 60000 },
  { name: "CRANKSHAFT SOMON", price: 35000 },
  { name: "CRANKSHAFT YUAO", price: 35000 },
  { name: "CROSS 19-44", price: 3500 },
  { name: "CROSS BEARING 19/44", price: 4000 },
  { name: "CROSS BEARING 20/50", price: 4000 },
  { name: "CROSS BEARING 20/55", price: 4000 },
  { name: "CROSS BEARING 25-64", price: 6000 },
  { name: "CROSS BEARING SINO 20/50", price: 5000 },
  { name: "CROSS BEARING SINO 20/55", price: 5500 },
  { name: "CROSS JOINT COMPLETE", price: 10000 },
  { name: "CYLENDER HEAD GN", price: 45000 },
  { name: "CYLINDER HEAD BLACK", price: 52000 },
  { name: "CYLINDER HEAD BM", price: 11500 },
  { name: "CYLINDER HEAD GUTTA CC200", price: 70000 },
  { name: "CYLINDER HEAD GUTTA SINO", price: 100000 },
  { name: "CYLNDER BLOCK GN 125", price: 27000 },
  { name: "DASH BOARD BM 4G", price: 17000 },
  { name: "DASH BOARD GUTA", price: 50000 },
  { name: "DASH BOARD HLX G4", price: 14000 },
  { name: "DASH BOARD KING", price: 45000 },
  { name: "DASH BORD CG", price: 10000 },
  { name: "DASH BORD GN", price: 12000 },
  { name: "DASHBOARD BM 5GEAR", price: 22000 },
  { name: "DASHBOARD CG", price: 12000 },
  { name: "DASHBOARD COVER BM", price: 8000 },
  { name: "DASHBOARD COVER TVS/HLX", price: 7000 },
  { name: "EXCEL R BM", price: 3000 },
  { name: "EXCEL R CC200 SINO GUTA", price: 38000 },
  { name: "EXCEL R GN", price: 1700 },
  { name: "EXCEL R GUTA 200 FUPI", price: 35000 },
  { name: "EXCEL R GUTA 250 FUPI", price: 35000 },
  { name: "EXCEL R PH 2", price: 1500 },
  { name: "EXCEL R PH/MTB", price: 12000 },
  { name: "EXCEL R XL", price: 3000 },
  { name: "EXLETA CABLE BM", price: 1700 },
  { name: "EXLETA CABLE CG", price: 1300 },
  { name: "EXLETA CABLE GN", price: 1200 },
  { name: "EXLETA CABLE GUTA NJIA 1", price: 3500 },
  { name: "EXLETA CABLE GUTA NJIA 2", price: 3000 },
  { name: "EXLETA CABLE RANGI", price: 5000 },
  { name: "EXLETA CABLE SINO", price: 3500 },
  { name: "EXLETA CABLE TVS", price: 2000 },
  { name: "EXOST CG", price: 47000 },
  { name: "EXOST COLA", price: 2500 },
  { name: "EXOST KING BLACK", price: 52000 },
  { name: "EXOST KING SILVER", price: 50000 },
  { name: "EXOST SINO YAI BLACK", price: 60000 },
  { name: "EXSOT GUTTA", price: 60000 },
  { name: "EXZOST KINGLION BLACK", price: 50000 },
  { name: "EXZOST KINGLION GN SILVER", price: 50000 },
  { name: "FEN GUTA", price: 32000 },
  { name: "FENI", price: 35000 },
  { name: "FILTA BM", price: 1500 },
  { name: "FILTA BM ORG", price: 3000 },
  { name: "FILTA GN NDANI", price: 400 },
  { name: "FILTA PETROL GN", price: 400 },
  { name: "FILTA TAW BM", price: 1500 },
  { name: "FIUZ BOX GN", price: 500 },
  { name: "FIUZ ONLY", price: 3000 },
  { name: "FLESHA BM", price: 1500 },
  { name: "FLESHA NO SOUND", price: 1000 },
  { name: "DASHBOARD GN", price: 12500 },
  { name: "DASHBOARD GUTA", price: 45000 },
  { name: "DASHBOARD SINO 180", price: 45000 },
  { name: "DASHBOARD TVS", price: 45000 },
  { name: "DASHBOARD TVS 5GEAR", price: 22000 },
  { name: "DEREILURE SET", price: 11000 },
  { name: "DIFF GUTA COMP CC250 SINO", price: 250000 },
  { name: "DIFFU COMP CC200 SINO", price: 260000 },
  { name: "DIFFU NUSU", price: 40000 },
  { name: "DIFU", price: 85000 },
  { name: "DISC SEWA", price: 6000 },
  { name: "DISK COVER", price: 10000 },
  { name: "DISK PASS MTB", price: 6000 },
  { name: "DRAM", price: 38000 },
  { name: "DUNGU", price: 600 },
  { name: "ELMENT BIG BLACK", price: 16000 },
  { name: "ELMENT BIG RED", price: 20000 },
  { name: "ELMENT KIBAKULI", price: 27000 },
  { name: "ELMENT SINO KAWAIDA BLACK", price: 16000 },
  { name: "ELMENT SINO KAWAIDA RED", price: 16000 },
  { name: "ELMENT SINO RED CHOGO", price: 20000 },
  { name: "ELMENT SINORAY BLACK CHOGO", price: 20000 },
  { name: "ENGLISH SPANA", price: 1000 },
  { name: "EXCEL NYUMA SINO", price: 4000 },
  { name: "EXCEL R YAI", price: 10000 },
  { name: "EXCEL F BM", price: 2000 },
  { name: "EXCEL F PH", price: 8500 },
  { name: "EXCEL F YAI", price: 10000 },
  { name: "EXCEL GN F", price: 1500 },
  { name: "EXCEL GN KIUNO", price: 1700 },
  { name: "EXCEL GUTA FUPI", price: 7000 },
  { name: "EXCEL GUTA MBELE NDEFU", price: 8000 },
  { name: "EXCEL GUTA NYUMA", price: 35000 },
  { name: "EXCEL KID R", price: 15000 },
  { name: "EXCEL KIUNO BM", price: 2000 },
  { name: "GASKET FULL 125 BM", price: 3500 },
  { name: "GASKET FULL 150 SINO", price: 7000 },
  { name: "GASKET FULL 180 SINO", price: 7000 },
  { name: "GASKET FULL 250 SIN0", price: 10000 },
  { name: "GASKET FULL BM 150", price: 4000 },
  { name: "GASKET FULL BMX 125", price: 3500 },
  { name: "GASKET FULL CBF", price: 1200 },
  { name: "GASKET FULL CC200", price: 7000 },
  { name: "GASKET FULL CC200 SINO", price: 10000 },
  { name: "GASKET FULL CC250", price: 7000 },
  { name: "GASKET FULL TAW", price: 2800 },
  { name: "GASKET FULL TVS", price: 3000 },
  { name: "GASKET MAGNETO COIL", price: 500 },
  { name: "GASKET MOTO 150", price: 500 },
  { name: "GASKET MOTO BM 150", price: 500 },
  { name: "GASKET MOTOR BLOCK 125", price: 500 },
  { name: "GEAR BOX BM", price: 38000 },
  { name: "GEAR BOX GN", price: 17000 },
  { name: "GEAR BOX GUTA SINO", price: 42000 },
  { name: "GEAR BOX KING P9", price: 35000 },
  { name: "GEAR BOX SINO 150", price: 36000 },
  { name: "GEAR BOX SINO 180", price: 38000 },
  { name: "GEAR BOX TAW", price: 35000 },
  { name: "GEAR CHUMA", price: 3500 },
  { name: "GEAR LIVER BM", price: 3500 },
  { name: "GEAR LIVER BOLT13", price: 1500 },
  { name: "GEAR LIVER CG", price: 2500 },
  { name: "GEAR LIVER GN PANDE1", price: 1500 },
  { name: "GEAR LIVER GN PANDE2", price: 3500 },
  { name: "GEAR LIVER GUTA", price: 5000 },
  { name: "GEAR LIVER KING", price: 9000 },
  { name: "GEAR LIVER SET MTB", price: 30000 },
  { name: "GEAR LIVER SINO GN", price: 3000 },
  { name: "GEAR LIVER SINO GUTTA", price: 8000 },
  { name: "GEAR PLASTIC", price: 3500 },
  { name: "RADIO TOP/KING", price: 22000 },
  { name: "REAR COVER RED SINO", price: 19000 },
  { name: "RECT FIRE SINO GN", price: 6000 },
  { name: "RECT FIRE SINO GUTA", price: 10000 },
  { name: "RECTFIRE BM", price: 8000 },
  { name: "RECTFIRE GN", price: 3500 },
  { name: "RECTFIRE GUTA", price: 9000 },
  { name: "RECTFIRE HAIROD", price: 4500 },
  { name: "RECTFIRE KINGLION", price: 6000 },
  { name: "RECTFIRE TAW", price: 5000 },
  { name: "RECTFIRE TVS 150", price: 8000 },
  { name: "RECTIFIER SINO 150", price: 7000 },
  { name: "RECTIFIRE BM G5", price: 10000 },
  { name: "REFLCTOR WAKA", price: 3500 },
  { name: "REJECTOR", price: 110000 },
  { name: "RELAY", price: 3000 },
  { name: "RELAY BM", price: 6000 },
  { name: "RELAY BMX125", price: 10000 },
  { name: "RELAY RGM", price: 3500 },
  { name: "RELAY SINO", price: 5000 },
  { name: "REPAIR KITI BM", price: 3000 },
  { name: "REPEA KIT GN", price: 2000 },
  { name: "RIFLECTER MSHALE", price: 1000 },
  { name: "RIFLECTOR NO 10 SINO", price: 1000 },
  { name: "RIFLECTOR NO10", price: 500 },
  { name: "RIFLECTOR NO8", price: 500 },
  { name: "RIFLECTOR SHOKUP", price: 500 },
  { name: "RIM ALLM SZ20", price: 6500 },
  { name: "RIM BM F BLACK", price: 65000 },
  { name: "RIM BM F SILVER", price: 65000 },
  { name: "RIM BM R BLACK", price: 65000 },
  { name: "RIM BM R SILVER", price: 65000 },
  { name: "RIM CG", price: 66000 },
  { name: "RIM GUTA", price: 40000 },
  { name: "RIM MTB ALMNM", price: 10000 }
];

function renderProductsPage() {
  const active = STATE.products.filter((p) => !p.deleted);
  const trashed = STATE.products.filter((p) => p.deleted);
  const search = UI.search.trim().toLowerCase();
  const filtered = search ? active.filter((p) => p.name.toLowerCase().includes(search)) : active;

  return `
  <div class="panel">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
      <h3 style="margin:0">Your Products (${active.length})</h3>
      <button class="btn btn-sm btn-primary" onclick="importBulkProducts()">⬇️ Import Full Parts List (${BULK_PRODUCTS.length})</button>
    </div>
    ${filtered.length === 0 ? `<p class="empty-note">No products found.</p>` : `
    <div class="user-list">
      ${filtered.map((p) => `
        <div class="user-row">
          ${UI.editingProductId === p.id ? `
            <input id="edit-price-${p.id}" class="field field-sm" style="width:120px" type="text" inputmode="decimal" value="${p.price}" oninput="this.value=sanitizeNum(this.value)">
            <button class="btn btn-sm btn-primary" onclick="saveProductPrice('${p.id}')">Save</button>
            <button class="btn btn-sm btn-ghost" onclick="UI.editingProductId=null;rerender();">Cancel</button>
          ` : `
            <div class="user-row-main"><span class="user-name">${esc(p.name)}</span><span class="user-detail">${fmt(p.price)}</span></div>
            <div style="display:flex;gap:6px">
              <button class="icon-btn" style="color:#1677ff" onclick="UI.editingProductId='${p.id}';rerender();">✏️</button>
              <button class="icon-btn" onclick="trashProduct('${p.id}')">🗑️</button>
            </div>
          `}
        </div>`).join("")}
    </div>`}
  </div>

  <div class="panel settings-panel" style="margin-top:16px">
    <h3>➕ Add Product</h3>
    <input id="pr-name" class="field" placeholder="Product name">
    <input id="pr-price" class="field" type="text" inputmode="decimal" placeholder="Selling price (TSh)" oninput="this.value=sanitizeNum(this.value)">
    ${UI.userMsg && UI.userMsg.forProduct ? `<p class="settings-msg ${UI.userMsg.ok ? "ok" : "err"}">${esc(UI.userMsg.text)}</p>` : ""}
    <button class="btn btn-primary" onclick="addProduct()">Add Product</button>
  </div>

  <button class="history-toggle" onclick="UI.showProductTrash=!UI.showProductTrash;rerender();">
    🗑️ Trash (${trashed.length}) ${UI.showProductTrash ? "▲" : "▼"}
  </button>
  ${UI.showProductTrash ? `
    <div class="history-list">
      ${trashed.length === 0 ? `<p class="empty-note">Trash is empty.</p>` : trashed.map((p) => `
        <div class="history-row">
          <div class="history-row-main"><span class="history-name">${esc(p.name)}</span><span class="history-detail">${fmt(p.price)}</span></div>
          <div style="display:flex;gap:6px">
            <button class="icon-btn restore" onclick="restoreProduct('${p.id}')">↩️</button>
            <button class="icon-btn" onclick="permanentlyDeleteProduct('${p.id}')">❌</button>
          </div>
        </div>`).join("")}
    </div>` : ""}
  `;
}
function addProduct() {
  const name = document.getElementById("pr-name").value.trim();
  const price = Number(document.getElementById("pr-price").value);
  if (!name) { UI.userMsg = { ok: false, text: "Enter a product name.", forProduct: true }; return rerender(); }
  if (STATE.products.some((p) => !p.deleted && p.name.toLowerCase() === name.toLowerCase())) {
    UI.userMsg = { ok: false, text: "That product already exists.", forProduct: true }; return rerender();
  }
  STATE.products.push({ id: uid(), name, price: price || 0 });
  saveProducts();
  UI.userMsg = { ok: true, text: `${name} added.`, forProduct: true };
  rerender();
}
function saveProductPrice(id) {
  const val = Number(document.getElementById("edit-price-" + id).value) || 0;
  STATE.products = STATE.products.map((p) => (p.id === id ? { ...p, price: val } : p));
  saveProducts();
  UI.editingProductId = null;
  rerender();
}
function trashProduct(id) {
  STATE.products = STATE.products.map((p) => (p.id === id ? { ...p, deleted: true, deletedDate: todayStr() } : p));
  saveProducts();
  rerender();
}
function restoreProduct(id) {
  STATE.products = STATE.products.map((p) => (p.id === id ? { ...p, deleted: false, deletedDate: null } : p));
  saveProducts();
  rerender();
}
function permanentlyDeleteProduct(id) {
  if (!confirm("Permanently delete this product? This cannot be undone.")) return;
  STATE.products = STATE.products.filter((p) => p.id !== id);
  saveProducts();
  rerender();
}
function importBulkProducts() {
  const existingNames = new Set(STATE.products.map((p) => p.name.toLowerCase()));
  let added = 0;
  BULK_PRODUCTS.forEach((item) => {
    if (!existingNames.has(item.name.toLowerCase())) {
      STATE.products.push({ id: uid(), name: item.name, price: item.price });
      existingNames.add(item.name.toLowerCase());
      added++;
    }
  });
  saveProducts();
  UI.userMsg = { ok: true, text: `Imported ${added} new products (skipped duplicates).`, forProduct: true };
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

/* ---------- SALES ---------- */
function avgBuyPrice(itemId) {
  const ins = STATE.stockMovements.filter((m) => m.itemId === itemId && m.type === "in" && m.price != null);
  if (ins.length === 0) return null;
  const totalQty = ins.reduce((s, m) => s + m.qty, 0);
  const totalCost = ins.reduce((s, m) => s + m.qty * m.price, 0);
  return totalQty > 0 ? totalCost / totalQty : null;
}

function startNewSale() {
  UI.saleForm = { date: todayStr(), rows: [{ id: uid(), itemName: "", price: "", qty: "" }] };
  rerender();
}
function setSaleField(field, value) {
  if (!UI.saleForm) startNewSale();
  UI.saleForm[field] = value;
  rerender();
}
function setSaleRow(rowId, field, value) {
  const f = UI.saleForm;
  f.rows = f.rows.map((r) => (r.id === rowId ? { ...r, [field]: value } : r));
  if (field === "itemName") {
    const prod = STATE.products.find((p) => p.name.toLowerCase() === value.trim().toLowerCase());
    const row = f.rows.find((r) => r.id === rowId);
    if (prod && !row.price) row.price = String(prod.price);
  }
  rerender();
}
function addSaleRow() {
  UI.saleForm.rows.push({ id: uid(), itemName: "", price: "", qty: "" });
  rerender();
}
function removeSaleRow(rowId) {
  UI.saleForm.rows = UI.saleForm.rows.filter((r) => r.id !== rowId);
  rerender();
}

function renderSalesPage() {
  if (!UI.saleForm) UI.saleForm = { date: todayStr(), rows: [{ id: uid(), itemName: "", price: "", qty: "" }] };
  const f = UI.saleForm;
  const grandTotal = f.rows.reduce((s, r) => s + (Number(r.price) || 0) * (Number(r.qty) || 0), 0);
  const recent = [...STATE.sales].sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, 20);

  return `
  <div class="panel">
    <h3>➕ Record a Sale</h3>
    <label class="due-label">📅 Date of sale</label>
    <input id="sl-date" class="field" type="date" value="${esc(f.date)}" oninput="setSaleField('date',this.value)">
    <div class="items-block" style="margin-top:10px">
      <div class="item-row item-row-head" style="grid-template-columns:1.4fr .9fr .6fr .9fr auto">
        <span>Item</span><span>Price</span><span>Qty</span><span>Total</span><span></span>
      </div>
      ${f.rows.map((r) => {
        const stockItem = STATE.stockItems.find((it) => it.name.toLowerCase() === r.itemName.trim().toLowerCase());
        const available = stockItem ? qtyOf(stockItem.id) : null;
        const lineTotal = (Number(r.price) || 0) * (Number(r.qty) || 0);
        return `
        <div class="item-row" style="grid-template-columns:1.4fr .9fr .6fr .9fr auto">
          <input list="product-datalist" id="slr-name-${r.id}" class="field field-sm" placeholder="Type item name" value="${esc(r.itemName)}" oninput="setSaleRow('${r.id}','itemName',this.value)">
          <input id="slr-price-${r.id}" class="field field-sm" type="text" inputmode="decimal" placeholder="Price" value="${esc(r.price)}" oninput="this.value=sanitizeNum(this.value);setSaleRow('${r.id}','price',this.value)">
          <input id="slr-qty-${r.id}" class="field field-sm" type="text" inputmode="numeric" placeholder="Qty" value="${esc(r.qty)}" oninput="this.value=sanitizeNum(this.value);setSaleRow('${r.id}','qty',this.value)">
          <span class="item-line-total">${fmt(lineTotal)}</span>
          ${f.rows.length > 1 ? `<button class="icon-btn" onclick="removeSaleRow('${r.id}')">🗑️</button>` : `<span></span>`}
        </div>
        ${r.itemName.trim() ? `<div style="font-size:10.5px;color:${available == null ? "#dc2636" : "#8290a4"};margin:-4px 0 6px 2px">
          ${available == null ? "⚠️ Not found in Main Store stock" : `${available} currently in stock`}
        </div>` : ""}`;
      }).join("")}
      <button class="add-row-btn" onclick="addSaleRow()">＋ Add Item</button>
      <div class="grand-total-row"><span>Grand Total</span><span>${fmt(grandTotal)}</span></div>
    </div>
    ${UI.saleMsg ? `<p class="settings-msg ${UI.saleMsg.ok ? "ok" : "err"}">${esc(UI.saleMsg.text)}</p>` : ""}
    <button class="btn btn-primary" style="margin-top:10px" onclick="submitSale()">Record Sale</button>
  </div>

  <div class="panel" style="margin-top:16px">
    <h3>Recent Sales</h3>
    ${recent.length === 0 ? `<p class="empty-note">No sales recorded yet.</p>` : `
    <table class="recent-table"><tbody>
      ${recent.map((s) => `
        <tr>
          <td>${esc(s.itemName)}</td>
          <td>${s.qty} × ${fmt(s.sellPrice)}</td>
          <td class="rt-amount">${fmt(s.total)}</td>
          <td class="rt-date">${s.date}</td>
          <td><button class="icon-btn" onclick="deleteSale('${s.id}')">🗑️</button></td>
        </tr>`).join("")}
    </tbody></table>`}
  </div>`;
}
function submitSale() {
  const f = UI.saleForm;
  UI.saleMsg = null;
  const validRows = f.rows.filter((r) => r.itemName.trim() && Number(r.price) > 0 && Number(r.qty) > 0);
  if (validRows.length === 0) { UI.saleMsg = { ok: false, text: "Add at least one item with a price and quantity." }; return rerender(); }

  for (const r of validRows) {
    const stockItem = STATE.stockItems.find((it) => it.name.toLowerCase() === r.itemName.trim().toLowerCase());
    if (!stockItem) { UI.saleMsg = { ok: false, text: `"${r.itemName}" was not found in Main Store stock.` }; return rerender(); }
    const available = qtyOf(stockItem.id);
    if (Number(r.qty) > available) { UI.saleMsg = { ok: false, text: `Only ${available} of "${r.itemName}" in stock.` }; return rerender(); }
  }

  validRows.forEach((r) => {
    const stockItem = STATE.stockItems.find((it) => it.name.toLowerCase() === r.itemName.trim().toLowerCase());
    const qty = Number(r.qty);
    const price = Number(r.price);
    const buyPrice = avgBuyPrice(stockItem.id);
    const movementId = uid();
    STATE.stockMovements.push({ id: movementId, itemId: stockItem.id, type: "out", qty, destination: "Sale", date: f.date });
    STATE.sales.push({
      id: uid(), itemId: stockItem.id, itemName: stockItem.name, sellPrice: price, qty,
      total: price * qty, buyPrice, date: f.date || todayStr(), movementId,
    });
  });
  saveStockMovements();
  saveSales();

  UI.saleForm = null;
  UI.saleMsg = { ok: true, text: `${validRows.length} sale(s) recorded.` };
  rerender();
}
function deleteSale(id) {
  if (!confirm("Delete this sale? This will also put the stock back.")) return;
  const sale = STATE.sales.find((s) => s.id === id);
  if (sale && sale.movementId) {
    STATE.stockMovements = STATE.stockMovements.filter((m) => m.id !== sale.movementId);
    saveStockMovements();
  }
  STATE.sales = STATE.sales.filter((s) => s.id !== id);
  saveSales();
  rerender();
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

  const from = UI.plFrom || "0000-01-01";
  const to = UI.plTo || "9999-12-31";
  const salesInRange = STATE.sales.filter((s) => s.date >= from && s.date <= to).sort((a, b) => (a.date < b.date ? 1 : -1));
  const revenue = salesInRange.reduce((s, x) => s + x.total, 0);
  const cost = salesInRange.reduce((s, x) => s + (x.buyPrice != null ? x.buyPrice * x.qty : 0), 0);
  const unknownCostCount = salesInRange.filter((x) => x.buyPrice == null).length;
  const profit = revenue - cost;

  function setPreset(days) {
    const to = new Date();
    const from = new Date();
    from.setDate(from.getDate() - (days - 1));
    UI.plFrom = from.toISOString().slice(0, 10);
    UI.plTo = to.toISOString().slice(0, 10);
    rerender();
  }
  window.setPLPreset = setPreset;

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
  </div>

  <div class="panel" id="sales-report-print" style="margin-top:16px">
    <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px">
      <h3 style="margin:0">💰 Sales Report &amp; Profit / Loss</h3>
      <button class="btn btn-sm btn-primary no-print" onclick="window.print()">🖨️ Print</button>
    </div>
    <div class="discount-mode-toggle no-print" style="margin:10px 0">
      <button class="chip-btn" onclick="setPLPreset(1)">Today</button>
      <button class="chip-btn" onclick="setPLPreset(3)">Last 3 days</button>
      <button class="chip-btn" onclick="setPLPreset(7)">Last 7 days</button>
      <button class="chip-btn" onclick="setPLPreset(30)">Last 30 days</button>
    </div>
    <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:14px" class="no-print">
      <input class="field field-sm" style="width:auto" type="date" value="${esc(UI.plFrom)}" onchange="UI.plFrom=this.value;rerender();">
      <span style="align-self:center;color:#8290a4">to</span>
      <input class="field field-sm" style="width:auto" type="date" value="${esc(UI.plTo)}" onchange="UI.plTo=this.value;rerender();">
    </div>
    <div class="cards" style="grid-template-columns:repeat(3,1fr);margin-bottom:16px">
      ${statCard("Revenue", fmt(revenue), "total sales in range", "blue")}
      ${statCard("Cost of Goods", fmt(cost), "based on buying price", "orange")}
      ${statCard(profit >= 0 ? "Profit" : "Loss", fmt(Math.abs(profit)), "revenue minus cost", profit >= 0 ? "green" : "red")}
    </div>
    ${unknownCostCount > 0 ? `<p style="font-size:11.5px;color:#b8862f;margin-bottom:10px">⚠️ ${unknownCostCount} sale(s) in this range have no known buying price (item was never received with a price in Main Store), so cost/profit may be understated.</p>` : ""}
    <table class="recent-table" style="width:100%">
      <thead><tr><th style="text-align:left;font-size:10.5px;color:#8290a4;padding:6px">Item</th><th style="text-align:right;font-size:10.5px;color:#8290a4;padding:6px">Qty</th><th style="text-align:right;font-size:10.5px;color:#8290a4;padding:6px">Sold @</th><th style="text-align:right;font-size:10.5px;color:#8290a4;padding:6px">Bought @</th><th style="text-align:right;font-size:10.5px;color:#8290a4;padding:6px">Profit</th><th style="text-align:right;font-size:10.5px;color:#8290a4;padding:6px">Date</th></tr></thead>
      <tbody>
        ${salesInRange.length === 0 ? `<tr><td colspan="6" style="padding:14px;text-align:center;color:#a3aebe">No sales in this date range.</td></tr>` : salesInRange.map((s) => `
          <tr>
            <td style="padding:8px 6px">${esc(s.itemName)}</td>
            <td style="padding:8px 6px;text-align:right">${s.qty}</td>
            <td style="padding:8px 6px;text-align:right">${fmt(s.sellPrice)}</td>
            <td style="padding:8px 6px;text-align:right">${s.buyPrice != null ? fmt(s.buyPrice) : "—"}</td>
            <td style="padding:8px 6px;text-align:right;font-weight:600;color:${s.buyPrice != null ? "var(--green)" : "#a3aebe"}">${s.buyPrice != null ? fmt((s.sellPrice - s.buyPrice) * s.qty) : "—"}</td>
            <td style="padding:8px 6px;text-align:right;color:#8290a4">${s.date}</td>
          </tr>`).join("")}
      </tbody>
    </table>
  </div>`;
}

/* ---------- SETTINGS ---------- */
function renderSettings() {
  const notifStatus = ("Notification" in window) ? Notification.permission : "unsupported";
  return `
  <div class="panel settings-panel">
    <h3>🖼️ Company Logo</h3>
    <p style="font-size:12px;color:#6b7280">Upload your own logo to replace the default one on screens and receipts.</p>
    <div style="display:flex;align-items:center;gap:12px;margin-bottom:6px">
      ${STATE.settings.logoBase64 ? `<img src="${STATE.settings.logoBase64}" style="width:52px;height:52px;object-fit:contain;border-radius:8px;border:1px solid var(--line)">` : logoSvg(52)}
      <input id="logo-upload" type="file" accept="image/*" class="field field-sm" onchange="handleLogoUpload(this)">
    </div>
    ${STATE.settings.logoBase64 ? `<button class="btn btn-ghost btn-sm" onclick="removeLogo()">Remove uploaded logo</button>` : ""}
    ${UI.logoMsg ? `<p class="settings-msg ${UI.logoMsg.ok ? "ok" : "err"}">${esc(UI.logoMsg.text)}</p>` : ""}
  </div>

  <div class="panel settings-panel" style="margin-top:16px">
    <h3>🔒 App Password</h3>
    <p style="font-size:12px;color:#6b7280">This is the password anyone needs to open this system.</p>
    <input id="ap-current" class="field" type="password" placeholder="Current app password">
    <input id="ap-new" class="field" type="password" placeholder="New app password">
    ${UI.changeMsg ? `<p class="settings-msg ${UI.changeMsg.ok ? "ok" : "err"}">${esc(UI.changeMsg.text)}</p>` : ""}
    <button class="btn btn-primary" onclick="changeAppPassword()">Save New App Password</button>
  </div>

  <div class="panel settings-panel" style="margin-top:16px">
    <h3>🔔 Phone / Browser Alerts</h3>
    <p style="font-size:12px;color:#6b7280">Get an on-screen alert for overdue debts and low stock while this site is open on your phone or computer.</p>
    <p style="font-size:12px;color:#8290a4">Status: ${notifStatus === "granted" ? "Enabled ✅" : notifStatus === "denied" ? "Blocked — enable it in your browser settings" : "Not enabled yet"}</p>
    <button class="btn btn-primary" onclick="enableNotifications()">Enable Alerts</button>
  </div>

  <div class="panel settings-panel" style="margin-top:16px">
    <h3>🔒 Reports Password</h3>
    <p style="font-size:12px;color:#6b7280">This separate password protects Debtors, Creditors and Reports specifically.</p>
    <input id="fp-current" class="field" type="password" placeholder="Current reports password">
    <input id="fp-new" class="field" type="password" placeholder="New reports password">
    ${UI.finSettingsMsg ? `<p class="settings-msg ${UI.finSettingsMsg.ok ? "ok" : "err"}">${esc(UI.finSettingsMsg.text)}</p>` : ""}
    <button class="btn btn-primary" onclick="changeReportsPassword()">Save Reports Password</button>
  </div>`;
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
function changeAppPassword() {
  const current = document.getElementById("ap-current").value;
  const next = document.getElementById("ap-new").value;
  UI.changeMsg = null;
  if (current !== STATE.settings.appPassword) { UI.changeMsg = { ok: false, text: "Current app password is incorrect." }; return rerender(); }
  if (!next || next.length < 4) { UI.changeMsg = { ok: false, text: "New password must be at least 4 characters." }; return rerender(); }
  STATE.settings.appPassword = next;
  saveSettings();
  UI.changeMsg = { ok: true, text: "App password updated." };
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
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:${receiveOpen || dispatchOpen ? "0" : "10px"}">
      <h3 style="margin:0">📥📤 Receive / Dispatch Stock</h3>
      ${!receiveOpen && !dispatchOpen ? `
      <div style="display:flex;gap:8px">
        <button class="btn btn-sm btn-primary" onclick="startReceiveStock()">📥 Receive Stock</button>
        <button class="btn btn-sm btn-primary" onclick="startDispatchStock()">📤 Dispatch Stock</button>
      </div>` : ""}
    </div>
    ${receiveOpen ? renderReceiveForm() : ""}
    ${dispatchOpen ? renderDispatchForm() : ""}
  </div>

  <div class="panel" style="margin-top:16px">
    <h3 style="margin:0 0 10px">Current Stock</h3>
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

  <div class="panel" style="margin-top:16px">
    <h3>Recent Stock Movements</h3>
    ${STATE.stockMovements.length === 0 ? `<p class="empty-note">No movements yet.</p>` : `
    <table class="recent-table"><tbody>
      ${[...STATE.stockMovements].sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, 20).map((m) => {
        const item = STATE.stockItems.find((it) => it.id === m.itemId);
        const isEditing = UI.editingMovementId === m.id;
        if (isEditing) {
          return `<tr><td colspan="5">
            <div class="entry-form" style="margin:6px 0">
              <input id="em-qty-${m.id}" class="field field-sm" type="text" inputmode="numeric" placeholder="Qty" value="${m.qty}" oninput="this.value=sanitizeNum(this.value)">
              ${m.type === "in" ? `
                <input id="em-supplier-${m.id}" class="field field-sm" placeholder="From (supplier)" value="${esc(m.supplier || "")}">
                <input id="em-price-${m.id}" class="field field-sm" type="text" inputmode="decimal" placeholder="Price" value="${m.price != null ? m.price : ""}" oninput="this.value=sanitizeNum(this.value)">
              ` : `
                <input id="em-dest-${m.id}" class="field field-sm" placeholder="Going to" value="${esc(m.destination || "")}">
              `}
              <input id="em-date-${m.id}" class="field field-sm" type="date" value="${m.date}">
              <div class="form-actions">
                <button class="btn btn-ghost btn-sm" onclick="UI.editingMovementId=null;rerender();">Cancel</button>
                <button class="btn btn-primary btn-sm" onclick="saveMovementEdit('${m.id}')">Save</button>
              </div>
            </div>
          </td></tr>`;
        }
        return `<tr>
          <td>${item ? esc(item.name) : "—"}</td>
          <td><span class="badge ${m.type === "in" ? "paid" : "pending"}">${m.type === "in" ? "Received" : "Dispatched"}</span></td>
          <td class="rt-amount">${m.qty}</td>
          <td>${m.type === "in" ? esc(m.supplier || "") : esc(m.destination || "")}</td>
          <td class="rt-date">${m.date}</td>
          <td style="white-space:nowrap">
            <button class="icon-btn" style="color:#1677ff" onclick="UI.editingMovementId='${m.id}';rerender();">✏️</button>
            <button class="icon-btn" onclick="deleteMovement('${m.id}')">🗑️</button>
          </td>
        </tr>`;
      }).join("")}
    </tbody></table>`}
  </div>`;
}
function saveMovementEdit(id) {
  const m = STATE.stockMovements.find((x) => x.id === id);
  if (!m) return;
  const qty = Number(document.getElementById("em-qty-" + id).value) || m.qty;
  const date = document.getElementById("em-date-" + id).value || m.date;
  const updated = { ...m, qty, date };
  if (m.type === "in") {
    updated.supplier = document.getElementById("em-supplier-" + id).value.trim();
    const priceVal = document.getElementById("em-price-" + id).value;
    updated.price = priceVal ? Number(priceVal) : null;
  } else {
    updated.destination = document.getElementById("em-dest-" + id).value.trim();
  }
  STATE.stockMovements = STATE.stockMovements.map((x) => (x.id === id ? updated : x));
  saveStockMovements();
  UI.editingMovementId = null;
  rerender();
}
function deleteMovement(id) {
  if (!confirm("Delete this record? Stock quantity will be recalculated.")) return;
  STATE.stockMovements = STATE.stockMovements.filter((m) => m.id !== id);
  saveStockMovements();
  rerender();
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
          <div style="display:flex;justify-content:center;margin-bottom:6px">${companyLogo(48)}</div>
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
        <h2 class="receipt-title" style="display:flex;align-items:center;gap:8px;justify-content:center">${companyLogo(30)} Receipt</h2>
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
setTimeout(() => {
  if (CONFIG_IS_SET && (!AUTH_READY || !STATE_LOADED)) {
    UI.err = "This is taking too long. Check your Firestore database and security rules in Firebase Console.";
    rerender();
  }
}, 8000);
