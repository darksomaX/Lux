// Lux main entry. Wires the engine, transport, browser toolbar, lock,
// settings UI, dock tools, and phase 2 panels. Everything is ESM.

import { loadSettings, saveSettings, resetSettings } from "./settings.js";
import { setTransportFor } from "./transport.js";
import { getEngine, listEngines } from "./engine.js";
import { normalizeUrl } from "./url-scheme.js";
import { isUnlocked, initLock, lock } from "./lock.js";
import { markCanonical, breakOutOfNest } from "./smart-iframe.js";
import { applyGoogleOptOut } from "./extensions.js";
import * as kill from "./kill-switch.js";
import { openCloaked, armPanicKey, enableAntiClose } from "./cloak.js";
import { initVault, saveNote, listVault, importFile, openVaultItem, deleteVaultItem } from "./vault.js";
import { armPrimeOnFirstGesture } from "./popup-perm.js";
import { listEngines as listSearchEngines } from "./search-engines.js";
import { pickRomFolder, renderGamesHome, launchRom } from "./games.js";
import { downloadSession, pickAndImportSession } from "./session.js";
import { startIframeWatch, stopIframeWatch } from "./iframe-watch.js";
import { startTitleWatch, stopTitleWatch } from "./true-title.js";
import * as usb from "./usb-killswitch.js";
import * as Tabs from "./tabs.js";

const $ = (id) => document.getElementById(id);
const settings = loadSettings();
// currentTarget / navHistory are now per-tab (see tabs.js). These are kept as
// backward-compat shims for any code that still references them.
function currentTarget() { return Tabs.getActiveTab()?.url || null; }

// ── Settings → DOM ───────────────────────────────────────────────────────

function applySettingsToDom(s) {
  document.body.dataset.theme = s.theme;
  document.body.dataset.bg = s.background;
  document.body.dataset.chrome = s.windowChrome || "macos";
  document.body.dataset.taskbarHide = String(s.taskbarHide || false);
  const badge = $("ip-badge");
  if (badge) badge.style.display = s.showIpBadge ? "block" : "none";
}
applySettingsToDom(settings);
markCanonical();
applyGoogleOptOut();

const hashTarget = decodeURIComponent(location.hash.slice(1));
if (breakOutOfNest(hashTarget)) {
  // stop here
} else {
  boot();
}

async function boot() {
  initBackground();
  initHomeSearch();
  initToolbar();
  initTaskbar();
  initSettingsUi();
  initLock();
  initKillSwitch();
  initPhase2();
  initIpBadge();
  initSessionTransfer();
  initUsbKillswitch();
  armPrimeOnFirstGesture();
  initTrueUrlReveal();
  initClock();
  containerAutoHide();
  addLuxFloat();

  // Add hover-zone element for taskbar auto-hide
  const zone = document.createElement("div");
  zone.id = "taskbar-hover-zone";
  document.body.appendChild(zone);

  if (hashTarget) navigate(hashTarget);
}

// ── Lux Title Animation ───────────────────────────────────────────────────

function addLuxFloat() {
  const title = $("title");
  if (title) title.classList.add("lux-float");
}

// ── Background ───────────────────────────────────────────────────────────

