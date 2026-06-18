// Kill switch. Halts all proxied traffic the moment the network changes
// (online/offline/connectivity event, or a visible IP change) until the user
// explicitly confirms the new network is trusted. Prevents a proxy session
// from silently continuing on a hostile Wi-Fi after a network switch.

import { loadSettings } from "./settings.js";

let armed = false;
let tripped = false;
let lastIp = null;

const listeners = [];

export function onTrip(cb) {
  listeners.push(cb);
}

function trip(reason) {
  if (tripped) return;
  tripped = true;
  document.body.classList.add("lux-killswitch");
  // Block new navigations: hide the frame and intercept clicks.
  window.dispatchEvent(new CustomEvent("lux:killswitch", { detail: { reason } }));
  for (const cb of listeners) {
    try {
      cb(reason);
    } catch {}
  }
}

export function isTripped() {
  return tripped;
}

export function arm() {
  const s = loadSettings();
  if (!s.killSwitch || armed) return;
  armed = true;

  window.addEventListener("online", () => trip("network:online"));
  window.addEventListener("offline", () => trip("network:offline"));
  // connection.addEventListener('change') fires on Wi-Fi/cellular handoff.
  if (navigator.connection) {
    navigator.connection.addEventListener("change", () => trip("network:changed"));
  }
}

export async function disarm() {
  tripped = false;
  document.body.classList.remove("lux-killswitch");
}

// Record the apparent egress IP (via the server's own echo endpoint) and
// trip the kill switch if it changes mid-session. The server exposes /ip
// returning the client's observed IP.
export async function checkIpOnce() {
  try {
    const r = await fetch("/ip", { cache: "no-store" });
    const j = await r.json();
    if (lastIp && j.ip && j.ip !== lastIp) {
      trip("ip-changed: " + lastIp + " -> " + j.ip);
    }
    lastIp = j.ip;
    return j.ip;
  } catch {
    return null;
  }
}

export function getLastIp() {
  return lastIp;
}
