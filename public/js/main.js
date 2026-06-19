// Lux main entry. Wires the engine, transport, tab strip, toolbar, lock,
// settings, window manager, phase 2 panels. Everything is ESM.

import { loadSettings, saveSettings, resetSettings } from "./settings.js";
import { setTransportFor } from "./transport.js";
import { getEngine, listEngines } from "./engine.js";
import { normalizeUrl } from "./url-scheme.js";
import { isUnlocked, initLock, lock } from "./lock.js";
import { markCanonical, breakOutOfNest } from "./smart-iframe.js";
import { applyGoogleOptOut } from "./extensions.js";
import * as kill from "./kill-switch.js";
import { openCloaked, armPanicKey, enableAntiClose } from "./cloak.js";
import { initVault, saveNote, listVault, openVaultItem, deleteVaultItem } from "./vault.js";
import { armPrimeOnFirstGesture } from "./popup-perm.js";
import { initInfoPanel } from "./info.js";
import { initDevtools, show as showDevtools, hide as hideDevtools } from "./devtools.js";
import { launchApp, focusWindow, closeWindow, createWindow } from "./wm.js";
import { listEngines as listSearchEngines } from "./search-engines.js";
import { pickRomFolder, renderGamesHome, launchRom } from "./games.js";
import { initTV, addQuickPick } from "./tv.js";
import { initChat, disconnectChat } from "./chat.js";
import { downloadSession, pickAndImportSession } from "./session.js";
import { startIframeWatch, stopIframeWatch } from "./iframe-watch.js";
import { startTitleWatch, stopTitleWatch } from "./true-title.js";
import * as usb from "./usb-killswitch.js";
import * as Tabs from "./tabs.js";

const $ = (id) => document.getElementById(id);
const settings = loadSettings();

// ── Settings → DOM ───────────────────────────────────────────────────────

function applySettingsToDom(s) {
  document.body.dataset.theme = s.theme;
  document.body.dataset.bg = s.background;
  document.body.dataset.chrome = s.windowChrome || "macos";
  document.body.dataset.taskbarHide = String(s.taskbarHide || false);
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
  initToolbar();
  initTabStrip();
  initTaskbar();
  initSettingsUi();
  initLock();
  initKillSwitch();
  initPhase2();
  initIpBadge();
  initInfoPanel();
  initDevtools();
  initTV();
  initChat();
  initSessionTransfer();
  initUsbKillswitch();
  armPrimeOnFirstGesture();
  initTrueUrlReveal();
  initClock();
  initKeyboardShortcuts();
  containerAutoHide();

  // Add hover-zone element for taskbar auto-hide
  const zone = document.createElement("div");
  zone.id = "taskbar-hover-zone";
  document.body.appendChild(zone);

  // Expose for games.js and other modules to trigger navigation
  window.__luxNavigate = navigate;
  window.__luxTabs = Tabs;

  if (hashTarget) navigate(hashTarget);
}

// ── Background ───────────────────────────────────────────────────────────

function initBackground() {
  const canvas = $("sky");
  const ctx = canvas.getContext("2d");
  let stars = [];
  let raf = null;
  let galaxyAngle = 0;

  function resize() {
    canvas.width = innerWidth;
    canvas.height = innerHeight;
    if (stars.length === 0) {
      stars = Array.from({ length: 80 }, () => ({
        a: Math.random() * 0.5 + 0.2,
        tw: Math.random() * 0.02 + 0.005,
        dx: Math.random() * canvas.width - canvas.width / 2,
        dy: Math.random() * canvas.height - canvas.height / 2,
        r: Math.random() * 1.2 + 0.2,
      }));
    }
  }
  function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    galaxyAngle += 0.0008;
    const cx = canvas.width / 2, cy = canvas.height / 2;
    const cos = Math.cos(galaxyAngle), sin = Math.sin(galaxyAngle);
    for (const s of stars) {
      s.a += s.tw;
      if (s.a > 0.9 || s.a < 0.1) s.tw *= -1;
      const rx = s.dx * cos - s.dy * sin;
      const ry = s.dx * sin + s.dy * cos;
      ctx.beginPath();
      ctx.arc(cx + rx, cy + ry, s.r, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(255,255,255," + s.a + ")";
      ctx.fill();
    }
    raf = requestAnimationFrame(draw);
  }
  function start() { if (settings.background !== "stars") return; resize(); if (!raf) draw(); }
  function stop() { if (raf) { cancelAnimationFrame(raf); raf = null; } }
  addEventListener("resize", () => { canvas.width = innerWidth; canvas.height = innerHeight; });
  start();
  window.addEventListener("lux:settings", (e) => {
    Object.assign(settings, e.detail);
    if (e.detail.background === "stars") start(); else stop();
  });
}

