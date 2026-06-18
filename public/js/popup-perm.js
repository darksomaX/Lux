// Popup pre-permission. Browsers only show the "allow popups" prompt after a
// user gesture, and the cloak feature needs popups. If the user clicks Cloak
// for the first time without having allowed popups, the popup is silently
// blocked and the feature looks broken.
//
// The fix (used by Interstellar and other proxies): open and immediately close
// a throwaway popup on the first user interaction. That triggers the browser's
// permission prompt once, up front, so a later Cloak click works instantly.
//
// We do this lazily the first time the user focuses the search input or clicks
// anywhere, whichever comes first.

let primed = false;

export function primePopupPermission() {
  if (primed) return;
  primed = true;
  try {
    const probe = window.open("", "_blank");
    if (probe) {
      // Permission already granted or prompt will show. Close it right away so
      // the user barely notices. If the browser blocked it, probe is null and
      // we'll try again next interaction (primed guard prevents spamming).
      probe.close();
    }
  } catch {
    // Some browsers throw on window.open without a gesture; ignore.
  }
}

export function isPopupAllowed() {
  // There's no clean synchronous API to read popup permission, so we probe.
  // This is best-effort.
  try {
    const probe = window.open("", "_blank");
    if (!probe) return false;
    probe.close();
    return true;
  } catch {
    return false;
  }
}

// Attach one-shot listeners so we prime on the first real gesture.
export function armPrimeOnFirstGesture() {
  const prime = () => {
    primePopupPermission();
    window.removeEventListener("pointerdown", prime);
    window.removeEventListener("keydown", prime);
  };
  window.addEventListener("pointerdown", prime, { once: true });
  window.addEventListener("keydown", prime, { once: true });
}