function initBackground() {
  const canvas = $("sky");
  const ctx = canvas.getContext("2d");
  let stars = [];
  let raf = null;

  function resize() {
    canvas.width = innerWidth;
    canvas.height = innerHeight;
    stars = Array.from({ length: 80 }, () => ({
      x: Math.random() * canvas.width,
      y: Math.random() * canvas.height,
      r: Math.random() * 1.2 + 0.2,
      a: Math.random() * 0.5 + 0.2,
      tw: Math.random() * 0.02 + 0.005,
    }));
  }
  function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    for (const s of stars) {
      s.a += s.tw;
      if (s.a > 0.9 || s.a < 0.1) s.tw *= -1;
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(255,255,255,${s.a})`;
      ctx.fill();
    }
    raf = requestAnimationFrame(draw);
  }
  function start() {
    if (settings.background !== "stars") return;
    resize();
    if (!raf) draw();
  }
  function stop() {
    if (raf) cancelAnimationFrame(raf);
    raf = null;
  }
  addEventListener("resize", resize);
  start();
  window.addEventListener("lux:settings", (e) => {
    Object.assign(settings, e.detail);
    if (e.detail.background === "stars") start();
    else stop();
  });
}

// ── Home Search ───────────────────────────────────────────────────────────

let incognito = false;

function initHomeSearch() {
  const input = $("search-input");
  const searchBtn = $("search-btn");
  const incogBtn = $("incognito-btn");

  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      navigate(input.value.trim());
    }
  });
  searchBtn.onclick = () => navigate(input.value.trim());
  incogBtn.onclick = () => {
    incognito = !incognito;
    incogBtn.classList.toggle("active");
  };
}

// ── Browser Toolbar ──────────────────────────────────────────────────────

function initToolbar() {
  $("nav-back").onclick = () => { const t = Tabs.getActiveTab(); if (t) Tabs.goBack(t.id); };
  $("nav-forward").onclick = () => { const t = Tabs.getActiveTab(); if (t) Tabs.goForward(t.id); };
  $("nav-stop").onclick = () => { const t = Tabs.getActiveTab(); if (t) try { t.iframe.contentWindow.stop(); } catch {} };
  $("nav-reload").onclick = () => { const t = Tabs.getActiveTab(); if (t) Tabs.reloadTab(t.id); };
  $("toolbar-url").addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      navigate($("toolbar-url").value.trim());
    }
  });
  $("nav-new").onclick = () => { showHome(); };
  $("nav-close").onclick = closeBrowser;
}

function navBack() {}
function navForward() {}
function navStop() {}
function navReload() {}
function pushHistory() {}

// ── Navigation (delegates to the tab manager) ────────────────────────────

function navigate(input) {
  if (!input || !isUnlocked()) return;
  const url = normalizeUrl(input);
  if (!url) return;
  if (breakOutOfNest(url)) return;

  // If the active tab is a "new tab" (no URL yet), navigate it in place.
  // Otherwise create a new tab. This mirrors browser behavior.
  let tab = Tabs.getActiveTab();
  if (!tab || tab.url) {
    tab = Tabs.createTab();
  }
  Tabs.navigateTab(tab.id, url, true);
  showBrowser();
  setStatus("Loading...");
  onStageOpened();
}

// Navigate in a new tab (used by window.open interception).
function navigateNewTab(url) {
  if (!isUnlocked()) return;
  const decoded = normalizeUrl(url);
  if (!decoded) return;
  const tab = Tabs.createTab(decoded);
  showBrowser();
}

async function navigateToUrl(url, recordHistory) {
  // Legacy compat: navigate the active tab.
  const tab = Tabs.getActiveTab();
  if (!tab) { Tabs.createTab(url); return; }
  await Tabs.navigateTab(tab.id, url, recordHistory);
  showBrowser();
  setStatus("");
}

// ── Browser Visibility ───────────────────────────────────────────────────

function showBrowser() {
  $("browser-area").classList.add("active");
  $("home").classList.add("hidden");
  document.querySelector(".taskbar-app[data-app=\"browser\"]").classList.add("active");
  renderTabStrip();
}

function showHome() {
  // "New tab" — create a fresh new-tab and activate it.
  Tabs.createTab();
  $("browser-area").classList.remove("active");
  $("home").classList.remove("hidden");
  document.querySelector(".taskbar-app[data-app=\"browser\"]").classList.remove("active");
}

function closeBrowser() {
  const tab = Tabs.getActiveTab();
  if (tab) Tabs.closeTab(tab.id);
  // If no tabs remain, tabs.js auto-creates a new-tab.
  if (!Tabs.getActiveTab()?.url) {
    $("browser-area").classList.remove("active");
    $("home").classList.remove("hidden");
  }
  onStageClosed();
}

function toggleBrowser() {
  if ($("browser-area").classList.contains("active")) {
    showHome();
  } else if (Tabs.getActiveTab()?.url) {
    showBrowser();
  }
}

// ── Tab strip rendering ──────────────────────────────────────────────────

function renderTabStrip() {
  const strip = $("tab-strip");
  if (!strip) return;
  const allTabs = Tabs.getAllTabs();
  strip.innerHTML = "";
  for (const t of allTabs) {
    const el = document.createElement("div");
    el.className = "tab-item" + (t.id === Tabs.getActiveTab()?.id ? " active" : "");
    el.dataset.tabId = String(t.id);
    const fav = t.favicon ? `<img class="tab-fav" src="${t.favicon}" alt="">` : "";
    el.innerHTML = `${fav}<span class="tab-title">${escapeHtml(t.title || t.url || "New Tab")}</span><button class="tab-close" aria-label="Close">&times;</button>`;
    el.addEventListener("click", (e) => {
      if (e.target.classList.contains("tab-close")) {
        Tabs.closeTab(t.id);
      } else {
        Tabs.activateTab(t.id);
      }
      renderTabStrip();
    });
    // Middle-click closes (Chromium behavior).
    el.addEventListener("auxclick", (e) => {
      if (e.button === 1) { Tabs.closeTab(t.id); renderTabStrip(); }
    });
    strip.appendChild(el);
  }
  // The + button.
  const plus = document.createElement("button");
  plus.className = "tab-new";
  plus.textContent = "+";
  plus.title = "New tab";
  plus.onclick = () => { Tabs.createTab(); renderTabStrip(); };
  strip.appendChild(plus);
}

// React to tab manager events to keep the strip + toolbar in sync.
Tabs.on("tabCreated", () => renderTabStrip());
Tabs.on("tabClosed", () => renderTabStrip());
Tabs.on("tabActivated", (tab) => {
  renderTabStrip();
  if (tab && tab.url) {
    showBrowser();
    onStageOpened();
  }
});
Tabs.on("tabUpdated", (tab) => {
  renderTabStrip();
  setStatus("");
});

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// ── Orphan detection ─────────────────────────────────────────────────────
// If Lux was loaded at a bare /service/ or /s/ path (the user opened a proxied
// link directly), show a toast offering to return home.
if (Tabs.detectOrphan()) {
  setTimeout(() => {
    showToast("Opened a proxied link directly?", () => { window.location.href = "/"; });
  }, 500);
}

// ── Cloak ─────────────────────────────────────────────────────────────────

async function openCloakedTarget(input) {
  const url = normalizeUrl(input);
  if (!url) return;
  try {
    await setTransportFor(getEngine().name);
    await getEngine().init();
    const enc = (u) => getEngine().encode(u) || "/uv/" + u;
    await openCloaked(url, enc);
    setStatus("Opened in cloaked window.");
  } catch (e) {
    setStatus(e.message, true);
  }
}

// ── Stage ─────────────────────────────────────────────────────────────────

function onStageOpened() {
  const activeFrame = Tabs.getActiveTab()?.iframe;
  if (!activeFrame) return;
  if (loadSettings().trueTitle) startTitleWatch(activeFrame);
  startIframeWatch($("tab-viewport"), (nestedSrc) => {
    showToast("Nested frame detected. Open it?", () => navigateNewTab(nestedSrc));
  });
}
function onStageClosed() {
  stopTitleWatch();
  stopIframeWatch();
}

// ── True URL Reveal ───────────────────────────────────────────────────────

function initTrueUrlReveal() {
  let lastCtrl = 0;
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Control") return;
    const now = Date.now();
    if (now - lastCtrl < 400) {
      flashTrueUrl();
      lastCtrl = 0;
    } else {
      lastCtrl = now;
    }
  });
}

function flashTrueUrl() {
  const url = Tabs.getActiveTab()?.url;
  if (!url) return;
  const crumb = $("stage-crumb");
  if (!crumb) return;
  const original = crumb.textContent;
  crumb.textContent = url;
  crumb.style.color = "var(--accent)";
  crumb.style.fontFamily = "ui-monospace, monospace";
  crumb.style.fontSize = "12px";
  setTimeout(() => {
    crumb.textContent = original;
    crumb.style.color = "";
    crumb.style.fontFamily = "";
    crumb.style.fontSize = "";
  }, 2000);
}

function safeHostname(url) {
  try { return new URL(url).hostname; } catch { return url; }
}

// ── Taskbar ───────────────────────────────────────────────────────────────

function initTaskbar() {
  document.querySelectorAll(".taskbar-app").forEach((b) => {
    b.onclick = () => {
      const app = b.dataset.app;
      const wasActive = b.classList.contains("active");
      const panelMap = {
        browser: null,
        notes: "panel-editor",
        vault: "panel-vault",
        games: "panel-games",
      };
      const panelId = panelMap[app];

      // If the app's panel is already open and active, clicking again minimizes it.
      if (wasActive && panelId && $(panelId).classList.contains("open")) {
        closeAllPanels();
        b.classList.remove("active");
        return;
      }

      document.querySelectorAll(".taskbar-app").forEach((x) => x.classList.remove("active"));
      b.classList.add("active");
      closeAllPanels();
      switch (app) {
        case "browser":
          toggleBrowser();
          break;
        case "notes":
          openPanel("panel-editor");
          break;
        case "vault":
          openPanel("panel-vault");
          renderVault();
          break;
        case "games":
          openPanel("panel-games");
          renderGamesHome();
          break;
      }
    };
  });

  $("open-settings").onclick = () => $("settings").classList.add("open");
  $("open-docs").onclick = () => openPanel("panel-docs");
  $("open-games").onclick = () => openPanel("panel-games");
  $("open-help").onclick = (e) => {
    e.stopPropagation();
    $("help-tip").classList.toggle("open");
  };
  document.addEventListener("click", () => $("help-tip").classList.remove("open"));
}

function openPanel(id) {
  closeAllPanels();
  $(id).classList.add("open");
}
function closeAllPanels() {
  document.querySelectorAll(".panel-full").forEach((p) => p.classList.remove("open"));
}
document.querySelectorAll("[data-close]").forEach((b) => {
  b.onclick = () => {
    const panel = $(b.dataset.close);
    if (panel) {
      panel.classList.remove("open", "maximized");
      // Deactivate the corresponding taskbar app.
      const app = panel.id.replace("panel-", "");
      document.querySelectorAll(".taskbar-app").forEach((t) => {
        if (t.dataset.app === app || (app === "editor" && t.dataset.app === "notes")) t.classList.remove("active");
      });
    }
  };
});
// Minimize: hide the panel (keep state).
document.querySelectorAll("[data-minimize]").forEach((b) => {
  b.onclick = () => {
    const panel = $(b.dataset.minimize);
    if (panel) panel.classList.remove("open");
    // Deactivate taskbar app.
    const app = b.dataset.minimize.replace("panel-", "");
    document.querySelectorAll(".taskbar-app").forEach((t) => {
      if (t.dataset.app === app || (app === "editor" && t.dataset.app === "notes")) t.classList.remove("active");
    });
  };
});
// Maximize: toggle full-screen panel.
document.querySelectorAll("[data-maximize]").forEach((b) => {
  b.onclick = () => {
    const panel = $(b.dataset.maximize);
    if (panel) panel.classList.toggle("maximized");
  };
});

// ── Taskbar Auto-Hide ────────────────────────────────────────────────────

function containerAutoHide() {
  // The CSS handles the visual hiding; just ensure the hover zone works.
  document.body.dataset.taskbarHide = String(loadSettings().taskbarHide || false);
}

// ── Clock ─────────────────────────────────────────────────────────────────

function initClock() {
  const el = $("taskbar-clock");
  if (!el) return;
  function tick() {
    el.textContent = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }
  tick();
  setInterval(tick, 10000);
}

// ── Kill Switch ──────────────────────────────────────────────────────────

function initKillSwitch() {
  kill.arm();
  kill.onTrip((reason) => {
    $("kill-reason").textContent = reason || "";
  });
  $("kill-dismiss").onclick = () => kill.disarm();
  if (loadSettings().killSwitch) {
    kill.checkIpOnce();
    setInterval(() => kill.checkIpOnce(), 60000);
  }
}

// ── Session Transfer ─────────────────────────────────────────────────────

function initSessionTransfer() {
  document.addEventListener("click", async (e) => {
    const el = e.target.closest("[data-action]");
    if (!el) return;
    const action = el.dataset.action;
    try {
      if (action === "export-session") {
        await downloadSession();
        setStatus("Session exported.");
      } else if (action === "import-session") {
        const r = await pickAndImportSession();
        if (r) setStatus("Session imported. Reload to apply.");
      }
    } catch (err) {
      setStatus(err.message, true);
    }
  });
}

// ── USB Killswitch ───────────────────────────────────────────────────────

function initUsbKillswitch() {
  document.addEventListener("click", async (e) => {
    const el = e.target.closest("[data-action='usb-pick']");
    if (!el) return;
    try {
      const name = await usb.pickFolder();
      await usb.start(() => {
        const s = loadSettings();
        document.body.innerHTML = "";
        location.replace(s.panicDecoy);
      });
      setStatus("USB killswitch armed on: " + name);
      saveSettings({ usbKillswitch: true });
    } catch (err) {
      setStatus(err.message, true);
    }
  });
}

// ── Toast ─────────────────────────────────────────────────────────────────

function showToast(msg, onClick) {
  let t = $("lux-toast");
  if (!t) {
    t = document.createElement("div");
    t.id = "lux-toast";
    t.style.cssText =
      "position:fixed;bottom:72px;left:50%;transform:translateX(-50%);z-index:60;" +
      "background:var(--ink);color:var(--bg);padding:10px 16px;border-radius:8px;" +
      "font-size:13px;display:flex;gap:12px;align-items:center;box-shadow:0 4px 16px rgba(0,0,0,0.3)";
    document.body.appendChild(t);
  }
  const btn = document.createElement("button");
  btn.textContent = "Open";
  btn.style.cssText = "background:var(--bg);color:var(--ink);border:0;border-radius:4px;padding:3px 8px;cursor:pointer;font-size:12px";
  btn.onclick = () => { if (onClick) onClick(); t.remove(); };
  t.innerHTML = "<span>" + escapeHtml(msg) + "</span>";
  t.appendChild(btn);
  const close = document.createElement("button");
  close.textContent = "x";
  close.style.cssText = "background:transparent;color:var(--bg);border:0;cursor:pointer;font-size:14px";
  close.onclick = () => t.remove();
  t.appendChild(close);
  setTimeout(() => { if (t.parentElement) t.remove(); }, 10000);
}

// ── IP Badge ─────────────────────────────────────────────────────────────

async function initIpBadge() {
  if (!loadSettings().showIpBadge) return;
  const ip = await kill.checkIpOnce();
  if (ip) {
    $("ip-badge").innerHTML = `appears as <b>${ip}</b>`;
  }
}

// ── Phase 2 ──────────────────────────────────────────────────────────────

function initPhase2() {
  initVault().catch(() => {});
  initGames();
  initDocs();

  $("editor-save").onclick = async () => {
    const text = $("editor-area").value;
    try {
      await saveNote("scratch", text);
      setStatus("Note saved (encrypted).");
    } catch (e) {
      setStatus(e.message, true);
    }
  };
}

function initGames() {
  if ($("rom-folder-btn")) {
    $("rom-folder-btn").onclick = () => pickRomFolder();
  }
  if ($("rom-input")) {
    $("rom-input").onchange = async () => {
      const f = $("rom-input").files[0];
      if (f) launchRom(f);
    };
  }
}

function initDocs() {
  const docsBody = $("docs-body");
  let loaded = false;
  const tryLoad = async () => {
    if (loaded || !docsBody) return;
    loaded = true;
    try {
      const r = await fetch("/how-it-works.html");
      const html = await r.text();
      const m = html.match(/<div class="wrap">([\s\S]*?)<\/div>\s*<\/body>/);
      docsBody.innerHTML = m ? m[1] : html;
    } catch {
      docsBody.innerHTML = '<p style="color:var(--ink-soft)">Could not load docs.</p>';
    }
  };
  document.addEventListener("click", (e) => {
    if (e.target.closest && e.target.closest("#panel-docs")) tryLoad();
  }, { once: true });
}

async function renderVault() {
  const list = $("vault-list");
  list.innerHTML = "<div style='color:var(--ink-soft);font-size:13px'>Loading\u2026</div>";
  try {
    const items = await listVault();
    if (!items.length) {
      list.innerHTML = "<div style='color:var(--ink-soft);font-size:13px'>Empty. Import a file to store it encrypted in this browser.</div>";
      return;
    }
    list.innerHTML = "";
    for (const it of items) {
      const row = document.createElement("div");
      row.className = "vault-item";
      row.innerHTML = `<span>${escapeHtml(it.name)} <small style="color:var(--ink-soft)">(${formatBytes(it.size)})</small></span>`;
      const del = document.createElement("button");
      del.className = "btn";
      del.textContent = "Open";
      del.onclick = async () => {
        const blob = await openVaultItem(it.id);
        const url = URL.createObjectURL(blob);
        window.open(url, "_blank");
      };
      const rm = document.createElement("button");
      rm.className = "btn";
      rm.textContent = "Delete";
      rm.onclick = async () => {
        await deleteVaultItem(it.id);
        renderVault();
      };
      const g = document.createElement("div");
      g.style.display = "flex";
      g.style.gap = "6px";
      g.append(del, rm);
      row.append(g);
      list.append(row);
    }
  } catch (e) {
    list.innerHTML = `<div style='color:var(--danger);font-size:13px'>${escapeHtml(e.message)}</div>`;
  }
}
function formatBytes(n) {
  if (n < 1024) return n + " B";
  if (n < 1048576) return (n / 1024).toFixed(1) + " KB";
  return (n / 1048576).toFixed(1) + " MB";
}

// ── Settings UI ──────────────────────────────────────────────────────────

function initSettingsUi() {
  buildSettingsUi(loadSettings());
  $("settings-done").onclick = () => $("settings").classList.remove("open");
  $("settings-reset").onclick = () => {
    if (confirm("Reset all Lux settings?")) {
      const s = resetSettings();
      applySettingsToDom(s);
      buildSettingsUi(s);
    }
  };
  document.getElementById("settings").addEventListener("click", (e) => {
    if (e.target.id === "settings") $("settings").classList.remove("open");
  });
}

function buildSettingsUi(s) {
  const engines = listEngines();
  const body = $("settings-body");
  const row = (label, control, hint) =>
    `<label>${label}${hint ? `<small>${hint}</small>` : ""}${control}</label>`;
  const toggle = (key) =>
    `<span class="switch"><input type="checkbox" data-key="${key}" ${s[key] ? "checked" : ""}><span class="track"></span></span>`;
  const sel = (key, opts) =>
    `<select data-key="${key}">${opts.map((o) => `<option value="${o.v}" ${s[key] === o.v ? "selected" : ""}>${o.t}</option>`).join("")}</select>`;
  const txt = (key, type = "text") =>
    `<input type="${type}" data-key="${key}" value="${escapeAttr(s[key])}">`;

  body.innerHTML = `
    <div class="group">
      ${row("Engine", sel("engine", engines.map((e) => ({ v: e.name, t: e.label + (e.available ? "" : " (unavailable)") }))), "Ultraviolet is the verified engine.")}
      ${row("Search engine", sel("searchEngine", listSearchEngines().map((e) => ({ v: e.id, t: e.label }))), "Used when you type a query, not a URL.")}
    </div>
    <div class="group">
      ${row("URL scheme", sel("urlScheme", [
        { v: "encoded", t: "Obfuscated (/service/\u2026)" },
        { v: "plain", t: "Plain (/service/url)" },
        { v: "math", t: "Math disguise (/math/\u2026)" },
        { v: "none", t: "No URL" },
      ]))}
      ${row("Custom prefix", txt("customPrefix"))}
    </div>
    <div class="group">
      ${row("Theme", sel("theme", [{ v: "light", t: "Light" }, { v: "dark", t: "Dark" }]))}
      ${row("Background", sel("background", [{ v: "dots", t: "Dots" }, { v: "stars", t: "Night sky" }, { v: "none", t: "None" }]))}
      ${row("Auto-hide taskbar", toggle("taskbarHide"), "Taskbar hides unless you hover near the bottom.")}
    </div>
    <div class="group">
      ${row("Lock enabled", toggle("lockEnabled"), "Require a password on cold start.")}
      ${row("Re-lock when idle", toggle("lockOnIdle"))}
      ${row("Idle minutes", "<input type=\"number\" min=\"1\" data-key=\"lockIdleMinutes\" value=\"" + s.lockIdleMinutes + "\">")}
      ${row("Re-lock when tab closes", toggle("lockOnExit"))}
    </div>
    <div class="group">
      ${row("Clear tracking params", toggle("clearUrls"))}
      ${row("Ad / element blocker", toggle("adBlock"))}
      ${row("Site event handling", toggle("eventHandling"))}
      ${row("Google opt-out cookie", toggle("googleOptOut"))}
      ${row("Kill switch on network change", toggle("killSwitch"))}
      ${row("Show apparent IP", toggle("showIpBadge"))}
      ${row("True title + favicon", toggle("trueTitle"), "Show the proxied site's real title and icon.")}
    </div>
    <div class="group">
      <label>Session transfer<small>Export settings, vault, and cookies to a file.</small></label>
      <div style="display:flex;gap:6px">
        <button class="btn" data-action="export-session">Export</button>
        <button class="btn" data-action="import-session">Import</button>
      </div>
    </div>
  `;

  body.querySelectorAll("[data-key]").forEach((el) => {
    const key = el.dataset.key;
    const handler = () => {
      let val;
      if (el.type === "checkbox") val = el.checked;
      else if (el.type === "number") val = Number(el.value);
      else val = el.value;
      const next = saveSettings({ [key]: val });
      applySettingsToDom(next);
      if (key === "taskbarHide") {
        document.body.dataset.taskbarHide = String(val);
      }
    };
    el.addEventListener("change", handler);
  });
}

function escapeAttr(v) {
  return String(v ?? "").replace(/"/g, "&quot;");
}

// ── Status ───────────────────────────────────────────────────────────────

function setStatus(msg, isErr) {
  const s = $("status");
  s.textContent = msg || "";
  s.style.color = isErr ? "var(--danger)" : "var(--ink-soft)";
}

// ── Proxy Path ───────────────────────────────────────────────────────────

function buildProxyPath(targetUrl) {
  const s = loadSettings();
  switch (s.urlScheme) {
    case "math": return "/math/" + btoa(unescape(encodeURIComponent(targetUrl)));
    case "plain": return (s.customPrefix || "/service/") + targetUrl;
    case "none": return null;
    default: return "engine";
  }
}
