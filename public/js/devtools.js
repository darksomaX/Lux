// DevTools Request Viewer. Shows proxied requests in real time.
// Reads from the service worker via postMessage (sent by uv.sw.js).
// Toggleable via settings → "devtools".

import { loadSettings, saveSettings } from "./settings.js";

let overlayEl = null;
let requests = [];
let visible = false;
let containerEl = null;

const MAX_REQUESTS = 100;

export function initDevtools() {
  // Listen for SW messages.
  navigator.serviceWorker.addEventListener("message", (event) => {
    if (!event.data || !event.data.luxDevtools) return;
    if (!visible) {
      // Store even when hidden so the panel has data when opened.
      requests.push(event.data);
      if (requests.length > MAX_REQUESTS) requests.shift();
      return;
    }
    addRequest(event.data);
  });

  // Create the overlay container (hidden initially).
  containerEl = document.createElement("div");
  containerEl.id = "devtools-overlay";
  containerEl.style.cssText =
    "position:fixed;top:40px;right:0;bottom:48px;width:min(420px,100%);z-index:25;" +
    "background:var(--bg);border-left:1px solid var(--line);" +
    "display:none;flex-direction:column;box-shadow:-4px 0 20px rgba(0,0,0,0.1);";
  document.body.appendChild(containerEl);

  // Header.
  const header = document.createElement("div");
  header.style.cssText =
    "display:flex;align-items:center;justify-content:space-between;" +
    "padding:8px 12px;border-bottom:1px solid var(--line);font-size:13px;font-weight:600;";
  header.innerHTML = "<span>Proxied Requests</span>" +
    "<button id='devtools-clear' style='background:none;border:0;cursor:pointer;color:var(--ink-soft);font-size:12px'>Clear</button>";
  containerEl.appendChild(header);

  // Request list.
  const list = document.createElement("div");
  list.id = "devtools-list";
  list.style.cssText = "flex:1;overflow-y:auto;font-size:11px;font-family:ui-monospace,monospace;";
  containerEl.appendChild(list);

  // Clear button.
  document.getElementById("devtools-clear")?.addEventListener("click", () => {
    requests = [];
    list.innerHTML = "<div style='padding:12px;color:var(--ink-soft);font-size:12px'>No requests yet.</div>";
  });

  // Show/hide based on settings.
  const s = loadSettings();
  if (s.devtools) show();
}

function addRequest(data) {
  if (!containerEl) return;
  const list = document.getElementById("devtools-list");
  if (!list) return;

  // Clear "no requests" placeholder.
  if (list.children.length === 1 && list.children[0].textContent.includes("No requests")) {
    list.innerHTML = "";
  }

  const row = document.createElement("div");
  const method = data.method || "GET";
  const url = data.url || "";
  const status = data.status || 0;
  const size = data.size || "?";
  const shortUrl = url.length > 60 ? url.slice(0, 57) + "..." : url;

  // Color code by status.
  const statusColor = status >= 400 ? "var(--danger)" : status >= 300 ? "#d4a017" : status >= 200 ? "var(--ok)" : "var(--ink-soft)";

  row.style.cssText =
    "padding:6px 10px;border-bottom:1px solid var(--line);cursor:pointer;transition:background 0.1s;";
  row.innerHTML =
    "<span style='color:" + statusColor + ";font-weight:600'>" + status + "</span> " +
    "<span style='color:var(--ink-soft)'>" + method + "</span> " +
    "<span>" + escapeHtml(shortUrl) + "</span>" +
    "<span style='float:right;color:var(--ink-soft)'>" + size + "</span>";

  // Show full URL on click.
  row.addEventListener("click", () => {
    alert("Full URL: " + url + "\nStatus: " + status + "\nMethod: " + method + "\nSize: " + size);
  });

  list.insertBefore(row, list.firstChild);

  // Keep max entries.
  while (list.children.length > MAX_REQUESTS) {
    list.removeChild(list.lastChild);
  }
}

export function show() {
  visible = true;
  if (containerEl) containerEl.style.display = "flex";
  // Flush queued requests.
  const list = document.getElementById("devtools-list");
  if (list) {
    list.innerHTML = "";
    if (requests.length === 0) {
      list.innerHTML = "<div style='padding:12px;color:var(--ink-soft);font-size:12px'>No requests yet.</div>";
    }
    for (const r of requests) addRequest(r);
  }
}

export function hide() {
  visible = false;
  if (containerEl) containerEl.style.display = "none";
}

export function toggle() {
  if (visible) hide();
  else show();
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[c]);
}