// ── Browser Toolbar (always visible) ─────────────────────────────────────

let incognito = false;

function initToolbar() {
  const backBtn = $("nav-back");
  const fwdBtn = $("nav-forward");
  const reloadBtn = $("nav-reload");
  const stopBtn = $("nav-stop");

  window.__luxToolbar = {
    showReload() { reloadBtn.style.display = "flex"; stopBtn.style.display = "none"; },
    showStop() { reloadBtn.style.display = "none"; stopBtn.style.display = "flex"; },
  };

  backBtn.onclick = () => { const t = Tabs.getActiveTab(); if (t) Tabs.goBack(t.id); };
  fwdBtn.onclick = () => { const t = Tabs.getActiveTab(); if (t) Tabs.goForward(t.id); };
  stopBtn.onclick = () => { const t = Tabs.getActiveTab(); if (t) try { t.iframe.contentWindow.stop(); } catch {} window.__luxToolbar.showReload(); };
  reloadBtn.onclick = () => { const t = Tabs.getActiveTab(); if (t) { showStop(); Tabs.reloadTab(t.id); } };

  function showReload() { reloadBtn.style.display = "flex"; stopBtn.style.display = "none"; }
  function showStop() { reloadBtn.style.display = "none"; stopBtn.style.display = "flex"; }

  function updateNavButtons() {
    const tab = Tabs.getActiveTab();
    if (tab) {
      backBtn.style.opacity = tab.historyIdx > 0 ? "1" : "0.25";
      fwdBtn.style.opacity = tab.historyIdx < tab.history.length - 1 ? "1" : "0.25";
    } else {
      backBtn.style.opacity = "0.25";
      fwdBtn.style.opacity = "0.25";
    }
  }

  // Listen for tab updates to refresh nav buttons.
  Tabs.on("tabActivated", updateNavButtons);
  Tabs.on("tabUpdated", updateNavButtons);

  // Toolbar URL = omnibox
  $("toolbar-url").addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); navigate($("toolbar-url").value.trim()); }
  });

  // New-tab page URL input
  const ntUrl = $("nt-url");
  if (ntUrl) {
    ntUrl.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); navigate(ntUrl.value.trim()); }
    });
    // Focus the input when new-tab page becomes visible
    const observer = new MutationObserver(() => {
      if (!ntUrl.closest(".hidden")) setTimeout(() => ntUrl.focus(), 100);
    });
    observer.observe(ntUrl.closest("#new-tab-page") || document.body, { attributes: true, attributeFilter: ["class"] });
  }

  // Incognito toggle
  $("incognito-btn").onclick = () => { incognito = !incognito; $("incognito-btn").classList.toggle("active"); };

  $("nav-new").onclick = () => { Tabs.createTab(); renderTabStrip(); };
  $("nav-close").onclick = closeBrowser;

  // Browser window chrome buttons
  const bw = $("browser-window");
  const minimizeBrowser = () => {
    bw.classList.add("browser-minimized");
    document.querySelectorAll(".taskbar-app").forEach((x) => x.classList.remove("active"));
  };
  $("browser-minimize").onclick = minimizeBrowser;
  $("browser-close").onclick = minimizeBrowser;
  $("browser-maximize").onclick = () => {
    bw.classList.toggle("browser-maximized");
  };
}

// ── Tab Strip Rendering ──────────────────────────────────────────────────

