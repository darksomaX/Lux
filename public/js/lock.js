// Lock screen with create-password flow.
// First visit: create a password (with skip option).
// Returning: enter password to unlock.
// Wrong password: shake + red reset button to clear password and start fresh.

import { loadSettings, saveSettings } from "./settings.js";

const SESSION_KEY = "lux.session.unlocked";
let idleTimer = null;
let lastActivity = Date.now();

const $ = (id) => document.getElementById(id);

export function isUnlocked() {
  // If lock is disabled, always consider unlocked.
  const s = loadSettings();
  if (!s.lockEnabled) return true;
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
  window.dispatchEvent(new CustomEvent("lux:lock-change", { detail: { locked: true } }));
}

export function dismiss() {
  $("lockscreen").style.display = "none";
  document.body.classList.remove("lux-locked");
  // Set session key so navigation guard passes (lock is dismissed for this session).
  try {
    sessionStorage.setItem(SESSION_KEY, "1");
  } catch {}
}

export async function tryUnlock(phrase) {
  const s = loadSettings();
  const stored = s.lockPassword;
  // No password set means anyone can unlock — treat as match.
  if (!stored) {
    try { sessionStorage.setItem(SESSION_KEY, "1"); } catch {}
    dismiss();
    armIdle();
    window.dispatchEvent(new CustomEvent("lux:lock-change", { detail: { locked: false } }));
    return true;
  }
  // Compare SHA-256 hash, not plaintext.
  const hash = await sha256(phrase);
  if (hash === stored) {
    try { sessionStorage.setItem(SESSION_KEY, "1"); } catch {}
    dismiss();
    armIdle();
    window.dispatchEvent(new CustomEvent("lux:lock-change", { detail: { locked: false } }));
    return true;
  }
  return false;
}

async function sha256(text) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// Show the lock screen and wire the password flow.
export function initLock() {
  const s = loadSettings();
  const pw = s.lockPassword;
  const input = $("lock-input");
  const submit = $("lock-submit");
  const resetBtn = $("lock-reset");
  const skipBtn = $("lock-skip");
  const title = $("lock-title");
  const msg = $("lock-msg");

  if (!s.lockEnabled) {
    // Lock disabled: dismiss immediately.
    dismiss();
    return;
  }
  if (isUnlocked()) {
    dismiss();
    armIdle();
    return;
  }

  // Cold start — show lock screen.
  document.body.classList.add("lux-locked");
  $("lockscreen").style.display = "flex";
  input.value = "";
  msg.textContent = "";
  resetBtn.style.display = "none";
  input.classList.remove("lock-shake");

  if (!pw) {
    // First visit — create a password.
    title.textContent = "Set a Password";
    input.placeholder = "Create a password";
    skipBtn.style.display = "flex";

    skipBtn.onclick = () => {
      dismiss();
    };

    const doCreate = async () => {
      const val = input.value.trim();
      if (!val) {
        msg.textContent = "Enter a phrase.";
        return;
      }
      // Store SHA-256 hash, not plaintext.
      const hash = await sha256(val);
      saveSettings({ lockPassword: hash });
      msg.textContent = "";
      tryUnlock(val);
    };

    submit.onclick = doCreate;
    input.onkeydown = (e) => {
      if (e.key === "Enter") doCreate();
    };
  } else {
    // Returning — enter password.
    title.textContent = "Enter Password";
    input.placeholder = "Enter password";
    skipBtn.style.display = "none";

    const doUnlock = () => {
      const val = input.value;
      if (!val) return;
      if (tryUnlock(val)) {
        msg.textContent = "";
        resetBtn.style.display = "none";
      } else {
        msg.textContent = "Wrong password.";
        input.classList.add("lock-shake");
        resetBtn.style.display = "flex";
        setTimeout(() => input.classList.remove("lock-shake"), 500);
      }
    };

    submit.onclick = doUnlock;
    input.onkeydown = (e) => {
      if (e.key === "Enter") doUnlock();
      else resetBtn.style.display = "none";
    };

    // Reset button: wipe password and switch to create mode.
    resetBtn.onclick = () => {
      saveSettings({ lockPassword: "" });
      msg.textContent = "Password cleared.";
      resetBtn.style.display = "none";
      input.value = "";
      title.textContent = "Set a Password";
      input.placeholder = "Create a password";
      skipBtn.style.display = "flex";
      // Re-bind for create mode.
      const doCreate = () => {
        const val = input.value.trim();
        if (!val) {
          msg.textContent = "Enter a phrase.";
          return;
        }
        saveSettings({ lockPassword: val });
        msg.textContent = "";
        tryUnlock(val);
      };
      submit.onclick = doCreate;
      input.onkeydown = (e) => {
        if (e.key === "Enter") doCreate();
      };
    };
  }

  input.focus();
}

// Idle re-lock.
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
  if (idleTimer && typeof idleTimer.unref === "function") idleTimer.unref();
}
