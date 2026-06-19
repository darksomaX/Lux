// Lux settings. Everything user-configurable lives here, persisted in
// localStorage under the "lux." namespace. Defaults are chosen so the app
// is usable on first load (no setup required) and secure by default
// (lock mode on, cold start requires a phrase).

const KEY = "lux.settings.v1";

export const DEFAULTS = {
  // Which interception engine to use: "uv" or "scramjet".
  engine: "uv",

  // Which search engine queries go to.
  searchEngine: "startpage",

  // How the proxied URL path looks in the address bar.
  //   "encoded"  -> /s/<xor>                (UV default, obfuscated, prefix /s/)
  //   "plain"    -> /s/https://site         (readable, for debugging)
  //   "none"     -> no proxy path shown; uses iframe chains only
  // The "math" disguise was removed — it added complexity for little benefit.
  // The prefix is set in uv.config.js (built as /s/ by build-uv.mjs).
  urlScheme: "encoded",
  customPrefix: "/s/",

  // Appearance.
  theme: "light",            // "light" | "dark"
  background: "dots",        // "dots" | "stars" | "none"
  showDock: true,            // macOS-style tools dock
  fullscreenMode: "off",     // "off" | "page" | "full"
  windowChrome: "macos",     // "macos" | "windows"

  // Lock / panic.
  lockEnabled: true,         // require phrase on cold start
  lockPhrase: "a",           // minimal default; user changes it
  lockPassword: "",          // new create-password flow (overrides lockPhrase)
  lockOnIdle: true,          // re-lock after idle
  lockIdleMinutes: 5,
  lockOnExit: false,         // re-lock when all tabs close

  // Hardening.
  blockDevtools: true,       // best-effort devtools disruption (disable to debug)
  panicKey: "Backquote",     // backtick
  panicDecoy: "https://classroom.google.com/",

  // Title/favicon.
  trueTitle: true,           // show the proxied site's real title + favicon
  titleExceptions: [],       // hostnames whose real title should never show
  customIcons: {},           // hostname -> data URL of a custom favicon

  // USB killswitch (Chromium only; File System Access API).
  usbKillswitch: false,      // trip + wipe if the USB folder becomes unreadable

  // Extensions.
  clearUrls: true,           // strip tracking params from links
  adBlock: true,             // lightweight element/hostname blocking
  eventHandling: true,       // allow sites' event listeners (disable = freeze overlays)
  googleOptOut: true,        // set Google opt-out cookie
  killSwitch: true,          // halt traffic if the network changes until verified

  // Privacy display.
  showIpBadge: true,         // show prev vs current apparent IP

  // Taskbar.
  taskbarHide: false,        // auto-hide taskbar on hover

  // Volume.
  masterVolume: 1.0,         // 0.0 – 1.0

  // DevTools.
  devtools: false,           // proxied request viewer

  // Cloak.
  antiClose: false,
};

let cache = null;

export function loadSettings() {
  if (cache) return cache;
  try {
    const raw = localStorage.getItem(KEY);
    cache = raw ? { ...DEFAULTS, ...JSON.parse(raw) } : { ...DEFAULTS };
  } catch {
    cache = { ...DEFAULTS };
  }
  return cache;
}

export function saveSettings(partial) {
  const next = { ...loadSettings(), ...partial };
  cache = next;
  localStorage.setItem(KEY, JSON.stringify(next));
  // Let other modules react.
  window.dispatchEvent(new CustomEvent("lux:settings", { detail: next }));
  return next;
}

export function resetSettings() {
  cache = { ...DEFAULTS };
  localStorage.removeItem(KEY);
  window.dispatchEvent(new CustomEvent("lux:settings", { detail: cache }));
  return cache;
}