function renderTabStrip() {
  const strip = $("tab-strip");
  if (!strip) return;
  const allTabs = Tabs.getAllTabs();
  const activeTab = Tabs.getActiveTab();
  
  // Show new-tab page when active tab has no URL (is a "new tab")
  if (!activeTab || !activeTab.url) {
    $("new-tab-page")?.classList.remove("hidden");
    $("toolbar-url").value = "";
  } else {
    $("new-tab-page")?.classList.add("hidden");
    $("toolbar-url").value = activeTab.url;
  }

  if (allTabs.length === 0) {
    strip.innerHTML = "";
    return;
  }
  strip.innerHTML = "";
  for (const t of allTabs) {
    const el = document.createElement("div");
    el.className = "tab-item" + (t.id === activeTab?.id ? " active" : "");
    el.dataset.tabId = String(t.id);
    el.draggable = true;
    el.title = t.title || t.url || "";
    const fav = t.favicon ? "<img class=\"tab-fav\" src=\"" + t.favicon + "\" alt=\"\">" : "";
    el.innerHTML = fav + "<span class=\"tab-title\">" + escapeHtml(t.title || t.url || "New Tab") + "</span><button class=\"tab-close\">&times;</button>";
    el.querySelector(".tab-close").onclick = (e) => { e.stopPropagation(); Tabs.closeTab(t.id); };
    el.onclick = () => { Tabs.activateTab(t.id); };
    el.onauxclick = (e) => { if (e.button === 1) Tabs.closeTab(t.id); };
    // Drag-and-drop reorder
    el.ondragstart = (e) => { e.dataTransfer.setData("text/plain", String(t.id)); el.classList.add("dragging"); };
    el.ondragend = () => { el.classList.remove("dragging"); document.querySelectorAll(".tab-item.dragging").forEach(x => x.classList.remove("dragging")); };
    el.ondragover = (e) => { e.preventDefault(); };
    el.ondrop = (e) => {
      e.preventDefault();
      const fromId = parseInt(e.dataTransfer.getData("text/plain"));
      if (fromId && fromId !== t.id) { Tabs.reorderTabs(fromId, t.id); }
    };
  }
  const plus = document.createElement("button");
  plus.className = "tab-new";
  plus.textContent = "+";
  plus.onclick = () => { Tabs.createTab(); };
  strip.appendChild(plus);
}

function initTabStrip() {
  // Start with one new-tab
  Tabs.createTab();
  renderTabStrip();

  Tabs.on("tabCreated", () => { renderTabStrip(); });
  Tabs.on("tabClosed", () => { renderTabStrip(); });
  function updateBrowserTitle(tab) {
    const title = tab ? (tab.title || tab.url || "New Tab") : "Browser";
    const el = $("browser-title");
    if (el) el.textContent = title;
  }

  Tabs.on("tabActivated", (tab) => {
    renderTabStrip();
    updateBrowserTitle(tab);
    if (tab && tab.url) {
      $("toolbar-url").value = tab.url;
      onStageOpened();
    }
  });
  Tabs.on("tabUpdated", (tab) => {
    updateBrowserTitle(tab);
  });
  Tabs.on("tabUpdated", (tab) => {
    renderTabStrip();
    if (!tab.loading && window.__luxToolbar) {
      window.__luxToolbar.showReload();
    }
  });
}

// ── Navigation ───────────────────────────────────────────────────────────

function navigate(input) {
  if (!input || !isUnlocked()) return;
  const url = normalizeUrl(input);
  if (!url) return;
  if (breakOutOfNest(url)) return;

  let tab = Tabs.getActiveTab();
  if (!tab || tab.url) {
    tab = Tabs.createTab();
  }
  Tabs.navigateTab(tab.id, url, true);
  $("toolbar-url").value = url;
  setStatus("Loading...");
  if (window.__luxToolbar) window.__luxToolbar.showStop();
  onStageOpened();
}

function navigateNewTab(url) {
  if (!isUnlocked()) return;
  const decoded = normalizeUrl(url);
  if (!decoded) return;
  Tabs.createTab(decoded);
}

