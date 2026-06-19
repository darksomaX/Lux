// Games / emulator. Enhanced: shows category tabs with curated web games,
// ROM folder picker, and 3kh0 embed option.
//
// Categories:
//   My ROMs — local ROM folder picker + webretro emulator
//   Web Games — curated HTML5 game catalog loaded from /data/games-catalog.js
//   Featured — 3kh0 embed or other featured content

const WEBRETRO_BASE = "/webretro/";
const CATEGORIES = ["My ROMs", "Web Games"];

const $ = (id) => document.getElementById(id);

let gamesCatalog = [];

function coreFor(filename) {
  const ext = (filename.split(".").pop() || "").toLowerCase();
  const map = {
    gba: "mgba", gb: "mgba", gbc: "mgba", nes: "fceumm",
    smc: "snes9x", sfc: "snes9x", n64: "mupen64plus_next",
    sega: "genesis_plus_gx", md: "genesis_plus_gx", smd: "genesis_plus_gx",
  };
  return map[ext] || "mgba";
}

// ---- ROM loading (existing) ----

export function launchRom(file) {
  const core = coreFor(file.name);
  const url = URL.createObjectURL(file);
  const src = `${WEBRETRO_BASE}?core=${core}&rom=${encodeURIComponent(url)}`;
  const gamesBody = $("games-body");
  gamesBody.innerHTML = "";
  const wrap = document.createElement("div");
  wrap.style.cssText = "height:70vh;display:flex;flex-direction:column";
  const ifr = document.createElement("iframe");
  ifr.src = src;
  ifr.style.cssText = "flex:1;width:100%;border:1px solid var(--line);border-radius:10px;background:#000";
  ifr.allow = "fullscreen; gamepad; autoplay; cross-origin-isolated";
  ifr.setAttribute("allowfullscreen", "");
  wrap.appendChild(ifr);
  const back = document.createElement("button");
  back.className = "btn";
  back.textContent = "Back to games";
  back.style.marginTop = "10px";
  back.onclick = () => renderGamesHome();
  wrap.appendChild(back);
  gamesBody.appendChild(wrap);
}

