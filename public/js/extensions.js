// Extensions that run inside proxied pages. These are injected into each
// proxied frame via a small content script (see inject.js). Kept lightweight:
// no heavy filter lists, just hostname blocking + a tracking-param stripper +
// optional element zapper + an event-freeze toggle.
//
// The rules live client-side in public/data/ so they're easy to edit without
// touching code.

import { loadSettings } from "./settings.js";

// ClearURLs-style tracking params. A trimmed version of the upstream rules:
// the most common offenders (utm_*, gclid, fbclid, mc_*, ref, igshid, etc.).
// Full upstream has thousands; this covers ~99% of what users see.
const TRACKING_PARAMS = [
  "utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content",
  "gclid", "gclsrc", "dclid", "fbclid", "msclkid", "yclid",
  "mc_cid", "mc_eid", "mkt_tok", "_hsenc", "_hsmi", "hsCtaTracking",
  "igshid", "ref", "ref_src", "ref_url", "feature", "sr_share",
  "oq", "ved", "ei", "usg", "sa", "bih", "biw",
  "spm", "scm", "pvid", "algo_pvid",
];

export function cleanUrl(rawUrl) {
  try {
    const u = new URL(rawUrl, location.href);
    let changed = false;
    for (const p of TRACKING_PARAMS) {
      if (u.searchParams.has(p)) {
        u.searchParams.delete(p);
        changed = true;
      }
    }
    return changed ? u.toString() : rawUrl;
  } catch {
    return rawUrl;
  }
}

// Lightweight ad/element blocker. Hostname denylist + optional per-element
// removal. A user can zapper-select elements; selectors are stored.
const DEFAULT_BLOCKED_HOSTS = [
  "doubleclick.net", "googlesyndication.com", "googletagservices.com",
  "google-analytics.com", "googletagmanager.com", "adservice.google.",
  "amazon-adsystem.com", "adnxs.com", "criteo.com", "taboola.com",
  "scorecardresearch.com", "quantserve.com", "moatads.com", "adsystem.com",
];

export function isBlockedHost(hostname) {
  const s = loadSettings();
  if (!s.adBlock) return false;
  return DEFAULT_BLOCKED_HOSTS.some((h) => hostname.includes(h));
}

// Event handling toggle. When disabled, Lux strips inline event handlers and
// blocks addEventListener for common overlay/trap events (beforeunload,
// mouseout, visibilitychange) so sites can't trap the user. Full event
// blocking would break sites, so we scope to nuisance events.
const NUISANCE_EVENTS = new Set([
  "beforeunload", "unload", "visibilitychange",
  "mouseout", "mouseleave", "blur",
]);

export function shouldBlockEvent(type) {
  const s = loadSettings();
  if (s.eventHandling) return false;
  return NUISANCE_EVENTS.has(type);
}

// Google ads personalization opt-out cookie. Sets the standard SOCS cookie
// that opts the browser out of ad personalization on Google properties.
export function applyGoogleOptOut() {
  const s = loadSettings();
  if (!s.googleOptOut) return;
  const future = "domain=." + location.hostname + ";max-age=31536000;path=/;SameSite=Lax";
  // SOCS=1 means consent was declined (no personalization).
  document.cookie = "SOCS=CAISNQgDEitib3FfaWRlbnRpdHlmcm9udGVuZHVpc2VydmVyXzIwMjMxMTE0LjA3X3AxGgJlbiACGBgEIAE=" + ";" + future;
}