function closeBrowser() {
  const tab = Tabs.getActiveTab();
  if (tab) Tabs.closeTab(tab.id);
  onStageClosed();
}

// ── Orphan detection ─────────────────────────────────────────────────────
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
  const f = Tabs.getActiveTab()?.iframe;
  if (!f) return;
  if (loadSettings().trueTitle) startTitleWatch(f);
  startIframeWatch($("tab-viewport"), (src) => navigateNewTab(src));
}
function onStageClosed() { stopTitleWatch(); stopIframeWatch(); }

// ── True URL Reveal ───────────────────────────────────────────────────────

function initTrueUrlReveal() {
  let lastCtrl = 0;
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Control") return;
    const now = Date.now();
    if (now - lastCtrl < 400) { flashTrueUrl(); lastCtrl = 0; }
    else lastCtrl = now;
  });
}

function flashTrueUrl() {
  const url = Tabs.getActiveTab()?.url;
  if (!url) return;
  $("toolbar-url").value = url;
}

// ── Taskbar ──────────────────────────────────────────────────────────────

function initTaskbar() {
  document.querySelectorAll(".taskbar-app").forEach((b) => {
    b.onclick = () => {
      const app = b.dataset.app;
      document.querySelectorAll(".taskbar-app").forEach((x) => x.classList.remove("active"));
      b.classList.add("active");
      closeAllPanels();

      switch (app) {
        case "browser":
          $("browser-window").classList.remove("browser-minimized");
          break;
        case "notes":
          launchApp("notes", (id) => {
            const body = document.createElement("div");
            body.style.cssText = "flex:1;display:flex;flex-direction:column;overflow:hidden;";
            import("./editor.js").then(async (ed) => {
              const content = await ed.loadDocument("scratch");
              await ed.initEditor(body, content);
              const bar = document.createElement("div");
              bar.style.cssText = "display:flex;gap:8px;padding:6px 8px;border-top:1px solid var(--line);";
              const s = document.createElement("button");
              s.className = "btn"; s.textContent = "Save";
              s.onclick = async () => {
                try { ed.saveDocument("scratch", ed.getActiveEditor().getHTML()); setStatus("Saved."); }
                catch (e) { setStatus(e.message, true); }
              };
              const eh = document.createElement("button");
              eh.className = "btn"; eh.textContent = "Export HTML";
              eh.onclick = () => ed.exportAsHtml();
              const et = document.createElement("button");
              et.className = "btn"; et.textContent = "Export TXT";
              et.onclick = () => ed.exportAsText();
              bar.append(s, eh, et);
              body.appendChild(bar);
            });
            createWindow({ id: "notes", title: "Documents", width: 640, height: 480, content: body, onClose: () => { b.classList.remove("active"); } });
          });
          break;
        case "vault":
          launchApp("vault", (id) => {
            const list = document.createElement("div");
            list.style.cssText = "padding:8px;flex:1;overflow-y:auto;";
            const render = () => {
              listVault().then((items) => {
                list.innerHTML = items.length ? "" : "<div style='color:var(--ink-soft);font-size:13px;padding:12px'>Empty vault.</div>";
                for (const it of items) {
                  const row = document.createElement("div");
                  row.style.cssText = "display:flex;justify-content:space-between;padding:8px 10px;border:1px solid var(--line);border-radius:8px;margin-bottom:6px;font-size:13px;";
                  row.innerHTML = "<span>" + escapeHtml(it.name) + "</span>";
                  const g = document.createElement("div");
                  g.style.cssText = "display:flex;gap:6px";
                  const o = document.createElement("button");
                  o.className = "btn"; o.textContent = "Open";
                  o.onclick = async () => { const b = await openVaultItem(it.id); window.open(URL.createObjectURL(b), "_blank"); };
                  const d = document.createElement("button");
                  d.className = "btn"; d.textContent = "Delete";
                  d.onclick = async () => { await deleteVaultItem(it.id); render(); };
                  g.append(o, d);
                  row.append(g);
                  list.append(row);
                }
              }).catch(() => {});
            };
            render();
            const hdr = document.createElement("div");
            hdr.style.cssText = "display:flex;gap:8px;padding:8px 12px;border-bottom:1px solid var(--line);";
            const imp = document.createElement("button");
            imp.className = "btn"; imp.textContent = "Import";
            hdr.appendChild(imp);
            const body = document.createElement("div");
            body.style.cssText = "flex:1;display:flex;flex-direction:column;overflow:hidden;";
            body.append(hdr, list);
            createWindow({ id: "vault", title: "Vault", width: 450, height: 350, content: body, onClose: () => { b.classList.remove("active"); } });
          });
          break;
        case "games":
          closeAllPanels();
          $("panel-games").classList.add("open");
          renderGamesHome();
          break;
        case "tv":
          closeAllPanels();
          $("panel-tv").classList.add("open");
          break;
        case "chat":
          closeAllPanels();
          $("panel-chat").classList.add("open");
          break;
      }
    };
  });

  // Settings/docs still open as overlays
  $("open-settings").onclick = () => $("settings").classList.add("open");
  $("open-docs").onclick = () => {
    launchApp("docs", (id) => {
      const body = document.createElement("div");
      body.style.cssText = "padding:12px;font-size:14px;line-height:1.6;";
      body.innerHTML = "<p>Loading docs...</p>";
      fetch("/how-it-works.html").then(r => r.text()).then(html => {
        const m = html.match(/<div class="wrap">([\s\S]*?)<\/div>/);
        body.innerHTML = m ? m[1] : html;
      }).catch(() => { body.innerHTML = "<p>Could not load docs.</p>"; });
      createWindow({ id: "docs", title: "How it works", width: 600, height: 400, content: body, onClose: () => {} });
    });
  };
  $("open-help").onclick = (e) => { e.stopPropagation(); $("help-tip").classList.toggle("open"); };
  document.addEventListener("click", () => $("help-tip").classList.remove("open"));

  // Wire the right-side games icon button (was dead)
  const gamesIcon = $("open-games");
  if (gamesIcon) {
    gamesIcon.onclick = () => {
      closeAllPanels();
      $("panel-games").classList.add("open");
      renderGamesHome();
    };
  }
}

