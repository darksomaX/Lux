// Lock mode. Lux starts "cold" (locked) until the user types the unlock
// phrase. While locked, the proxied content and tools are hidden, and we
// apply best-effort disruption of devtools / view-source so a quick inspector
// glance can't read the page.
//
// Re-lock triggers (all configurable): idle timeout, all tabs closed.
// The session token lives in sessionStorage so it clears when the browser
// closes (true cold start) but survives reloads within a session.

import { loadSettings } from "./settings.js";

const SESSION_KEY = "lux.session.unlocked";
let idleTimer = null;
let lastActivity = Date.now();

export function isUnlocked() {
  try {
    return sessionStorage.getItem(SESSION_KEY) === "1";
  } catch {
    return false;
  }
}

export function lock() {
  try {
    sessionStorage.removeItem(SESSION_KEY);
  } catch {}
  document.body.classList.add("lux-locked");
  applyDevtoolsGuard(true);
  window.dispatchEvent(new CustomEvent("lux:lock-change", { detail: { locked: true } }));
}

export async function tryUnlock(phrase) {
  const s = loadSettings();
  if (phrase === s.lockPhrase) {
    try {
      sessionStorage.setItem(SESSION_KEY, "1");
    } catch {}
    document.body.classList.remove("lux-locked");
    applyDevtoolsGuard(false);
    armIdle();
    window.dispatchEvent(new CustomEvent("lux:lock-change", { detail: { locked: false } }));
    return true;
  }
  return false;
}

// Idle re-lock. Resets on any input/mouse activity.
export function armIdle() {
  const s = loadSettings();
  if (idleTimer) clearInterval(idleTimer);
  if (!s.lockOnIdle) return;

  const reset = () => (lastActivity = Date.now());
  ["pointermove", "keydown", "click", "touchstart", "wheel"].forEach((ev) =>
    window.addEventListener(ev, reset, { passive: true })
  );

  idleTimer = setInterval(() => {
    const idleMin = (Date.now() - lastActivity) / 60000;
    if (idleMin >= (s.lockIdleMinutes || 5)) {
      lock();
      clearInterval(idleTimer);
    }
  }, 15000);
  // Don't hold the event loop alive forever in tests.
  if (idleTimer && typeof idleTimer.unref === "function") idleTimer.unref();
}

// Best-effort devtools disruption while locked. This is NOT a security
// boundary (nothing client-side is), but it raises the bar for casual
// inspection: a debugger statement in a tight loop pauses scripted devtools,
// and we overlay a blank sheet so the DOM tree shows nothing useful.
let guardTimer = null;
function applyDevtoolsGuard(on) {
  const s = loadSettings();
  if (!s.blockDevtools) return;
  if (on) {
    document.body.setAttribute("data-locked", "1");
    // A periodic debugger statement is the standard technique to pause
    // devtools that are open. It has no effect when devtools is closed.
    guardTimer = setInterval(() => {
      // eslint-disable-next-line no-debugger
      debugger;
    }, 200);
  } else {
    document.body.removeAttribute("data-locked");
    if (guardTimer) clearInterval(guardTimer);
    guardTimer = null;
  }
}
