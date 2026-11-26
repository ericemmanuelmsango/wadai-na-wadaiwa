/* =====================================================================
   🛡️ MTANDAO — nguvu ya mfumo kwenye internet dhaifu (E.E.MSANGO)
   Weka faili hili BAADA ya scripts za Firebase na KABLA ya app.
   1. Firestore inachagua yenyewe njia inayofanya kazi kwenye mitandao
      dhaifu/ya simu (long-polling) badala ya kukwama.
   2. Cache ya kifaa haina kikomo — data hazifutwi kwenye kifaa.
   3. Internet ikirudi, Firestore inaamshwa mara moja kutuma data.
   4. Data zikikwama >45s wakati kuna internet, muunganiko unawashwa upya.
   5. Service worker (sw.js): mfumo unafunguka hata bila internet.
   6. Onyo dogo la mtandao kwa kurasa zisizo na jopo la "Vifaa".
   ===================================================================== */
(function () {
  "use strict";
  var DBS = [];
  var NET = { pendingSince: 0, kicks: 0 };
  window.EE_NET = NET;

  function tune(app) {
    try {
      if (!app || typeof app.firestore !== "function") return;
      var fs = app.firestore();
      if (DBS.indexOf(fs) >= 0) return;
      try {
        fs.settings({
          experimentalAutoDetectLongPolling: true,
          cacheSizeBytes: (firebase.firestore && firebase.firestore.CACHE_SIZE_UNLIMITED) || -1,
          merge: true,
        });
      } catch (e) {}
      DBS.push(fs);
    } catch (e) {}
  }

  if (window.firebase && typeof firebase.initializeApp === "function") {
    var orig = firebase.initializeApp;
    firebase.initializeApp = function () {
      var app = orig.apply(firebase, arguments);
      // app ya kuingia tu (auth) haihitaji database — tunagusa ile ya msingi na zenye database
      tune(app);
      return app;
    };
    try { (firebase.apps || []).forEach(tune); } catch (e) {}
  }

  function wake() { DBS.forEach(function (fs) { try { fs.enableNetwork().catch(function () {}); } catch (e) {} }); }
  window.addEventListener("online", function () { wake(); setTimeout(bar, 200); });
  window.addEventListener("offline", function () { setTimeout(bar, 200); });

  // ---- mlinzi: data zikikwama wakati internet ipo, washa muunganiko upya
  var watching = false;
  function watch() {
    if (watching || !DBS.length || navigator.onLine === false) return;
    watching = true;
    var left = DBS.length, done = false, t0 = Date.now();
    var timer = setTimeout(function () {
      if (done) return;
      NET.pendingSince = NET.pendingSince || t0;
      bar();
      if (navigator.onLine !== false) {
        NET.kicks++;
        DBS.forEach(function (fs) {
          try { fs.disableNetwork().then(function () { return fs.enableNetwork(); }).catch(function () { try { fs.enableNetwork(); } catch (e) {} }); } catch (e) {}
        });
      }
    }, 45000);
    var soft = setTimeout(function () { if (!done) { NET.pendingSince = NET.pendingSince || t0; bar(); } }, 20000);
    DBS.forEach(function (fs) {
      var p; try { p = fs.waitForPendingWrites(); } catch (e) { p = Promise.resolve(); }
      Promise.resolve(p).catch(function () {}).then(function () {
        if (--left > 0) return;
        done = true; watching = false; clearTimeout(timer); clearTimeout(soft);
        NET.pendingSince = 0; bar();
      });
    });
  }
  setInterval(watch, 15000);
  setTimeout(watch, 4000);
  window.addEventListener("online", function () { setTimeout(watch, 1000); });

  // ---- onyo dogo (kwa kurasa zisizo na onyo la "Vifaa")
  function hasDevBar() {
    try { if (typeof DEV !== "undefined" && DEV) return true; } catch (e) {}
    return !!document.getElementById("dev-net-bar");
  }
  function bar() {
    if (!document.body) return;
    var b = document.getElementById("ee-net-bar");
    var off = navigator.onLine === false, stuck = !!NET.pendingSince;
    if (hasDevBar() || (!off && !stuck)) { if (b) b.remove(); return; }
    if (!b) {
      b = document.createElement("div"); b.id = "ee-net-bar";
      b.style.cssText = "position:fixed;top:0;left:0;right:0;z-index:9998;padding:7px 12px;font:13px system-ui,sans-serif;text-align:center;color:#111";
      document.body.appendChild(b);
    }
    b.style.background = off ? "#fca5a5" : "#fde68a";
    var t = off
      ? "📵 Hakuna internet - USIREFRESH. Kazi yako inahifadhiwa kwenye kifaa hiki na itatumwa yenyewe internet ikirudi."
      : "⏳ Data zinatumwa polepole (internet dhaifu) - acha mfumo wazi, zitafika zenyewe.";
    if (b.textContent !== t) b.textContent = t;
  }
  setInterval(bar, 5000); setTimeout(bar, 1500);

  // ---- 🔄 toleo jipya: kila kifaa kinakagua chenyewe (kila dakika 2 na ukirudi kwenye app)
  (function () {
    var tag = document.querySelector('script[src*="app.js?v="],script[src*="pos.js?v="]');
    var m = tag && tag.getAttribute("src").match(/(app|pos)\.js\?v=(\d+)/);
    if (!m) return;
    var name = m[1], mine = +m[2], ready = false;
    function reload() { try { navigator.serviceWorker && navigator.serviceWorker.getRegistration().then(function (r) { r && r.update(); }); } catch (e) {} setTimeout(function () { location.reload(); }, 400); }
    function banner() {
      if (document.getElementById("ee-update")) return;
      var d = document.createElement("div");
      d.id = "ee-update";
      d.style.cssText = "position:fixed;left:50%;bottom:16px;transform:translateX(-50%);z-index:99999;background:#0b1b30;color:#fff;padding:10px 14px;border-radius:10px;box-shadow:0 6px 20px rgba(0,0,0,.3);font:600 13px system-ui;display:flex;gap:10px;align-items:center;max-width:92vw";
      d.innerHTML = '<span>🔄 Toleo jipya la mfumo limefika</span><button style="background:#c9a24a;color:#0b1b30;border:0;border-radius:7px;padding:7px 12px;font-weight:700;cursor:pointer">Sasisha sasa</button>';
      d.querySelector("button").onclick = reload;
      document.body.appendChild(d);
    }
    function check() {
      if (navigator.onLine === false) return;
      fetch("./", { cache: "no-store" }).then(function (r) { return r.ok ? r.text() : ""; }).then(function (t) {
        var n = (t.match(new RegExp(name + "\\.js\\?v=(\\d+)")) || [])[1];
        if (n && +n > mine) { ready = true; banner(); }
      }).catch(function () {});
    }
    // app ikirudi mbele (simu/tab) na toleo jipya lipo → sasisha moja kwa moja
    document.addEventListener("visibilitychange", function () {
      if (document.hidden) return;
      var a = document.activeElement, typing = a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName);
      if (ready && !typing) reload(); else check();
    });
    setTimeout(check, 8000);
    setInterval(check, 120000);
  })();

  // ---- service worker: mfumo ufunguke hata bila internet
  if ("serviceWorker" in navigator && /^https?:$/.test(location.protocol)) {
    window.addEventListener("load", function () {
      navigator.serviceWorker.register("sw.js").then(function () { return navigator.serviceWorker.ready; }).then(function (reg) {
        setTimeout(function () {
          try {
            var base = location.href.split("#")[0].replace(/[^\/]*$/, "");
            var urls = [location.href.split("#")[0]];
            (performance.getEntriesByType("resource") || []).forEach(function (e) {
              var u = e.name;
              if (u.indexOf(base) === 0 || /^https:\/\/(www\.gstatic\.com\/firebasejs\/|cdn\.jsdelivr\.net\/)/.test(u)) urls.push(u);
            });
            var w = reg.active || navigator.serviceWorker.controller;
            if (w) w.postMessage({ type: "ee-cache", urls: urls });
          } catch (e) {}
        }, 3000);
      }).catch(function () {});
    });
  }
})();