function closeAllPanels() {
  document.querySelectorAll(".panel-full").forEach((p) => p.classList.remove("open"));
}
document.querySelectorAll("[data-close]").forEach((b) => {
  b.onclick = () => {
    const panel = $(b.dataset.close);
    if (panel) panel.classList.remove("open", "maximized");
  };
});

// ---- Keyboard shortcuts ----
function initKeyboardShortcuts() {
  document.addEventListener("keydown", (e) => {
    // Ctrl+T: new tab
    if ((e.ctrlKey || e.metaKey) && e.key === "t") {
      e.preventDefault();
      Tabs.createTab();
      renderTabStrip();
    }
    // Ctrl+W: close active tab
    if ((e.ctrlKey || e.metaKey) && e.key === "w") {
      e.preventDefault();
      const t = Tabs.getActiveTab();
      if (t) Tabs.closeTab(t.id);
      renderTabStrip();
    }
    // Ctrl+Tab: cycle to next tab
    if ((e.ctrlKey || e.metaKey) && e.key === "Tab") {
      e.preventDefault();
      const all = Tabs.getAllTabs();
      if (all.length < 2) return;
      const active = Tabs.getActiveTab();
      const idx = active ? all.findIndex((t) => t.id === active.id) : -1;
      const next = all[(idx + 1) % all.length];
      if (next) { Tabs.activateTab(next.id); renderTabStrip(); }
    }
    // Ctrl+Shift+Tab: cycle to previous tab
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === "Tab") {
      e.preventDefault();
      const all = Tabs.getAllTabs();
      if (all.length < 2) return;
      const active = Tabs.getActiveTab();
      const idx = active ? all.findIndex((t) => t.id === active.id) : 0;
      const prev = all[(idx - 1 + all.length) % all.length];
      if (prev) { Tabs.activateTab(prev.id); renderTabStrip(); }
    }
    // Escape: close active panel
    if (e.key === "Escape") {
      const openPanel = document.querySelector(".panel-full.open");
      if (openPanel) openPanel.classList.remove("open");
      const settings = $("settings");
      if (settings?.classList.contains("open")) settings.classList.remove("open");
    }
  });
}

