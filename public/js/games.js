// Games / emulator. Self-hosted webretro is loaded in an iframe. ROMs come
// from the user's machine only (no bundled copyrighted games).
//
// Two ROM loading paths:
//   1. File System Access API (showDirectoryPicker) -> the user picks a ROM
//      folder once; Lux remembers the handle in IndexedDB so next time it can
//      re-prompt with a single click and list the ROMs. Supported in
//      Chromium-based browsers.
//   2. Fallback: a plain file input for one ROM at a time (works everywhere).
//
// webretro is loaded from /webretro/ if present, else from the public demo.
// The core defaults to mgba (Game Boy Advance) but auto-selects by extension.

const WEBRETRO_BASE = "/webretro/"; // served if the operator drops webretro in public/

function coreFor(filename) {
  const ext = (filename.split(".").pop() || "").toLowerCase();
  const map = {
    gba: "mgba",
    gb: "mgba",
    gbc: "mgba",
    nes: "fceumm",
    smc: "snes9x",
    sfc: "snes9x",
    n64: "mupen64plus_next",
    sega: "genesis_plus_gx",
    md: "genesis_plus_gx",
    smd: "genesis_plus_gx",
  };
  return map[ext] || "mgba";
}

// Launch a ROM blob/file in the games panel inside an iframe.
export function launchRom(file) {
  const core = coreFor(file.name);
  // webretro accepts a rom via a blob URL passed in the `rom` param, but cross-
  // origin iframe restrictions make that fragile. The robust path is to write
  // the file into the iframe via postMessage after load. For simplicity and
  // broad support we use the data-URL form when small, else blob URL.
  const url = URL.createObjectURL(file);
  const src = `${WEBRETRO_BASE}?core=${core}&rom=${encodeURIComponent(url)}`;
  const gamesBody = document.getElementById("games-body");
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
  back.textContent = "Back to ROM list";
  back.style.marginTop = "10px";
  back.onclick = () => renderGamesHome();
  wrap.appendChild(back);

  gamesBody.appendChild(wrap);
}

// ---- File System Access API: remember a ROM folder ----
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
    // Fallback: trigger the single-file input.
    document.getElementById("rom-input").click();
    return;
  }
  try {
    const handle = await window.showDirectoryPicker();
    await saveHandle(handle);
    await listRomsFromHandle(handle);
  } catch (e) {
    if (e.name !== "AbortError") {
      document.getElementById("rom-list").innerHTML =
        '<div style="color:var(--danger)">Could not open folder: ' + escapeHtml(e.message) + "</div>";
    }
  }
}

async function listRomsFromHandle(handle) {
  const list = document.getElementById("rom-list");
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

export async function renderGamesHome() {
  const body = document.getElementById("games-body");
  body.innerHTML = `
    <div style="color:var(--ink-soft);font-size:14px;line-height:1.6">
      Pick a ROM file to play it in the browser emulator (mGBA and other cores). If your browser supports the File System Access API, your ROM folder choice is remembered for next time.
      <div id="rom-list" style="margin-top:16px"></div>
    </div>`;
  const saved = await loadHandle();
  if (saved) {
    // Verify permission, then list.
    const opts = { mode: "read" };
    if ((await saved.queryPermission(opts)) === "granted" || (await saved.requestPermission(opts)) === "granted") {
      await listRomsFromHandle(saved);
    } else {
      document.getElementById("rom-list").innerHTML =
        '<div style="color:var(--ink-soft)">Folder permission needed. Click "Choose ROM folder" again.</div>';
    }
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
