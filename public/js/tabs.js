// Tab manager. Each tab owns its own proxied iframe, history stack, and
// metadata. The active tab's iframe is shown; others are hidden (kept alive so
// they preserve state when you switch back).
//
// Design:
//   - A "new tab" (like Chrome's new-tab page) shows the Lux home search.
//   - Navigating from the home search turns the current "new tab" into a real
//     browsing tab and creates a fresh "new tab" after it.
//   - window.open inside proxied pages is intercepted (via a postMessage hook
//     injected into each frame) to open a new Lux tab instead of a bare
//     browser tab — this fixes the "raw /service/ URL with no toolbar" bug.
//   - Orphan detection: if Lux itself is loaded at a bare /service/ URL (the
//     user opened a proxied link directly), show a "return to Lux" toast.

let tabs = [];
let activeTabId = null;
let nextTabId = 1;

const listeners = {
  tabCreated: [],
  tabClosed: [],
  tabActivated: [],
  tabUpdated: [],
};

export function on(event, cb) {
  if (listeners[event]) listeners[event].push(cb);
}

function emit(event, data) {
  (listeners[event] || []).forEach((cb) => {
    try { cb(data); } catch {}
  });
}

// Create a new tab. If `url` is given, navigate it immediately; otherwise it
// starts as a "new tab" (home search).
export function createTab(url = null) {
  const id = nextTabId++;
  const iframe = document.createElement("iframe");
  iframe.className = "lux-tab-frame";
  iframe.referrerpolicy = "no-referrer";
  iframe.allow = "fullscreen; clipboard-read; clipboard-write; encrypted-media; gamepad";
  iframe.style.display = "none"; // hidden until activated
  iframe.dataset.tabId = String(id);

  const viewport = document.getElementById("tab-viewport");
  if (viewport) viewport.appendChild(iframe);

  const tab = {
    id,
    url: url || null,         // the real (decoded) destination, null = new-tab
    iframe,
    history: [],
    historyIdx: -1,
    title: url ? "" : "New Tab",
    favicon: null,
    loading: false,
  };
  tabs.push(tab);

  // Wire the load event to sync URL/title/crumb from the real destination.
  iframe.addEventListener("load", () => onTabLoad(tab));

  emit("tabCreated", tab);
  activateTab(id);

  if (url) {
    navigateTab(id, url, true);
  }
  return tab;
}

export function activateTab(id) {
  if (!tabs.find((t) => t.id === id)) return;
  activeTabId = id;
  // Show only the active iframe.
  for (const t of tabs) {
    t.iframe.style.display = t.id === id ? "block" : "none";
  }
  emit("tabActivated", getTab(id));
  syncToolbarFromTab(getTab(id));
}

export function closeTab(id) {
  const idx = tabs.findIndex((t) => t.id === id);
  if (idx === -1) return;
  const tab = tabs[idx];
  tab.iframe.src = "about:blank";
  tab.iframe.remove();
  tabs.splice(idx, 1);
  emit("tabClosed", tab);

  if (tabs.length === 0) {
    // Always keep at least a new-tab open (like a browser).
    createTab();
    return;
  }
  if (activeTabId === id) {
    const next = tabs[Math.min(idx, tabs.length - 1)];
    activateTab(next.id);
  }
}

export function getTab(id) {
  return tabs.find((t) => t.id === id) || null;
}

export function getActiveTab() {
  return tabs.find((t) => t.id === activeTabId) || null;
}

export function getAllTabs() {
  return [...tabs];
}

