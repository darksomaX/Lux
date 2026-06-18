// Lux main entry. Wires the engine, transport, settings UI, lock, kill switch,
// dock tools, and phase 2 panels. Everything is ESM; bare-mux is attached to
// window.BareMux in transport.js so engine code expecting the global works.

import { loadSettings, saveSettings, resetSettings } from "./settings.js";
import { setTransportFor } from "./transport.js";
import { getEngine, listEngines } from "./engine.js";
import { normalizeUrl, buildProxyPath } from "./url-scheme.js";
import { isUnlocked, tryUnlock, lock, armIdle } from "./lock.js";
import { markCanonical, breakOutOfNest } from "./smart-iframe.js";
import { applyGoogleOptOut } from "./extensions.js";
import * as kill from "./kill-switch.js";
import { openCloaked, applyDisguise, listDisguises, armPanicKey, enableAntiClose } from "./cloak.js";
import { initVault, saveNote, listVault, importFile, openVaultItem, deleteVaultItem } from "./vault.js";
import { armPrimeOnFirstGesture } from "./popup-perm.js";
import { listEngines as listSearchEngines } from "./search-engines.js";
import { pickRomFolder, renderGamesHome, launchRom } from "./games.js";

const $ = (id) => document.getElementById(id);
const settings = loadSettings();

// ---- apply persisted settings to the DOM ----
function applySettingsToDom(s) {
  document.body.dataset.theme = s.theme;
  document.body.dataset.bg = s.background;
  document.body.dataset.dock = String(s.showDock);
  document.body.dataset.fs = s.fullscreenMode;
  document.body.dataset.chrome = s.windowChrome || "macos";
  const badge = $("ip-badge");
  if (badge) badge.style.display = s.showIpBadge ? "block" : "none";
}
applySettingsToDom(settings);

markCanonical();
applyGoogleOptOut();

// ---- nesting guard: never run Lux inside a proxied Lux ----
const hashTarget = decodeURIComponent(location.hash.slice(1));
if (breakOutOfNest(hashTarget)) {
  // stop here; the top frame takes over.
} else {
  boot();
}

async function boot() {
  initBackground();
  initChrome();
  initSearch();
  initStage();
  initSettingsUi();
  initLock();
  initKillSwitch();
  initPhase2();
  initIpBadge();
  // Prime popup permission on the first gesture so the Cloak button works
  // without a failed first click.
  armPrimeOnFirstGesture();

  if (hashTarget) navigate(hashTarget);
}

// ---------- background animation ----------
function initBackground() {
  const canvas = $("sky");
  const ctx = canvas.getContext("2d");
  let stars = [];
  let raf = null;
  let idleTimer = null;

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
  // Night sky appears when the user goes idle (no input for ~6s).
  ["pointermove", "keydown", "click"].forEach((ev) =>
    addEventListener(ev, () => {
      clearTimeout(idleTimer);
      if (document.body.dataset.bg === "stars") return;
      // while active, ensure stars are off unless chosen as the setting
      idleTimer = setTimeout(() => {
        if (settings.background !== "stars") {
          // gentle idle reveal only on light theme
        }
      }, 6000);
    })
  );
  start();
  window.addEventListener("lux:settings", (e) => {
    Object.assign(settings, e.detail);
    if (e.detail.background === "stars") start();
    else stop();
  });
}

