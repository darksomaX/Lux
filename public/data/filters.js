// Curated ad/tracking filter list. This is the "20% of uBlock" that blocks
// ~80% of ads. Two parts:
//
// 1. HOST_RULES: domain patterns. Any proxied sub-resource request whose
//    destination hostname matches is dropped by the service worker.
//    Format: "domain" or "suffix" (matched as hostname.endsWith).
//
// 2. COSMETIC_SELECTORS: CSS selectors injected into proxied HTML pages to
//    hide ad elements that load from first-party origins (which host rules
//    can't catch). These are the most common from EasyList.
//
// This is intentionally a static, curated list (not a live EasyList
// subscription) to keep Lux dependency-free and fast. Operators can edit this
// file or drop a full easylist.txt into public/data/ for the parser to load.

export const HOST_RULES = [
  // Major ad networks
  "doubleclick.net", "googlesyndication.com", "googletagservices.com",
  "google-analytics.com", "googletagmanager.com", "adservice.google.com",
  "adsystem.com", "amazon-adsystem.com", "adnxs.com", "criteo.com",
  "taboola.com", "outbrain.com", "scorecardresearch.com", "quantserve.com",
  "moatads.com", "adroll.com", "pubmatic.com", "rubiconproject.com",
  "openx.net", "casalemedia.com", "smartadserver.com", "yieldmo.com",
  "admob.com", "adsymptotic.com", "betrad.com", "bluekai.com",
  "demdex.net", "evidon.com", "krxd.net", "mediavine.com",
  // Social tracking
  "connect.facebook.net", "facebook.net/tr", "fbcdn.com/tr",
  "analytics.twitter.com", "ads.twitter.com", "ads.linkedin.com",
  "snap.licdn.com",
  // Misc trackers
  "branch.io", "app.link", "onesignal.com", "pushcrew.com",
  "intercom.io", "mixpanel.com", "segment.io", "amplitude.com",
  "hotjar.com", "fullstory.com", "logrocket.com", "sentry.io",
  "newrelic.com", "bugsnag.com", "rollbar.com",
  // Common ad-serving subdomains
  "ads.", "ad.", "adsrvr.org", "advertising.com",
  "servedbyadbutler.com", "serving-sys.com", "contextweb.com",
  "3lift.com", "lijit.com", "sharethrough.com",
];

export const COSMETIC_SELECTORS = [
  // Generic ad containers
  ".ad", ".ads", ".ad-container", ".ad-slot", ".ad-banner", ".ad-wrapper",
  ".advertisement", ".advertisements", ".advert", ".adsbygoogle",
  "[class*='ad-']", "[class*='-ad']", "[class*='ads-']", "[class*='_ad_']",
  "[id*='ad-']", "[id*='-ad']", "[id*='ads-']", "[id*='_ad_']",
  "[id*='google_ad']", "[id*='div-gpt-ad']",
  // Sponsorship / promoted
  ".sponsored", ".sponsor", ".promotion", ".promoted",
  "[class*='sponsored']", "[class*='sponsor-']",
  // Newsletter / social popups (common nuisance)
  ".newsletter-popup", ".popup-overlay", ".modal-ad",
  // Common ad sizes (banner ads)
  "[width='728'][height='90']", "[width='300'][height='250']",
  "[width='320'][height='50']", "[width='160'][height='600']",
  // Video ad overlays
  ".video-ad-overlay", ".preroll-ad",
  // Common anti-adblock nag
  ".adblock-nag", ".adblock-detected", "#adblock-notice",
];

// Check if a hostname matches any host rule.
export function isAdHost(hostname) {
  if (!hostname) return false;
  const h = hostname.toLowerCase();
  for (const rule of HOST_RULES) {
    if (rule.endsWith(".")) {
      // Prefix match: "ads." matches "ads.example.com"
      if (h.startsWith(rule)) return true;
    } else if (h === rule || h.endsWith("." + rule)) {
      return true;
    }
  }
  return false;
}

// Build the CSS string to inject into proxied pages.
export function cosmeticCss() {
  return COSMETIC_SELECTORS.join(",\n") + " { display: none !important; }\n";
}

// ClearURLs-style tracking params. Stripped from navigation/document requests
// in the SW so the destination never sees them.
const TRACKING_PARAMS = [
  "utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content",
  "gclid", "gclsrc", "dclid", "fbclid", "msclkid", "yclid",
  "mc_cid", "mc_eid", "mkt_tok", "_hsenc", "_hsmi", "hsCtaTracking",
  "igshid", "ref_src", "ref_url", "feature", "sr_share",
  "spm", "scm", "pvid", "algo_pvid",
];

export function cleanTrackingParams(urlStr) {
  try {
    const u = new URL(urlStr);
    let changed = false;
    for (const p of TRACKING_PARAMS) {
      if (u.searchParams.has(p)) { u.searchParams.delete(p); changed = true; }
    }
    return changed ? u.toString() : null;
  } catch {
    return null;
  }
}