function containerAutoHide() {
  document.body.dataset.taskbarHide = String(loadSettings().taskbarHide || false);
}

// ── Clock ─────────────────────────────────────────────────────────────────

function initClock() {
  const el = $("taskbar-clock");
  if (!el) return;
  function tick() { el.textContent = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }); }
  tick();
  setInterval(tick, 10000);
}

// ── Kill Switch ──────────────────────────────────────────────────────────

function initKillSwitch() {
  kill.arm();
  kill.onTrip((r) => { $("kill-reason").textContent = r || ""; });
  $("kill-dismiss").onclick = () => kill.disarm();
  if (loadSettings().killSwitch) { kill.checkIpOnce(); setInterval(() => kill.checkIpOnce(), 60000); }
}

// ── Session Transfer ─────────────────────────────────────────────────────

function initSessionTransfer() {
  document.addEventListener("click", async (e) => {
    const el = e.target.closest("[data-action]");
    if (!el) return;
    const a = el.dataset.action;
    try {
      if (a === "export-session") { await downloadSession(); setStatus("Exported."); }
      else if (a === "import-session") { const r = await pickAndImportSession(); if (r) setStatus("Imported."); }
    } catch (err) { setStatus(err.message, true); }
  });
}

function initUsbKillswitch() {
  document.addEventListener("click", async (e) => {
    const el = e.target.closest("[data-action='usb-pick']");
    if (!el) return;
    try {
      const name = await usb.pickFolder();
      await usb.start(() => { const s = loadSettings(); document.body.innerHTML = ""; location.replace(s.panicDecoy); });
      setStatus("USB killswitch armed: " + name);
      saveSettings({ usbKillswitch: true });
    } catch (err) { setStatus(err.message, true); }
  });
}

// ── Toast ─────────────────────────────────────────────────────────────────

function showToast(msg, onClick) {
  let t = $("lux-toast");
  if (!t) {
    t = document.createElement("div");
    t.id = "lux-toast";
    t.style.cssText = "position:fixed;bottom:72px;left:50%;transform:translateX(-50%);z-index:60;background:var(--ink);color:var(--bg);padding:10px 16px;border-radius:8px;font-size:13px;display:flex;gap:12px;align-items:center;box-shadow:0 4px 16px rgba(0,0,0,0.3)";
    document.body.appendChild(t);
  }
  const b = document.createElement("button");
  b.textContent = "Open";
  b.style.cssText = "background:var(--bg);color:var(--ink);border:0;border-radius:4px;padding:3px 8px;cursor:pointer;font-size:12px";
  b.onclick = () => { if (onClick) onClick(); t.remove(); };
  t.innerHTML = "<span>" + escapeHtml(msg) + "</span>";
  t.appendChild(b);
  const x = document.createElement("button");
  x.textContent = "x";
  x.style.cssText = "background:transparent;color:var(--bg);border:0;cursor:pointer;font-size:14px";
  x.onclick = () => t.remove();
  t.appendChild(x);
  setTimeout(() => { if (t.parentElement) t.remove(); }, 10000);
}

// ── IP Badge ─────────────────────────────────────────────────────────────

async function initIpBadge() {
  if (!loadSettings().showIpBadge) return;
  const ip = await kill.checkIpOnce();
  if (ip) { $("ip-badge").innerHTML = "appears as <b>" + ip + "</b>"; }
}

// ── Phase 2 ──────────────────────────────────────────────────────────────

function initPhase2() {
  initVault().catch(() => {});
}

// ── Settings UI ──────────────────────────────────────────────────────────

function initSettingsUi() {
  buildSettingsUi(loadSettings());
  $("settings-done").onclick = () => $("settings").classList.remove("open");
  $("settings-reset").onclick = () => {
    if (confirm("Reset all settings?")) { const s = resetSettings(); applySettingsToDom(s); buildSettingsUi(s); }
  };
  document.getElementById("settings").addEventListener("click", (e) => {
    if (e.target.id === "settings") $("settings").classList.remove("open");
  });
}

