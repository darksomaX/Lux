// Bridge between the tab manager and the engine/transport/url-scheme modules.
// Kept separate to avoid circular imports (tabs.js needs the encoder, engine.js
// doesn't need to know about tabs).

import { setTransportFor } from "./transport.js";
import { getEngine } from "./engine.js";
import { buildProxyPath } from "./url-scheme.js";

export { setTransportFor, getEngine, buildProxyPath };

// Encode a real URL into the proxied path the service worker understands.
// Honors the URL-scheme setting (encoded / plain / none).
export function encodeForTab(url) {
  const eng = getEngine();
  const schemePath = buildProxyPath(url);

  if (schemePath === "engine") {
    // Use the engine's own encoder (UV xor by default).
    return eng.encode(url);
  }
  if (schemePath === null) {
    // "none" scheme: return the raw URL (the SW still rewrites it).
    return url;
  }
  // Custom scheme path (e.g. /s/<encoded>).
  return schemePath;
}
