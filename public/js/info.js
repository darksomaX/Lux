// Info panel + volume control + battery indicator.
// The info panel (ⓘ icon in taskbar) shows IP, screen, time, battery, volume slider.
// Battery level also shows in the taskbar next to the clock.

import { loadSettings, saveSettings } from "./settings.js";

const $ = (id) => document.getElementById(id);

let panelEl = null;
let batteryInterval = null;
let audioCtx = null;
let gainNode = null;

export function initInfoPanel() {
  const helpBtn = $("open-help");
  if (!helpBtn) return;

  // Replace help button text with info icon.
  helpBtn.textContent = "\u24d8";
  helpBtn.style.fontSize = "18px";

  // Create the panel.
  panelEl = document.createElement("div");
  panelEl.id = "info-panel";
  panelEl.style.cssText =
    "position:fixed;bottom:56px;right:8px;z-index:70;background:var(--bg);" +
    "border:1px solid var(--line);border-radius:10px;padding:12px 14px;" +
    "font-size:12px;min-width:240px;box-shadow:0 4px 20px rgba(0,0,0,0.15);" +
    "display:none;line-height:1.6;";
  document.body.appendChild(panelEl);

  // Hover/toggle logic.
  let hideTimer = null;
  let showing = false;
  const show = () => { clearTimeout(hideTimer); renderInfo(); panelEl.style.display = "block"; };
  const hide = () => { panelEl.style.display = "none"; };

  helpBtn.addEventListener("mouseenter", show);
  helpBtn.addEventListener("mouseleave", () => { hideTimer = setTimeout(hide, 300); });
  panelEl.addEventListener("mouseenter", () => clearTimeout(hideTimer));
  panelEl.addEventListener("mouseleave", hide);
  helpBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    showing = !showing;
    if (showing) show(); else hide();
  });
  document.addEventListener("click", () => { panelEl.style.display = "none"; showing = false; });

  // Init AudioContext for volume control (best-effort).
  try {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    gainNode = audioCtx.createGain();
    gainNode.connect(audioCtx.destination);
    // Restore saved volume.
    const saved = loadSettings().masterVolume;
    if (typeof saved === "number") gainNode.gain.value = saved;
  } catch { /* Audio not available */ }

  // Start battery updates in the taskbar.
  initBatteryInTaskbar();
}

// ── Volume ────────────────────────────────────────────────────────────────

export function getGainNode() {
  return gainNode;
}

export function setVolume(val) {
  // val: 0.0 – 1.0
  if (gainNode) gainNode.gain.value = Math.max(0, Math.min(1, val));
  saveSettings({ masterVolume: val });
  // Best-effort: try to set volume on media elements in the active iframe.
  try {
    const activeFrame = document.querySelector(".lux-tab-frame[style*='block']") ||
                        document.querySelector("iframe.lux-tab-frame:not([style*='none'])");
    if (activeFrame && activeFrame.contentDocument) {
      const media = activeFrame.contentDocument.querySelectorAll("audio, video");
      for (const el of media) el.volume = val;
    }
  } catch {}
}

export function getVolume() {
  return gainNode ? gainNode.gain.value : 1;
}

// ── Battery in Taskbar ──────────────────────────────────────────────────

function initBatteryInTaskbar() {
  const clock = $("taskbar-clock");
  if (!clock) return;
  // Add battery indicator before the clock.
  const bat = document.createElement("span");
  bat.id = "taskbar-battery";
  bat.style.cssText = "font-size:11px;color:var(--ink-soft);padding:0 4px;display:none;";
  clock.parentNode.insertBefore(bat, clock);

  async function update() {
    try {
      const b = await navigator.getBattery();
      const pct = Math.round(b.level * 100);
      bat.textContent = b.charging ? "\u26a1" + pct + "%" : "\u{1F50B}" + pct + "%";
      bat.style.display = "inline";
    } catch { bat.style.display = "none"; }
  }
  update();
  batteryInterval = setInterval(update, 30000);
}

// ── Render Info Panel ────────────────────────────────────────────────────

async function renderInfo() {
  if (!panelEl) return;
  const ip = await getIp();
  const screenInfo = screen.width + "\u00d7" + screen.height + " @" + screen.colorDepth + "bit";
  const time = new Date().toLocaleString();
  let battery = "N/A";
  try {
    const b = await navigator.getBattery();
    battery = Math.round(b.level * 100) + "%" + (b.charging ? " \u26a1charging" : "");
  } catch {}

  const vol = getVolume();

  panelEl.innerHTML =
    "<div style=\"font-weight:600;margin-bottom:6px\">System Info</div>" +
    "<div><b>IP:</b> " + ip + "</div>" +
    "<div><b>Screen:</b> " + screenInfo + "</div>" +
    "<div><b>Time:</b> " + time + "</div>" +
    "<div><b>Battery:</b> " + battery + "</div>" +
    "<div style=\"margin-top:8px\"><b>Volume:</b> " +
    "<input type=\"range\" id=\"vol-slider\" min=\"0\" max=\"1\" step=\"0.05\" value=\"" + vol + "\" " +
    "style=\"width:100%;vertical-align:middle\"></div>" +
    "<div style=\"margin-top:4px;color:var(--ink-soft);font-size:10px\">Controls browser audio (best-effort)</div>";

  const slider = document.getElementById("vol-slider");
  if (slider) {
    slider.addEventListener("input", () => setVolume(parseFloat(slider.value)));
  }
}

// ── IP Fetch ─────────────────────────────────────────────────────────────

async function getIp() {
  try {
    const r = await fetch("/ip");
    const d = await r.json();
    return d.ip || "unknown";
  } catch { return "unknown"; }
}
