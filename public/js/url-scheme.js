// URL scheme: controls how the proxied destination appears in the address bar
// and in the proxy path. The "math" disguise option was removed — it added
// complexity for little benefit.
//
// Schemes:
//   "encoded" -> hand the raw URL to the engine; it applies its own codec
//                (UV xor by default). Address bar shows /service/<gibberish>.
//   "plain"   -> /service/<url> (no obfuscation; for debugging only).
//   "none"    -> the destination is never put in the URL. Instead we open the
//                proxied site in a child iframe via postMessage chains, so the
//                top URL stays on Lux's home. (Fragile; use for stealth.)
//
// Note: the "/s/" prefix the user wants is handled by changing UV's config
// prefix at build time, not here. This module decides the *encoding style*,
// not the path prefix. The prefix is whatever uv.config.js sets (default
// /service/). To change it to /s/, edit the built public/uv/uv.config.js
// "prefix" field — or the build script.

import { loadSettings } from "./settings.js";
import { getEngine as getSearchEngine } from "./search-engines.js";

export function normalizeUrl(input) {
  const s = (input || "").trim();
  if (!s) return null;
  if (/^[a-z]+:\/\//i.test(s) || s.startsWith("about:")) return s;
  if (!s.includes(" ") && s.includes(".") && !s.includes(" ")) {
    return "https://" + s;
  }
  const settings = loadSettings();
  const engine = getSearchEngine(settings.searchEngine);
  return engine.search(s);
}

export function buildProxyPath(targetUrl) {
  const settings = loadSettings();
  switch (settings.urlScheme) {
    case "plain":
      return (settings.customPrefix || "/service/") + targetUrl;
    case "none":
      return null;
    case "encoded":
    default:
      return "engine";
  }
}
