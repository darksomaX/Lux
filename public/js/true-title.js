// True title/favicon. When proxied, the browser tab shows "Lux" by default.
// This module reads the real title and favicon from the proxied iframe (when
// same-origin access works) and applies them to Lux's tab, so the tab looks
// like the site you're actually visiting.
//
// Exceptions: a user-configurable list of hostnames whose real title/icon
// should NEVER be shown (the tab stays "Lux" for those). The user can also
// upload a custom .ico/.png for any hostname.
//
// Limitation: reading the proxied iframe's contentDocument only works when
// the SW serves it same-origin (which UV does). For cross-origin frames we
// fall back to "Lux".

import { loadSettings, saveSettings } from "./settings.js";

let pollTimer = null;

export function startTitleWatch(iframeEl) {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = setInterval(() => updateTitleFromFrame(iframeEl), 2500);
  if (pollTimer.unref) pollTimer.unref();
}

export function stopTitleWatch() {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = null;
  // Reset to Lux when the stage closes.
  document.title = "Lux";
}

function getExceptions() {
  try {
    const raw = localStorage.getItem("lux.settings.v1");
    if (raw) return JSON.parse(raw).titleExceptions || [];
  } catch {}
  return [];
}

function getCustomIcons() {
  try {
    const raw = localStorage.getItem("lux.settings.v1");
    if (raw) return JSON.parse(raw).customIcons || {};
  } catch {}
  return {};
}

function updateTitleFromFrame(iframeEl) {
  if (!iframeEl) return;
  try {
    const doc = iframeEl.contentDocument;
    if (!doc) return; // cross-origin; can't read
    const host = safeHostname(iframeEl.src);
    if (!host) return;
    const exceptions = getExceptions();
    if (exceptions.includes(host)) return; // user said never show this one

    // Title
    const realTitle = doc.title || "";
    if (realTitle) document.title = realTitle;

    // Favicon: prefer a custom upload, else the page's own favicon.
    const customs = getCustomIcons();
    if (customs[host]) {
      setFavicon(customs[host]);
    } else {
      const fav = doc.querySelector("link[rel~='icon'], link[rel='shortcut icon']");
      if (fav && fav.href) setFavicon(fav.href);
    }
  } catch {
    // cross-origin or detached; ignore
  }
}

function setFavicon(href) {
  let link = document.querySelector("link[rel~='icon']");
  if (!link) {
    link = document.createElement("link");
    link.rel = "icon";
    document.head.appendChild(link);
  }
  link.href = href;
}

function safeHostname(url) {
  try {
    // UV proxied URLs are /service/<encoded>; decode to get the real host.
    const cfg = window.__uv$config;
    if (cfg && url.includes(cfg.prefix)) {
      const encoded = url.slice(url.indexOf(cfg.prefix) + cfg.prefix.length);
      const decoded = cfg.decodeUrl(encoded);
      return new URL(decoded).hostname;
    }
  } catch {}
  try { return new URL(url).hostname; } catch { return ""; }
}

// Add a hostname to the never-show list.
export function addException(hostname) {
  const s = loadSettings();
  const list = s.titleExceptions || [];
  if (!list.includes(hostname)) list.push(hostname);
  saveSettings({ titleExceptions: list });
}

// Upload a custom icon (as a data URL) for a hostname.
export function setCustomIcon(hostname, dataUrl) {
  const s = loadSettings();
  const icons = s.customIcons || {};
  icons[hostname] = dataUrl;
  saveSettings({ customIcons });
}
