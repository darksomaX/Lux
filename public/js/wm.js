// Window manager for Lux desktop shell.
// Creates absolutely-positioned windows with title bars, drag, resize, focus.
// The taskbar stays — clicking an app opens/focuses its window.

let zCounter = 100;
const windows = {};
let focusOrder = [];
let dragState = null; // { id, startX, startY, elX, elY }
let resizeState = null; // { id, startX, startY, elW, elH, edge }

const $ = (id) => document.getElementById(id);

// ── Window Creation ───────────────────────────────────────────────────────

export function createWindow(opts = {}) {
  const {
    id = "win-" + Date.now(),
    title = "Window",
    width = 600,
    height = 400,
    x = 100 + Math.random() * 100,
    y = 60 + Math.random() * 80,
    content = "",
    onClose = null,
  } = opts;

  // Remove existing window with same id.
  const existing = $(id);
  if (existing) existing.remove();

  const win = document.createElement("div");
  win.id = id;
  win.className = "lux-window";
  win.style.cssText =
    "position:fixed;z-index:" + (++zCounter) + ";width:" + width + "px;height:" + height + "px;" +
    "left:" + x + "px;top:" + y + "px;" +
    "background:var(--bg);border:1px solid var(--line);border-radius:10px;" +
    "display:flex;flex-direction:column;box-shadow:0 8px 32px rgba(0,0,0,0.15);" +
    "overflow:hidden;min-width:200px;min-height:120px;";

  win.addEventListener("mousedown", () => focusWindow(id));

  // Title bar.
  const bar = document.createElement("div");
  bar.className = "lux-win-bar";
  bar.style.cssText =
    "height:36px;display:flex;align-items:center;padding:0 10px;" +
    "border-bottom:1px solid var(--line);cursor:grab;flex-shrink:0;user-select:none;";

  // Window chrome buttons (macOS traffic light).
  const chrome = document.createElement("div");
  chrome.className = "wc-group";
  chrome.style.cssText = "display:flex;gap:6px;margin-right:10px;";
  const makeDot = (color, action) => {
    const d = document.createElement("div");
    d.className = "wc-dot";
    d.style.cssText =
      "width:12px;height:12px;border-radius:50%;background:" + color + ";" +
      "cursor:pointer;transition:filter 0.1s;";
    d.addEventListener("click", (e) => { e.stopPropagation(); action(); });
    d.addEventListener("mouseenter", () => { d.style.filter = "brightness(0.8)"; });
    d.addEventListener("mouseleave", () => { d.style.filter = ""; });
    return d;
  };
  chrome.appendChild(makeDot("#ff5f57", () => closeWindow(id)));    // close
  chrome.appendChild(makeDot("#febc2e", () => minimizeWindow(id))); // minimize
  chrome.appendChild(makeDot("#28c840", () => maximizeWindow(id))); // maximize

  const titleEl = document.createElement("span");
  titleEl.className = "lux-win-title";
  titleEl.style.cssText = "flex:1;font-size:13px;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;";
  titleEl.textContent = title;

  bar.appendChild(chrome);
  bar.appendChild(titleEl);
  win.appendChild(bar);

  // Content area.
  const body = document.createElement("div");
  body.className = "lux-win-body";
  body.style.cssText = "flex:1;overflow:auto;padding:12px;";
  if (typeof content === "string") body.innerHTML = content;
  else if (content instanceof HTMLElement) body.appendChild(content);
  win.appendChild(body);

  // Resize handle (bottom-right corner).
  const resizer = document.createElement("div");
  resizer.className = "lux-win-resizer";
  resizer.style.cssText =
    "position:absolute;bottom:0;right:0;width:14px;height:14px;" +
    "cursor:nwse-resize;background:linear-gradient(135deg,transparent 50%,var(--line) 50%);";
  win.appendChild(resizer);

  document.body.appendChild(win);
  windows[id] = { win, opts, body, bar, titleEl, minimized: false, prevRect: null };

  // Drag: title bar (but not on chrome buttons).
  bar.addEventListener("mousedown", (e) => {
    if (e.target.closest(".wc-dot")) return;
    startDrag(id, e);
  });

  // Double-click title bar to maximize/restore.
  bar.addEventListener("dblclick", (e) => {
    if (e.target.closest(".wc-dot")) return;
    maximizeWindow(id);
  });

  // Resize: corner.
  resizer.addEventListener("mousedown", (e) => {
    e.stopPropagation();
    startResize(id, e, "se");
  });

  focusWindow(id);
  return id;
}

// ── Focus ─────────────────────────────────────────────────────────────────

export function focusWindow(id) {
  const w = windows[id];
  if (!w) return;
  w.win.style.zIndex = ++zCounter;
  // Update focus order.
  focusOrder = focusOrder.filter((fid) => fid !== id);
  focusOrder.push(id);
}

// ── Close ─────────────────────────────────────────────────────────────────

export function closeWindow(id) {
  const w = windows[id];
  if (!w) return;
  if (w.opts.onClose) w.opts.onClose();
  w.win.remove();
  delete windows[id];
  focusOrder = focusOrder.filter((fid) => fid !== id);
}

// ── Minimize ──────────────────────────────────────────────────────────────

export function minimizeWindow(id) {
  const w = windows[id];
  if (!w) return;
  if (w.minimized) {
    // Restore.
    w.win.style.display = "flex";
    if (w.prevRect) {
      w.win.style.left = w.prevRect.left + "px";
      w.win.style.top = w.prevRect.top + "px";
      w.win.style.width = w.prevRect.width + "px";
      w.win.style.height = w.prevRect.height + "px";
    }
    w.minimized = false;
  } else {
    // Save rect and hide.
    const r = w.win.getBoundingClientRect();
    w.prevRect = { left: r.left, top: r.top, width: r.width, height: r.height };
    w.win.style.display = "none";
    w.minimized = true;
  }
}

