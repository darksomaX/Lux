// URL scheme: controls how the proxied destination appears in the address bar
// and in the proxy path. This is the user-facing obfuscation layer (separate
// from the engine's internal codec).
//
// Schemes:
//   "encoded" -> hand the raw URL to the engine; it applies its own codec
//                (UV xor by default). Address bar shows /service/<gibberish>.
//   "plain"   -> /service/<url> (no obfuscation; for debugging only).
//   "math"    -> /math/<base64(url)>. Looks like a math drill site.
//   "none"    -> the destination is never put in the URL. Instead we open the
//                proxied site in a child iframe via postMessage chains, so the
//                top URL stays on Lux's home. (Fragile; use for stealth.)

import { loadSettings } from "./settings.js";
import { getEngine as getSearchEngine } from "./search-engines.js";

export function normalizeUrl(input) {
  const s = (input || "").trim();
  if (!s) return null;
  // Already a full URL or about: link.
  if (/^[a-z]+:\/\//i.test(s) || s.startsWith("about:")) return s;
  // Looks like a domain (has a dot, no spaces) -> treat as a URL.
  if (!s.includes(" ") && s.includes(".") && !s.includes(" ")) {
    return "https://" + s;
  }
  // Otherwise it's a search query -> route to the selected engine.
  const settings = loadSettings();
  const engine = getSearchEngine(settings.searchEngine);
  return engine.search(s);
}

// Build the path the engine should navigate to for a given target URL.
// Returns null for "none" (caller must use the iframe-chain path instead).
export function buildProxyPath(targetUrl) {
  const settings = loadSettings();
  switch (settings.urlScheme) {
    case "math":
      return "/math/" + btoa(unescape(encodeURIComponent(targetUrl)));
    case "plain":
      return (settings.customPrefix || "/service/") + targetUrl;
    case "none":
      return null;
    case "encoded":
    default:
      // Defer to the engine's own encoder.
      return "engine";
  }
}
