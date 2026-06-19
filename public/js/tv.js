// TV / Live Tab panel. Lets users browse streaming sites through the proxy.
// Quick picks are curated streaming-friendly URLs saved in localStorage.

const TV_QUICK_PICKS_KEY = "lux.tv.quickPicks";
const DEFAULT_PICKS = [
  { label: "YouTube", url: "https://youtube.com" },
  { label: "Twitch", url: "https://twitch.tv" },
  { label: "Dailymotion", url: "https://dailymotion.com" },
  { label: "Vimeo", url: "https://vimeo.com" },
  { label: "Odysee", url: "https://odysee.com" },
  { label: "PeerTube", url: "https://joinpeertube.org" },
];

const $ = (id) => document.getElementById(id);

let currentFrame = null;
let isActive = false;

function getQuickPicks() {
  try {
    const raw = localStorage.getItem(TV_QUICK_PICKS_KEY);
    return raw ? JSON.parse(raw) : DEFAULT_PICKS;
  } catch { return DEFAULT_PICKS; }
}

function saveQuickPicks(picks) {
  localStorage.setItem(TV_QUICK_PICKS_KEY, JSON.stringify(picks));
}

export async function initTV() {
  const home = $("tv-home");
  const player = $("tv-player");
  const frame = $("tv-frame");
  const urlInput = $("tv-url");
  const loadBtn = $("tv-load");
  const backBtn = $("tv-back");
  const quickPicks = $("tv-quick-picks");

  if (!home || !player) return;

  // Render quick picks
  const picks = getQuickPicks();
  quickPicks.innerHTML = "";
  for (const p of picks) {
    const btn = document.createElement("button");
    btn.className = "btn";
    btn.textContent = p.label;
    btn.onclick = () => loadUrl(p.url);
    quickPicks.appendChild(btn);
  }

  // Load URL from input
  const doLoad = () => {
    const val = urlInput.value.trim();
    if (val) loadUrl(val);
  };
  loadBtn.onclick = doLoad;
  urlInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") doLoad();
  });

  // Back button
  backBtn.onclick = () => {
    player.style.display = "none";
    home.style.display = "block";
    if (currentFrame) { currentFrame.src = "about:blank"; currentFrame = null; }
  };

  // Focus input when panel opens
  const panel = document.getElementById("panel-tv");
  if (panel) {
    const observer = new MutationObserver(() => {
      if (panel.classList.contains("open")) {
        setTimeout(() => urlInput.focus(), 100);
      }
    });
    observer.observe(panel, { attributes: true, attributeFilter: ["class"] });
  }
}

async function loadUrl(input) {
  const home = $("tv-home");
  const player = $("tv-player");
  const frame = $("tv-frame");

  if (!input) return;
  let url = input.trim();
  if (!url.startsWith("http://") && !url.startsWith("https://")) {
    url = "https://" + url;
  }

  home.style.display = "none";
  player.style.display = "flex";
  currentFrame = frame;
  frame.src = "/api/tv-proxy?url=" + encodeURIComponent(url);
}

// Add custom quick pick
export function addQuickPick(label, url) {
  const picks = getQuickPicks();
  picks.push({ label, url });
  saveQuickPicks(picks);
  initTV(); // Re-render
}
