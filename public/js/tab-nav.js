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
    return eng.encode(url);
  }
  if (schemePath === null) {
    return url;
  }
  return schemePath;
}

// Mount a tab for engines that manage their own frame (like Scramjet).
// Returns true if the engine handled mounting, false if the caller should
// set iframe.src themselves.
export async function mountTab(tab, url) {
  const eng = getEngine();
  if (eng.name === "scramjet") {
    // Scramjet v2: register SW and set iframe.src (same pattern as UV).
    await eng.mount(url, tab.iframe);
    return true;
  }
  return false;
}
