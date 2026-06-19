// Scramjet recommendation. When the user navigates to a site that Scramjet
// supports better than UV (per the official Scramjet README), show a popup
// suggesting they switch engines. The user can dismiss it or switch.
//
// Supported sites list from https://github.com/MercuryWorkshop/scramjet:
//   Google (partial), Youtube, Spotify (partial), Discord, Reddit,
//   GeForce NOW, now.gg

import { loadSettings, saveSettings } from "./settings.js";
import { getEngine } from "./engine.js";

const SCRAMJET_SITES = [
  { host: "google.com", note: "Google works better with Scramjet (partial support)" },
  { host: "youtube.com", note: "YouTube works better with Scramjet" },
  { host: "youtu.be", note: "YouTube works better with Scramjet" },
  { host: "spotify.com", note: "Spotify works better with Scramjet (partial support)" },
  { host: "discord.com", note: "Discord works better with Scramjet" },
  { host: "reddit.com", note: "Reddit works better with Scramjet" },
  { host: "geforcenow.com", note: "GeForce NOW works better with Scramjet" },
  { host: "now.gg", note: "now.gg works better with Scramjet" },
];

// Sites the user has dismissed the popup for (don't nag).
function getDismissed() {
  try {
    return JSON.parse(localStorage.getItem("lux.sj-dismissed") || "[]");
  } catch {
    return [];
  }
}

function addDismissed(host) {
  const list = getDismissed();
  if (!list.includes(host)) {
    list.push(host);
    localStorage.setItem("lux.sj-dismissed", JSON.stringify(list));
  }
}

// Check if a URL matches a Scramjet-supported site.
export function checkScramjetRecommendation(url) {
  const settings = loadSettings();
  // Only recommend if currently on UV.
  if (settings.engine === "scramjet") return null;
  if (!url) return null;
  let hostname;
  try { hostname = new URL(url).hostname.toLowerCase(); } catch { return null; }

  const dismissed = getDismissed();
  for (const site of SCRAMJET_SITES) {
    if (hostname === site.host || hostname.endsWith("." + site.host)) {
      if (dismissed.includes(site.host)) continue;
      return site;
    }
  }
  return null;
}

// Show the recommendation popup. Returns true if shown.
export function maybeShowScramjetPopup(url) {
  const rec = checkScramjetRecommendation(url);
  if (!rec) return false;

  // Don't show more than once per page load.
  if (window.__sjPopupShown) return false;
  window.__sjPopupShown = true;

  const popup = document.createElement("div");
  popup.style.cssText =
    "position:fixed;bottom:80px;left:50%;transform:translateX(-50%);z-index:100;" +
    "background:var(--ink);color:var(--bg);padding:16px 20px;border-radius:12px;" +
    "font-size:13px;max-width:380px;box-shadow:0 8px 32px rgba(0,0,0,0.3);" +
    "display:flex;flex-direction:column;gap:10px;animation:slideUp 0.3s ease";

  popup.innerHTML = `
    <div style="font-weight:600;font-size:14px">Having trouble? Try Scramjet</div>
    <div style="opacity:0.8">${rec.note}. Scramjet is a different proxy engine that handles this site better.</div>
    <div style="display:flex;gap:8px;margin-top:4px">
      <button id="sj-switch" style="background:var(--bg);color:var(--ink);border:0;border-radius:6px;padding:6px 14px;cursor:pointer;font-size:12px;font-weight:600">Switch to Scramjet</button>
      <button id="sj-dismiss" style="background:transparent;color:var(--bg);border:1px solid rgba(255,255,255,0.3);border-radius:6px;padding:6px 14px;cursor:pointer;font-size:12px">Not now</button>
    </div>`;

  document.body.appendChild(popup);

  popup.querySelector("#sj-switch").onclick = async () => {
    saveSettings({ engine: "scramjet" });
    popup.remove();
    // Reload to trigger early Scramjet SW registration.
    window.location.reload();
  };

  popup.querySelector("#sj-dismiss").onclick = () => {
    addDismissed(rec.host);
    popup.remove();
  };

  // Auto-dismiss after 15s.
  setTimeout(() => { if (popup.parentElement) popup.remove(); }, 15000);
  return true;
}
