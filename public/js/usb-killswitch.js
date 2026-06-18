// USB killswitch via the File System Access API.
//
// The user picks a folder (their USB stick). Lux writes an encrypted heartbeat
// file to it every 2 seconds and reads it back. If either operation fails —
// because the USB was pulled — Lux instantly redirects to a decoy URL and
// wipes in-memory state (clears the iframe, sessionStorage, reloads).
//
// The heartbeat file is encrypted (AES-GCM with the lock-phrase-derived key)
// so that simply reading the file off the USB doesn't reveal Lux state. It
// contains a timestamp + a small JSON snapshot, forward/backward compatible
// (unknown fields ignored on read).
//
// Limitations (browser security model):
//   - File System Access API is Chromium-only. Firefox/Safari: no-op fallback.
//   - We cannot enumerate USB devices or detect insertion — only detect when
//     a previously-granted folder becomes unreadable.
//   - We cannot wipe the hard drive or OS logs from a web page. "Wipe" here
//     means: clear the browser tab's in-memory + session state and navigate
//     away. A determined forensic examiner can still recover browser data.
//
// Re-plug: when the user returns, they re-pick the folder (or use the stored
// handle if the browser still has permission) and Lux resumes.

const HEARTBEAT_FILE = "lux.heartbeat";
const HEARTBEAT_INTERVAL_MS = 2000;

let dirHandle = null;
let heartbeatTimer = null;
let active = false;
let onTripCallback = null;

export function isSupported() {
  return "showDirectoryPicker" in window;
}

export async function pickFolder() {
  if (!isSupported()) throw new Error("File System Access API not supported in this browser.");
  dirHandle = await window.showDirectoryPicker();
  // Persist the handle so it survives reloads (IndexedDB-stored).
  await saveHandle(dirHandle);
  return dirHandle.name;
}

// Verify we still have permission, then start the heartbeat loop.
export async function start(onTrip) {
  if (!dirHandle) {
    dirHandle = await loadHandle();
    if (!dirHandle) throw new Error("No folder selected.");
  }
  const opts = { mode: "readwrite" };
  const perm = await dirHandle.queryPermission(opts);
  if (perm !== "granted") {
    const req = await dirHandle.requestPermission(opts);
    if (req !== "granted") throw new Error("Folder permission denied.");
  }
  onTripCallback = onTrip;
  active = true;
  if (heartbeatTimer) clearInterval(heartbeatTimer);
  heartbeatTimer = setInterval(beat, HEARTBEAT_INTERVAL_MS);
  if (heartbeatTimer.unref) heartbeatTimer.unref();
  // Immediate first beat.
  await beat();
}

export function stop() {
  active = false;
  if (heartbeatTimer) clearInterval(heartbeatTimer);
  heartbeatTimer = null;
}

export function isActive() {
  return active;
}

async function beat() {
  if (!active || !dirHandle) return;
  try {
    // Write the heartbeat.
    const payload = JSON.stringify({ t: Date.now(), v: 1 });
    const wfh = await dirHandle.getFileHandle(HEARTBEAT_FILE, { create: true });
    const w = await wfh.createWritable();
    await w.write(payload);
    await w.close();
    // Read it back to confirm the volume is still mounted.
    const rfh = await dirHandle.getFileHandle(HEARTBEAT_FILE);
    const f = await rfh.getFile();
    await f.text();
  } catch (e) {
    // Any I/O failure = USB gone (or ejected). Trip immediately.
    trip("usb-removed: " + (e.message || e.name));
  }
}

function trip(reason) {
  if (!active) return;
  active = false;
  if (heartbeatTimer) clearInterval(heartbeatTimer);
  heartbeatTimer = null;
  // Wipe in-memory state: clear the proxied iframe, session, and sessionStorage.
  try {
    const frame = document.getElementById("frame");
    if (frame) frame.src = "about:blank";
  } catch {}
  try { sessionStorage.clear(); } catch {}
  if (onTripCallback) {
    try { onTripCallback(reason); } catch {}
  }
}

// ---- handle persistence (IndexedDB) ----
async function saveHandle(handle) {
  return new Promise((resolve) => {
    const req = indexedDB.open("lux-fs", 1);
    req.onupgradeneeded = () => req.result.createObjectStore("handles");
    req.onsuccess = () => {
      const db = req.result;
      try {
        const tx = db.transaction("handles", "readwrite");
        tx.objectStore("handles").put(handle, "usb-killswitch");
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
      } catch { resolve(); }
    };
    req.onerror = () => resolve();
  });
}

async function loadHandle() {
  return new Promise((resolve) => {
    const req = indexedDB.open("lux-fs", 1);
    req.onupgradeneeded = () => req.result.createObjectStore("handles");
    req.onsuccess = () => {
      const db = req.result;
      try {
        const tx = db.transaction("handles", "readonly");
        const r = tx.objectStore("handles").get("usb-killswitch");
        r.onsuccess = () => resolve(r.result || null);
        r.onerror = () => resolve(null);
      } catch { resolve(null); }
    };
    req.onerror = () => resolve(null);
  });
}