// ── Maximize ──────────────────────────────────────────────────────────────

export function maximizeWindow(id) {
  const w = windows[id];
  if (!w) return;
  if (w.maximized) {
    // Restore.
    if (w.prevRect) {
      w.win.style.left = w.prevRect.left + "px";
      w.win.style.top = w.prevRect.top + "px";
      w.win.style.width = w.prevRect.width + "px";
      w.win.style.height = w.prevRect.height + "px";
    }
    w.maximized = false;
  } else {
    const r = w.win.getBoundingClientRect();
    w.prevRect = { left: r.left, top: r.top, width: r.width, height: r.height };
    w.win.style.left = "0";
    w.win.style.top = "0";
    w.win.style.width = "100%";
    w.win.style.height = "calc(100% - var(--taskbar-h))";
    w.win.style.height = "calc(100% - 48px)";
    w.maximized = true;
  }
}

// ── Drag ──────────────────────────────────────────────────────────────────

function startDrag(id, e) {
  const w = windows[id];
  if (!w) return;
  const r = w.win.getBoundingClientRect();
  dragState = { id, startX: e.clientX, startY: e.clientY, elX: r.left, elY: r.top };
  document.addEventListener("mousemove", onDrag);
  document.addEventListener("mouseup", endDrag);
}

function onDrag(e) {
  if (!dragState) return;
  const w = windows[dragState.id];
  if (!w) return;
  const dx = e.clientX - dragState.startX;
  const dy = e.clientY - dragState.startY;
  let nx = dragState.elX + dx;
  let ny = dragState.elY + dy;

  // Edge snapping: snap to edges when within 30px
  const snapMargin = 30;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const snapState = { snap: null };

  if (nx < snapMargin && ny < snapMargin) {
    // Top-left corner → full screen
    snapState.snap = "full";
  } else if (nx < snapMargin) {
    // Left edge → left half
    snapState.snap = "left";
  } else if (nx + w.win.offsetWidth > vw - snapMargin) {
    // Right edge → right half
    snapState.snap = "right";
  } else if (ny < snapMargin) {
    // Top edge → full width
    snapState.snap = "top";
  }

  if (snapState.snap === "full") {
    w.win.style.left = "0"; w.win.style.top = "0";
    w.win.style.width = "100%"; w.win.style.height = "calc(100% - 48px)";
    w.win.classList.add("lux-win-snap");
  } else if (snapState.snap === "left") {
    w.win.style.left = "0"; w.win.style.top = "0";
    w.win.style.width = "50%"; w.win.style.height = "calc(100% - 48px)";
    w.win.classList.add("lux-win-snap");
  } else if (snapState.snap === "right") {
    w.win.style.right = "0"; w.win.style.left = "auto"; w.win.style.top = "0";
    w.win.style.width = "50%"; w.win.style.height = "calc(100% - 48px)";
    w.win.classList.add("lux-win-snap");
  } else if (snapState.snap === "top") {
    w.win.style.left = "0"; w.win.style.top = "0";
    w.win.style.width = "100%"; w.win.style.height = "calc(100% - 48px)";
    w.win.classList.add("lux-win-snap");
  } else {
    w.win.style.left = nx + "px";
    w.win.style.top = ny + "px";
    w.win.classList.remove("lux-win-snap");
  }
}

function endDrag() {
  dragState = null;
  document.removeEventListener("mousemove", onDrag);
  document.removeEventListener("mouseup", endDrag);
}

// ── Resize ────────────────────────────────────────────────────────────────

function startResize(id, e, edge) {
  const w = windows[id];
  if (!w) return;
  const r = w.win.getBoundingClientRect();
  resizeState = { id, startX: e.clientX, startY: e.clientY, elW: r.width, elH: r.height, edge };
  document.addEventListener("mousemove", onResize);
  document.addEventListener("mouseup", endResize);
}

function onResize(e) {
  if (!resizeState) return;
  const w = windows[resizeState.id];
  if (!w) return;
  const dx = e.clientX - resizeState.startX;
  const dy = e.clientY - resizeState.startY;
  const newW = Math.max(200, resizeState.elW + dx);
  const newH = Math.max(120, resizeState.elH + dy);
  w.win.style.width = newW + "px";
  w.win.style.height = newH + "px";
}

function endResize() {
  resizeState = null;
  document.removeEventListener("mousemove", onResize);
  document.removeEventListener("mouseup", endResize);
}

// ── App Launcher (bridge between taskbar and windows) ───────────────────

export function launchApp(appId, createFn) {
  // If window exists, toggle minimize/restore.
  if (windows[appId]) {
    const w = windows[appId];
    if (w.minimized) {
      // Restore.
      minimizeWindow(appId);
      focusWindow(appId);
    } else if (getTopWindow() === appId) {
      // Already focused — minimize.
      minimizeWindow(appId);
    } else {
      // Different window focused — focus this one.
      focusWindow(appId);
    }
    return;
  }
  // Create new window.
  createFn(appId);
}

// ── Getters ───────────────────────────────────────────────────────────────

export function getWindow(id) { return windows[id] || null; }
export function getWindowBody(id) { const w = windows[id]; return w ? w.body : null; }
export function getAllWindows() { return Object.keys(windows); }
export function getTopWindow() { return focusOrder.length ? focusOrder[focusOrder.length - 1] : null; }
