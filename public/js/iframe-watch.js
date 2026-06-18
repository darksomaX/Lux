// Multi-iframe detection. When Lux is running and the proxied page embeds
// nested iframes (a game site whose game is a frame, or — the failure case —
// someone proxying Lux inside Lux), show a toast offering to open that nested
// frame as its own proxied tab.
//
// We poll the frame container for nested iframes every 2s. When a new nested
// iframe appears that wasn't there before, we surface a toast.

let pollTimer = null;
let knownSrcs = new Set();
let onNestedCallback = null;

export function startIframeWatch(containerEl, onNested) {
  if (pollTimer) clearInterval(pollTimer);
  onNestedCallback = onNested;
  knownSrcs = new Set();
  pollTimer = setInterval(() => scan(containerEl), 2000);
  if (pollTimer.unref) pollTimer.unref();
}

export function stopIframeWatch() {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = null;
}

function scan(containerEl) {
  if (!containerEl) return;
  try {
    // Find all iframes within the container (nested ones included).
    const frames = containerEl.querySelectorAll("iframe");
    for (const f of frames) {
      const src = f.src || "";
      if (!src || src === "about:blank") continue;
      if (knownSrcs.has(src)) continue;
      knownSrcs.add(src);
      // Only surface if it looks like a real content frame (has dimensions).
      const rect = f.getBoundingClientRect();
      if (rect.width < 50 || rect.height < 50) continue;
      if (onNestedCallback) onNestedCallback(src);
    }
  } catch {
    // Cross-origin access to the frame's contents throws; that's fine.
  }
}