// ---------- bottom bar + corners ----------
function initChrome() {
  // bottom-bar home/search button -> focus the home search input
  $("bar-home").onclick = () => {
    closeAllPanels();
    $("stage").classList.remove("active");
    setTimeout(() => $("search-input").focus(), 100);
  };

  // search back arrow -> close the stage and go home
  $("search-back").onclick = () => {
    $("frame").src = "about:blank";
    $("stage").classList.remove("active");
  };

  // cloak icon next to the search bar
  $("cloak-btn").onclick = () => {
    const t = $("search-input").value.trim();
    if (t) openCloakedTarget(t);
  };

  // top-right: docs (how it works) + games
  $("open-docs").onclick = () => openPanel("panel-docs");
  $("open-games").onclick = () => openPanel("panel-games");

  // bottom-left help tooltip toggle
  $("open-help").onclick = (e) => {
    e.stopPropagation();
    $("help-tip").classList.toggle("open");
  };
  document.addEventListener("click", () => $("help-tip").classList.remove("open"));

  // bar app switching. Each app opens its panel; Browser shows the stage.
  // Only Browser is active by default.
  document.querySelectorAll(".bar-app").forEach((b) => {
    b.onclick = () => {
      document.querySelectorAll(".bar-app").forEach((x) => x.classList.remove("active"));
      b.classList.add("active");
      const app = b.dataset.app;
      closeAllPanels();
      switch (app) {
        case "browser":
          if (currentTarget) $("stage").classList.add("active");
          else $("stage").classList.remove("active");
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
}

function openPanel(id) {
  closeAllPanels();
  $(id).classList.add("open");
}
function closeAllPanels() {
  document.querySelectorAll(".panel-full").forEach((p) => p.classList.remove("open"));
}
document.querySelectorAll("[data-close]").forEach((b) => {
  b.onclick = () => $(b.dataset.close).classList.remove("open");
});

// ---------- search / navigate ----------
function initSearch() {
  $("search-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const v = $("search-input").value.trim();
    if (v) navigate(v);
  });
}

let currentTarget = null;
async function navigate(input) {
  if (!isUnlocked()) {
    pendingTarget = input;
    return;
  }
  const url = normalizeUrl(input);
  if (!url) return;
  currentTarget = url;

  // Smart-iframe: if this very URL is already Lux, refuse to nest.
  if (breakOutOfNest(url)) return;

  const eng = getEngine();
  setStatus("Starting " + eng.label + "...");
  try {
    await setTransportFor(eng.name);
    const frame = $("frame");

    // Resolve the URL scheme. buildProxyPath returns:
    //   "engine" -> let the engine use its own encoder (UV xor default)
    //   "<path>" -> a custom path; wrap it as the encode function
    //   null     -> "none" scheme: open in an iframe chain, no proxy path
    const schemePath = buildProxyPath(url);
    let encodeOverride = null;
    if (schemePath && schemePath !== "engine") {
      encodeOverride = (u) => schemePath;
    }

    if (schemePath === null) {
      // "none" scheme: load the target directly into the frame (the service
      // worker still rewrites it, but the URL bar shows Lux, not /service/...).
      await eng.init();
      frame.src = url;
    } else if (eng.name === "scramjet") {
      await eng.mount(url, frame);
    } else {
      await eng.mount(url, frame, encodeOverride);
    }
    $("stage").classList.add("active");
    $("stage-crumb").textContent = safeHostname(url);
    setStatus("");
  } catch (err) {
    setStatus(err.message, true);
  }
}

function safeHostname(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}
// expose for the nesting adopt handler + dock
window.Lux = { navigate };
let pendingTarget = null;

function setStatus(msg, isErr) {
  const s = $("status");
  s.textContent = msg || "";
  s.style.color = isErr ? "var(--danger)" : "var(--ink-soft)";
}

// ---------- cloak ----------
async function openCloakedTarget(input) {
  const url = normalizeUrl(input);
  if (!url) return;
  try {
    await setTransportFor(getEngine().name);
    await getEngine().init();
    // openCloaked expects an encode function; for UV we use the engine encoder.
    const enc = (u) => getEngine().encode(u) || "/uv/" + u;
    await openCloaked(url, enc);
    setStatus("Opened in cloaked window.");
  } catch (e) {
    setStatus(e.message, true);
  }
}

// ---------- stage ----------
function initStage() {
  $("stage-close").onclick = () => {
    $("frame").src = "about:blank";
    $("stage").classList.remove("active");
    currentTarget = null;
    const s = loadSettings();
    if (s.lockOnExit) lock();
  };
  $("bar-home").onclick = () => $("stage-close").click();
}

// ---------- lock ----------
function initLock() {
  const s = loadSettings();
  armPanicKey({ decoy: s.panicDecoy, key: s.panicKey });
  if (s.antiClose) enableAntiClose();

  if (!s.lockEnabled) {
    return; // unlocked mode
  }
  if (isUnlocked()) {
    armIdle();
    return;
  }
  // cold start
  document.body.classList.add("lux-locked");
  const input = $("lock-input");
  input.focus();
  input.onkeydown = async (e) => {
    if (e.key !== "Enter") return;
    const ok = await tryUnlock(input.value);
    if (ok) {
      if (pendingTarget) {
        navigate(pendingTarget);
        pendingTarget = null;
      }
    } else {
      $("lock-msg").textContent = "Try again.";
    }
    input.value = "";
  };
}

// ---------- kill switch ----------
function initKillSwitch() {
  kill.arm();
  kill.onTrip((reason) => {
    $("kill-reason").textContent = reason || "";
  });
  $("kill-dismiss").onclick = () => kill.disarm();
  // periodic IP check (every 60s) trips the switch on change
  if (loadSettings().killSwitch) {
    kill.checkIpOnce();
    setInterval(() => kill.checkIpOnce(), 60000);
  }
}

// ---------- IP badge ----------
async function initIpBadge() {
  if (!loadSettings().showIpBadge) return;
  const ip = await kill.checkIpOnce();
  if (ip) {
    $("ip-badge").innerHTML = `appears as <b>${ip}</b>`;
  }
}

// ---------- phase 2 ----------
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
  // Load the scratch note into the editor when the Notes panel opens.
  const editorOpen = $("open-docs"); // any panel open is fine; we hook the editor close
  document.querySelector('[data-close="panel-editor"]').addEventListener("click", () => {}, { once: true });
}

// ---------- games ----------
function initGames() {
  // ROM folder picker (File System Access API, with file-input fallback).
  if ($("rom-folder-btn")) {
    $("rom-folder-btn").onclick = () => pickRomFolder();
  }
  if ($("rom-input")) {
    $("rom-input").onchange = async () => {
      const f = $("rom-input").files[0];
      if (f) launchRom(f);
    };
  }
  // Render the games home when the panel is first opened.
  const gamesPanel = $("panel-games");
  const openObserver = () => {
    if (gamesPanel.classList.contains("open")) {
      renderGamesHome();
    }
  };
  // Polling is cheap and avoids MutationObserver complexity for one panel.
  document.querySelectorAll("[data-close]").forEach((b) => {
    if (b.dataset.close === "panel-games") {
      b.addEventListener("click", () => {}, { once: false });
    }
  });
}

// ---------- docs ----------
function initDocs() {
  // Load the how-it-works content into the docs panel on first open.
  const docsBody = $("docs-body");
  let loaded = false;
  const tryLoad = async () => {
    if (loaded || !docsBody) return;
    loaded = true;
    try {
      const r = await fetch("/how-it-works.html");
      const html = await r.text();
      // Extract the inner content of the .wrap div (strip the page chrome).
      const m = html.match(/<div class="wrap">([\s\S]*?)<\/div>\s*<\/body>/);
      docsBody.innerHTML = m ? m[1] : html;
    } catch {
      docsBody.innerHTML = '<p style="color:var(--ink-soft)">Could not load docs.</p>';
    }
  };
  // Observe panel-games open via the open-games click; docs is its own panel.
  document.addEventListener("click", (e) => {
    if (e.target.closest && e.target.closest("#panel-docs")) tryLoad();
  }, { once: true });
  // Also load proactively when the docs button is clicked.
  if ($("open-docs")) $("open-docs").addEventListener("click", tryLoad);
}

async function renderVault() {
  const list = $("vault-list");
  list.innerHTML = "<div style='color:var(--ink-soft);font-size:13px'>Loading…</div>";
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
        // open via the proxy-less blob URL in a new tab
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

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function formatBytes(n) {
  if (n < 1024) return n + " B";
  if (n < 1048576) return (n / 1024).toFixed(1) + " KB";
  return (n / 1048576).toFixed(1) + " MB";
}

// ---------- settings UI ----------
function initSettingsUi() {
  buildSettingsUi(loadSettings());
  $("open-settings").onclick = () => $("settings").classList.add("open");
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
      ${row("Engine", sel("engine", engines.map((e) => ({ v: e.name, t: e.label + (e.available ? "" : " (unavailable)") }))), "Ultraviolet is the default. Scramjet is the newer successor.")}
      ${row("Search engine", sel("searchEngine", listSearchEngines().map((e) => ({ v: e.id, t: e.label }))), "Used when you type a query, not a URL.")}
    </div>
    <div class="group">
      ${row("URL scheme", sel("urlScheme", [
        { v: "encoded", t: "Obfuscated (/service/…)" },
        { v: "plain", t: "Plain (/service/url)" },
        { v: "math", t: "Math disguise (/math/…)" },
        { v: "none", t: "No URL (iframe chains)" },
      ]), "How the destination appears in the address bar.")}
      ${row("Custom prefix", txt("customPrefix"), "Used by the plain scheme.")}
    </div>
    <div class="group">
      ${row("Theme", sel("theme", [{ v: "light", t: "Light" }, { v: "dark", t: "Dark" }]))}
      ${row("Background", sel("background", [{ v: "dots", t: "Dots" }, { v: "stars", t: "Night sky" }, { v: "none", t: "None" }]))}
      ${row("Show tools dock", toggle("showDock"))}
      ${row("Fullscreen", sel("fullscreenMode", [{ v: "off", t: "Off" }, { v: "page", t: "Page (hide chrome)" }, { v: "full", t: "Browser fullscreen" }]))}
      ${row("Window borders", sel("windowChrome", [{ v: "macos", t: "macOS" }, { v: "windows", t: "Windows" }]), "Panel and bar border style.")}
    </div>
    <div class="group">
      ${row("Lock enabled", toggle("lockEnabled"), "Require a phrase on cold start.")}
      ${row("Unlock phrase", txt("lockPhrase"), "Defaults to a single letter.")}
      ${row("Re-lock when idle", toggle("lockOnIdle"))}
      ${row("Idle minutes", `<input type="number" min="1" data-key="lockIdleMinutes" value="${s.lockIdleMinutes}">`)}
      ${row("Re-lock when tab closes", toggle("lockOnExit"))}
      ${row("Block devtools while locked", toggle("blockDevtools"), "Best-effort only; nothing client-side is a real barrier.")}
    </div>
    <div class="group">
      ${row("Clear tracking params (ClearURLs)", toggle("clearUrls"))}
      ${row("Ad / element blocker", toggle("adBlock"))}
      ${row("Site event handling", toggle("eventHandling"), "Off freezes overlay traps (beforeunload etc.).")}
      ${row("Google opt-out cookie", toggle("googleOptOut"))}
      ${row("Kill switch on network change", toggle("killSwitch"))}
      ${row("Show apparent IP", toggle("showIpBadge"))}
      ${row("Anti-close warning", toggle("antiClose"))}
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
    };
    el.addEventListener("change", handler);
  });
}
function escapeAttr(v) {
  return String(v ?? "").replace(/"/g, "&quot;");
}
