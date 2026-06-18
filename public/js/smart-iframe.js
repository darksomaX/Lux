// Smart iframes. Prevents the proxy from being nested inside itself (a
// classic foot-gun: a user opens Lux inside a proxied tab, then proxies Lux
// again, recursively). When nesting is detected we replace the whole stack
// with the single top-level frame so the user always lands on one Lux session.

// Detect: Lux is running inside another Lux instance when the top window
// is reachable, has a Lux marker, and is not us.
export function detectNesting() {
  try {
    if (window.top === window.self) return false;
    // If the top window carries our marker, we're nested.
    return !!window.top.__LUX__;
  } catch {
    // Cross-origin access throws; treat that as "probably nested" to be safe.
    return true;
  }
}

// If nested, bust out to the top. We hand the current target up so the parent
// can adopt it rather than losing the user's place.
export function breakOutOfNest(targetUrl) {
  if (!detectNesting()) return false;
  try {
    // Signal the top Lux to take over this URL, then close the nested tab.
    window.top.postMessage({ type: "lux:adopt", url: targetUrl }, "*");
  } catch {
    // Cross-origin parent: just redirect top to Lux with the URL.
    try {
      window.top.location.href = "/#" + encodeURIComponent(targetUrl);
    } catch {
      window.open("/", "_top");
    }
  }
  return true;
}

// Mark this window as the canonical Lux instance.
export function markCanonical() {
  window.__LUX__ = true;

  // Listen for adoption requests from nested instances.
  window.addEventListener("message", (e) => {
    if (e.data && e.data.type === "lux:adopt" && e.data.url) {
      // Hand it to the main app's navigate function if present.
      if (window.Lux && window.Lux.navigate) {
        window.Lux.navigate(e.data.url);
      }
      e.preventDefault();
    }
  });
}