function buildSettingsUi(s) {
  const engines = listEngines();
  const body = $("settings-body");
  const row = (l, c, h) => "<label>" + l + (h ? "<small>" + h + "</small>" : "") + c + "</label>";
  const toggle = (k) => "<span class=\"switch\"><input type=\"checkbox\" data-key=\"" + k + "\" " + (s[k] ? "checked" : "") + "><span class=\"track\"></span></span>";
  const sel = (k, opts) => "<select data-key=\"" + k + "\">" + opts.map((o) => "<option value=\"" + o.v + "\" " + (s[k] === o.v ? "selected" : "") + ">" + o.t + "</option>").join("") + "</select>";

  body.innerHTML =
    "<div class=\"group\">" +
    row("Engine", sel("engine", engines.map((e) => ({ v: e.name, t: e.label + (e.available ? "" : " (unavailable)") })))) +
    row("Search engine", sel("searchEngine", listSearchEngines().map((e) => ({ v: e.id, t: e.label })))) +
    "</div>" +
    "<div class=\"group\">" +
    row("URL scheme", sel("urlScheme", [{ v: "encoded", t: "Obfuscated" }, { v: "plain", t: "Plain" }, { v: "math", t: "Math disguise" }, { v: "none", t: "No URL" }])) +
    row("Theme", sel("theme", [{ v: "light", t: "Light" }, { v: "dark", t: "Dark" }])) +
    row("Background", sel("background", [{ v: "dots", t: "Dots" }, { v: "stars", t: "Night sky" }, { v: "none", t: "None" }])) +
    row("Auto-hide taskbar", toggle("taskbarHide")) +
    "</div>" +
    "<div class=\"group\">" +
    row("Lock enabled", toggle("lockEnabled")) +
    row("Re-lock when idle", toggle("lockOnIdle")) +
    row("Idle minutes", "<input type=\"number\" min=\"1\" data-key=\"lockIdleMinutes\" value=\"" + s.lockIdleMinutes + "\" style=\"width:60px\">") +
    row("Re-lock when tab closes", toggle("lockOnExit")) +
    "</div>" +
    "<div class=\"group\">" +
    row("Clear tracking params", toggle("clearUrls")) +
    row("Ad / element blocker", toggle("adBlock")) +
    row("Site event handling", toggle("eventHandling")) +
    row("Google opt-out cookie", toggle("googleOptOut")) +
    row("Kill switch on network change", toggle("killSwitch")) +
    row("Show apparent IP", toggle("showIpBadge")) +
    row("True title + favicon", toggle("trueTitle")) +
    row("DevTools request viewer", toggle("devtools")) +
    "</div>" +
    "<div class=\"group\">" +
    "<label>Session<small>Export settings and vault.</small>" +
    "<div style=\"display:flex;gap:6px;margin-top:6px\">" +
    "<button class=\"btn\" data-action=\"export-session\">Export</button>" +
    "<button class=\"btn\" data-action=\"import-session\">Import</button></div></label>" +
    "</div>";

  body.querySelectorAll("[data-key]").forEach((el) => {
    el.addEventListener("change", () => {
      let val;
      if (el.type === "checkbox") val = el.checked;
      else if (el.type === "number") val = Number(el.value);
      else val = el.value;
      const next = saveSettings({ [el.dataset.key]: val });
      applySettingsToDom(next);
      if (el.dataset.key === "taskbarHide") document.body.dataset.taskbarHide = String(val);
      if (el.dataset.key === "devtools") { if (val) showDevtools(); else hideDevtools(); }
    });
  });
}

// ── Status ───────────────────────────────────────────────────────────────

function setStatus(msg, isErr) {
  const s = $("status");
  if (s) { s.textContent = msg || ""; s.style.color = isErr ? "var(--danger)" : "var(--ink-soft)"; }
}

function escapeHtml(s) { return String(s).replace(/[&<>"']/g, (c) => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[c]); }
