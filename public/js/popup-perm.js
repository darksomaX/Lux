// Popup permission helper. The old version opened+closed a real popup on the
// user's first click, which was annoying and increasingly blocked by Chrome.
//
// New approach: don't prime anything. When the user clicks Cloak, try
// window.open(). If it returns null (blocked), show a toast telling them to
// allow popups. This is less aggressive and more honest.

let popupAllowed = null; // null = unknown, true/false after first attempt

export function isPopupAllowed() {
  if (popupAllowed !== null) return popupAllowed;
  // We don't probe anymore — just return unknown and let the actual cloak
  // attempt reveal the answer.
  return null;
}

// Try to open a popup. Returns the popup window or null. Updates popupAllowed.
export function tryPopup(url = "") {
  try {
    const popup = window.open(url, "_blank");
    popupAllowed = !!popup;
    return popup;
  } catch {
    popupAllowed = false;
    return null;
  }
}

// If the cloak popup was blocked, show a toast with instructions.
export function showPopupBlockedToast() {
  if (popupAllowed === false) {
    const toast = document.createElement("div");
    toast.style.cssText =
      "position:fixed;bottom:80px;left:50%;transform:translateX(-50%);z-index:100;" +
      "background:var(--ink);color:var(--bg);padding:14px 20px;border-radius:10px;" +
      "font-size:13px;max-width:340px;box-shadow:0 8px 32px rgba(0,0,0,0.3)";
    toast.innerHTML =
      "Popups are blocked. Click the popup icon in your browser's address bar " +
      "and allow popups for this site, then try again. " +
      '<button style="margin-left:8px;background:var(--bg);color:var(--ink);border:0;border-radius:4px;padding:3px 8px;cursor:pointer;font-size:12px">OK</button>';
    toast.querySelector("button").onclick = () => toast.remove();
    document.body.appendChild(toast);
    setTimeout(() => { if (toast.parentElement) toast.remove(); }, 10000);
  }
}

// No-op for backward compat (main.js imports armPrimeOnFirstGesture).
export function armPrimeOnFirstGesture() {
  // Intentionally empty. We no longer prime popups aggressively.
}