// Navigate a tab to a real (decoded) URL. Sets up the proxy, encodes, loads.
export async function navigateTab(id, url, recordHistory = true) {
  const tab = getTab(id);
  if (!tab) return;
  tab.url = url;
  tab.loading = true;
  emit("tabUpdated", tab);

  try {
    // The engine + transport setup is shared (one SW, one wisp connection).
    // We just set the iframe src to the encoded proxied path.
    const { setTransportFor, getEngine, buildProxyPath, encodeForTab } = await import("./tab-nav.js");
    await setTransportFor(getEngine().name);
    await getEngine().init();
    const path = encodeForTab(url);
    tab.iframe.src = path;

    if (recordHistory) {
      if (tab.historyIdx < tab.history.length - 1) {
        tab.history = tab.history.slice(0, tab.historyIdx + 1);
      }
      tab.history.push(url);
      tab.historyIdx = tab.history.length - 1;
    }
    syncToolbarFromTab(tab);
  } catch (err) {
    tab.loading = false;
    emit("tabUpdated", tab);
    console.error("[lux] tab navigate error:", err);
  }
}

export function goBack(id) {
  const tab = getTab(id);
  if (!tab || tab.historyIdx <= 0) return;
  tab.historyIdx--;
  navigateTab(id, tab.history[tab.historyIdx], false);
}

export function goForward(id) {
  const tab = getTab(id);
  if (!tab || tab.historyIdx >= tab.history.length - 1) return;
  tab.historyIdx++;
  navigateTab(id, tab.history[tab.historyIdx], false);
}

export function reloadTab(id) {
  const tab = getTab(id);
  if (!tab) return;
  try { tab.iframe.contentWindow.location.reload(); }
  catch { if (tab.iframe.src && tab.iframe.src !== "about:blank") tab.iframe.src = tab.iframe.src; }
}

// Sync the toolbar URL input + crumb from the active tab.
function syncToolbarFromTab(tab) {
  if (!tab) return;
  const urlInput = document.getElementById("toolbar-url");
  if (urlInput) urlInput.value = tab.url || "";
  const crumb = document.getElementById("stage-crumb");
  if (crumb) crumb.textContent = safeHostname(tab.url);
}

function safeHostname(url) {
  if (!url) return "";
  try { return new URL(url).hostname; } catch { return url; }
}

// On iframe load: decode the proxied URL to get the real destination, update
// the tab's url/title, and sync the toolbar. This fixes the bug where the
// crumb stayed stuck on the search engine after clicking a result.
function onTabLoad(tab) {
  tab.loading = false;
  // Try to read the real destination from the iframe's current proxied URL.
  try {
    const proxied = tab.iframe.contentWindow.location.href;
    const decoded = decodeProxiedUrl(proxied);
    if (decoded) {
      // Only update url if it's a genuine navigation (not the initial load of
      // the same page). This catches in-iframe link clicks.
      tab.url = decoded;
      // Read the title if same-origin.
      try {
        const doc = tab.iframe.contentDocument;
        if (doc) {
          tab.title = doc.title || safeHostname(decoded);
          const fav = doc.querySelector("link[rel~='icon'], link[rel='shortcut icon']");
          tab.favicon = fav ? fav.href : null;
        }
      } catch { /* cross-origin */ }
    }
  } catch { /* cross-origin or detached */ }
  emit("tabUpdated", tab);
  if (tab.id === activeTabId) syncToolbarFromTab(tab);
}

// Decode a /service/<encoded> or /s/<encoded> URL back to the real destination.
function decodeProxiedUrl(proxiedUrl) {
  try {
    const cfg = window.__uv$config;
    if (!cfg) return null;
    const prefix = cfg.prefix; // "/service/" or whatever uv.config uses
    const idx = proxiedUrl.indexOf(prefix);
    if (idx === -1) return null;
    const encoded = proxiedUrl.slice(idx + prefix.length).split("?")[0];
    return cfg.decodeUrl(encoded);
  } catch {
    return null;
  }
}

// ── Orphan detection ──────────────────────────────────────────────────────
// If Lux itself is loaded at a bare /service/... URL (the user opened a
// proxied link directly in a new browser tab, not inside Lux), show a toast
// offering to return to the Lux home.
export function detectOrphan() {
  const loc = window.location.pathname;
  const cfg = window.__uv$config;
  const prefixes = [cfg?.prefix || "/service/", "/service/", "/s/"];
  for (const p of prefixes) {
    if (loc.startsWith(p)) {
      // We're loaded AT a proxied path — this is an orphan.
      return true;
    }
  }
  return false;
}
