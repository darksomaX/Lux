// TV / Live Tab panel. App-dashboard style (inspired by tinf0il.site/tv).
// Shows app cards (YouTube, Discord, etc.) in a grid that load proxied via
// /api/tv-proxy. URL input for any custom site.

const TV_CUSTOM_KEY = "lux.tv.customPicks";
const $ = (id) => document.getElementById(id);

// Default app catalog — proxied-friendly popular sites
const DEFAULT_APPS = [
  { label: "YouTube", url: "https://youtube.com", icon: "YT" },
  { label: "Twitch", url: "https://twitch.tv", icon: "TW" },
  { label: "Discord", url: "https://discord.com/app", icon: "DC" },
  { label: "Reddit", url: "https://reddit.com", icon: "RD" },
  { label: "TikTok", url: "https://tiktok.com", icon: "TT" },
  { label: "Spotify", url: "https://open.spotify.com", icon: "SP" },
  { label: "GeForce NOW", url: "https://play.geforcenow.com", icon: "GN" },
  { label: "Chess.com", url: "https://chess.com", icon: "CH" },
  { label: "VS Code", url: "https://vscode.dev", icon: "VS" },
  { label: "Google", url: "https://google.com", icon: "GO" },
  { label: "DuckDuckGo", url: "https://duckduckgo.com", icon: "DD" },
  { label: "Wikipedia", url: "https://en.wikipedia.org", icon: "WI" },
];

let currentFrame = null;

export async function initTV() {
  const home = $("tv-home");
  const player = $("tv-player");
  const frame = $("tv-frame");
  const urlInput = $("tv-url");
  const loadBtn = $("tv-load");
  const backBtn = $("tv-back");
  const appGrid = $("tv-app-grid");

  if (!home || !player || !appGrid) return;

  // Render app grid: default apps + any custom ones from localStorage
  renderAppGrid(appGrid);

  // Load URL from input
  const doLoad = (val) => {
    const input = val || urlInput.value.trim();
    if (input) loadUrl(input);
  };
  loadBtn.onclick = () => doLoad();
  urlInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") doLoad();
  });

  // Back button — returns to grid
  backBtn.onclick = () => {
    player.style.display = "none";
    home.style.display = "flex";
    if (currentFrame) { currentFrame.src = "about:blank"; currentFrame = null; }
  };

  // Focus input when panel opens
  const panel = $("panel-tv");
  if (panel) {
    const obs = new MutationObserver(() => {
      if (panel.classList.contains("open")) setTimeout(() => urlInput.focus(), 100);
    });
    obs.observe(panel, { attributes: true, attributeFilter: ["class"] });
  }
}

function renderAppGrid(container) {
  const apps = getApps();
  container.innerHTML = "";
  for (const a of apps) {
    const card = document.createElement("button");
    card.className = "tv-app-card";
    card.innerHTML = `<span class="tv-app-icon">${escapeHtml(a.icon)}</span><span class="tv-app-label">${escapeHtml(a.label)}</span>`;
    card.onclick = () => loadUrl(a.url);
    container.appendChild(card);
  }
}

function getApps() {
  let custom = [];
  try {
    const raw = localStorage.getItem(TV_CUSTOM_KEY);
    if (raw) custom = JSON.parse(raw);
  } catch {}
  return [...DEFAULT_APPS, ...custom];
}

async function loadUrl(input) {
  const home = $("tv-home");
  const player = $("tv-player");
  const frame = $("tv-frame");
  if (!input) return;

  let url = input.trim();
  if (!url.startsWith("http://") && !url.startsWith("https://")) url = "https://" + url;

  home.style.display = "none";
  player.style.display = "flex";
  currentFrame = frame;
  frame.src = "/api/tv-proxy?url=" + encodeURIComponent(url);
}

// Add a custom app card
export function addCustomApp(label, url, icon) {
  const apps = getApps();
  apps.push({ label, url: url.startsWith("http") ? url : "https://" + url, icon: icon || label.slice(0, 2).toUpperCase() });
  try { localStorage.setItem(TV_CUSTOM_KEY, JSON.stringify(apps.filter(a => !DEFAULT_APPS.find(d => d.url === a.url)))); } catch {}
  const grid = $("tv-app-grid");
  if (grid) renderAppGrid(grid);
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[c]);
}