// ---- File System Access API ----
const FS_DB = "lux-fs";
const FS_STORE = "handles";
function fsOpen() {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(FS_DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(FS_STORE);
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
async function saveHandle(handle) {
  const db = await fsOpen();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(FS_STORE, "readwrite");
    tx.objectStore(FS_STORE).put(handle, "rom-folder");
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}
async function loadHandle() {
  if (!("showDirectoryPicker" in window)) return null;
  const db = await fsOpen();
  return new Promise((resolve) => {
    const tx = db.transaction(FS_STORE, "readonly");
    const req = tx.objectStore(FS_STORE).get("rom-folder");
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => resolve(null);
  });
}

export async function pickRomFolder() {
  if (!("showDirectoryPicker" in window)) {
    $("rom-input").click();
    return;
  }
  try {
    const handle = await window.showDirectoryPicker();
    await saveHandle(handle);
    await listRomsFromHandle(handle);
  } catch (e) {
    if (e.name !== "AbortError") {
      $("rom-list").innerHTML =
        '<div style="color:var(--danger)">Could not open folder: ' + escapeHtml(e.message) + "</div>";
    }
  }
}

async function listRomsFromHandle(handle) {
  const list = $("rom-list");
  if (!list) return;
  list.innerHTML = '<div style="color:var(--ink-soft)">Reading folder...</div>';
  const roms = [];
  for await (const entry of handle.values()) {
    if (entry.kind === "file") {
      const ext = entry.name.split(".").pop().toLowerCase();
      if (["gba", "gb", "gbc", "nes", "smc", "sfc", "n64", "md", "smd", "zip"].includes(ext)) {
        roms.push(entry);
      }
    }
  }
  if (!roms.length) {
    list.innerHTML = '<div style="color:var(--ink-soft)">No ROMs found in this folder.</div>';
    return;
  }
  list.innerHTML = '<div style="font-weight:600;margin-bottom:8px">Your ROMs:</div>';
  for (const r of roms) {
    const b = document.createElement("button");
    b.className = "btn";
    b.style.cssText = "margin:4px;display:block";
    b.textContent = r.name;
    b.onclick = async () => {
      const file = await r.getFile();
      launchRom(file);
    };
    list.appendChild(b);
  }
}

// ---- Category tabs ----

export function renderCategoryTabs() {
  const body = $("games-body");
  if (!body) return;

  // Category tab bar
  let tabHtml = '<div id="games-tabs" style="display:flex;gap:4px;margin-bottom:12px;border-bottom:1px solid var(--line);padding-bottom:8px">';
  for (const c of CATEGORIES) {
    tabHtml += `<button class="btn games-tab" data-cat="${c}" style="font-size:13px">${c}</button>`;
  }
  tabHtml += '</div>';
  tabHtml += '<div id="games-content"></div>';

  body.innerHTML = tabHtml;

  // Bind tab clicks
  body.querySelectorAll(".games-tab").forEach((tab) => {
    tab.onclick = () => {
      body.querySelectorAll(".games-tab").forEach((t) => t.style.background = "var(--bg)");
      tab.style.background = "var(--line)";
      renderCategory(tab.dataset.cat);
    };
  });

  // Activate first tab
  const first = body.querySelector(".games-tab");
  if (first) {
    first.style.background = "var(--line)";
    renderCategory(first.dataset.cat);
  }
}

async function renderCategory(cat) {
  const content = $("games-content");
  if (!content) return;

  if (cat === "My ROMs") {
    content.innerHTML = `
      <div style="margin-bottom:12px">
        <button class="btn" id="rom-folder-btn">Choose ROM folder</button>
        <input type="file" id="rom-input" accept=".gba,.gbc,.gb,.nes,.sfc,.smc,.snes,.zip" style="display:none">
        <button class="btn" id="rom-file-btn" style="margin-left:6px">Pick a ROM file</button>
      </div>
      <div id="rom-list" style="margin-top:8px">
        <div style="color:var(--ink-soft);font-size:13px">Select a folder or file to play.</div>
      </div>`;

    $("rom-folder-btn").onclick = pickRomFolder;
    $("rom-file-btn").onclick = () => $("rom-input").click();
    $("rom-input").onchange = async (e) => {
      const file = e.target.files?.[0];
      if (file) launchRom(file);
    };

    // Try to restore saved folder
    const saved = await loadHandle();
    if (saved) {
      const opts = { mode: "read" };
      if ((await saved.queryPermission(opts)) === "granted" || (await saved.requestPermission(opts)) === "granted") {
        await listRomsFromHandle(saved);
      }
    }
  } else if (cat === "Web Games") {
    // Load catalog if needed
    if (!gamesCatalog.length) {
      try {
        const mod = await import("/data/games-catalog.js");
        gamesCatalog = mod.default || [];
      } catch {
        gamesCatalog = window.__luxGamesCatalog || [];
      }
    }
    renderWebGames(content);
  }
}

function renderWebGames(container) {
  if (!gamesCatalog.length) {
    container.innerHTML = '<div style="color:var(--ink-soft);font-size:13px">No web games loaded.</div>';
    return;
  }

  // Group by category
  const groups = {};
  for (const g of gamesCatalog) {
    const cat = g.category || "Other";
    if (!groups[cat]) groups[cat] = [];
    groups[cat].push(g);
  }

  let html = "";
  for (const [cat, games] of Object.entries(groups)) {
    html += `<div style="margin-bottom:16px"><div style="font-weight:600;font-size:13px;margin-bottom:8px;color:var(--ink-soft)">${cat}</div>`;
    html += '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:8px">';
    for (const g of games) {
      html += `<div class="game-card" data-url="${escapeHtml(g.url)}" style="padding:12px;border:1px solid var(--line);border-radius:10px;cursor:pointer;transition:background 0.1s" title="${escapeHtml(g.description || "")}">
        <div style="font-weight:600;font-size:13px">${escapeHtml(g.title)}</div>
        <div style="font-size:11px;color:var(--ink-soft);margin-top:4px">${escapeHtml(g.description || "")}</div>
      </div>`;
    }
    html += "</div></div>";
  }
  container.innerHTML = html;

  // Click to launch
  container.querySelectorAll(".game-card").forEach((card) => {
    card.addEventListener("mouseenter", () => card.style.background = "var(--line)");
    card.addEventListener("mouseleave", () => card.style.background = "");
    card.onclick = () => {
      const url = card.dataset.url;
      if (url) launchGameUrl(url);
    };
  });
}

function launchGameUrl(url) {
  // Open as a new browser tab (uses current engine)
  const { createTab, navigateTab } = window.__luxTabs || {};
  if (createTab && navigateTab) {
    const tab = createTab();
    navigateTab(tab.id, url, true);
  } else {
    window.open("/api/tv-proxy?url=" + encodeURIComponent(url), "_blank");
  }
}

// ---- Render home ----

export async function renderGamesHome() {
  renderCategoryTabs();
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
