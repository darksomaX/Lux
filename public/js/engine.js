// Engine abstraction. Lux supports multiple interception engines (Ultraviolet
// by default; Scramjet optional). Both speak to the same wisp backend, but
// their client wiring differs, so we hide that behind one interface.
//
// Each engine exports:
//   async init()              — register SW, set transport, become ready
//   encode(url)               — turn a target URL into the proxied path
//   mount(targetUrl, iframe)  — load a proxied site into a given iframe
//
// The engine is chosen in settings and persisted in localStorage.

import { setTransport } from "./transport.js";

// Inject a classic <script> and resolve when it loads. Used to lazy-load the
// 900KB Scramjet bundle only when that engine is selected.
function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = src;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("Failed to load " + src));
    document.head.appendChild(s);
  });
}

// Delete an IndexedDB with a hard 3s timeout so a blocked connection can't
// hang the engine init forever.
function deleteDbWithTimeout(name) {
  return new Promise((resolve) => {
    let done = false;
    const finish = () => { if (!done) { done = true; resolve(); } };
    try {
      const req = indexedDB.deleteDatabase(name);
      req.onsuccess = finish;
      req.onerror = finish;
      req.onblocked = finish;
    } catch { finish(); }
    setTimeout(finish, 3000);
  });
}

// Wait until navigator.serviceWorker.controller is a SW whose script URL
// contains the given marker (e.g. "uv.sw.js" or "sj.sw.js"). The controller
// is what actually intercepts fetches for this page; .ready is not enough.
// Times out after 8s (then proceeds — the navigation may still work after a
// reload, and we don't want to hang forever).
function waitForController(marker) {
  return new Promise((resolve) => {
    if (navigator.serviceWorker.controller) {
      const url = navigator.serviceWorker.controller.scriptURL || "";
      if (url.includes(marker)) return resolve();
    }
    let done = false;
    const finish = () => { if (!done) { done = true; resolve(); } };
    const handler = () => {
      const c = navigator.serviceWorker.controller;
      if (c && (c.scriptURL || "").includes(marker)) {
        navigator.serviceWorker.removeEventListener("controllerchange", handler);
        finish();
      }
    };
    navigator.serviceWorker.addEventListener("controllerchange", handler);
    setTimeout(finish, 8000);
  });
}

// ---- Ultraviolet ----------------------------------------------------------

const uv = {
  name: "uv",
  label: "Ultraviolet",
  available: true,

  async init() {
    if (!("serviceWorker" in navigator)) {
      throw new Error("Service workers are not supported in this browser.");
    }
    // Unregister any OTHER root-scoped SW (e.g. Scramjet's) so they don't
    // conflict over the / scope. Only unregister if it's active AND its
    // script is not uv.sw.js — never unregister an installing UV SW (that
    // would be unregistering ourselves mid-install).
    const existing = await navigator.serviceWorker.getRegistrations();
    for (const reg of existing) {
      if (!reg.scope.endsWith("/")) continue;
      const script = reg.active?.scriptUrl || "";
      if (script && !script.includes("uv.sw.js")) {
        await reg.unregister();
      }
    }
    // Register at scope "/" so the SW can intercept the /service/* proxy path.
    // The server serves uv.sw.js at /uv.sw.js with Service-Worker-Allowed: /
    // to permit this wider scope.
    const reg = await navigator.serviceWorker.register("/uv.sw.js", {
      scope: "/",
      updateViaCache: "all",
    });
    await navigator.serviceWorker.ready;
    // Wait for the UV SW to actually control this page (not just be active).
    await waitForController("uv.sw.js");
    // After the SW claims the page, re-set the transport so the SW can
    // connect to the bare-mux SharedWorker with the new MessagePort.
    try {
      const proto = location.protocol === "https:" ? "wss" : "ws";
      const wispUrl = proto + "://" + location.host + "/wisp/";
      await setTransport("/epoxy/index.mjs", [{ wisp: wispUrl }]);
    } catch (e) { console.warn("[lux] transport reset:", e); }
    return reg;
  },

  encode(url) {
    const cfg = window.__uv$config;
    if (!cfg) throw new Error("Ultraviolet config not loaded.");
    return cfg.prefix + cfg.encodeUrl(url);
  },

  // mount accepts an optional encodeOverride so the URL-scheme setting can
  // replace UV's default xor encoder (e.g. the "math" base64 disguise).
  async mount(targetUrl, iframe, encodeOverride) {
    await this.init();
    const encode = encodeOverride || ((u) => this.encode(u));
    iframe.src = encode(targetUrl);
  },
};

// ---- Scramjet v2 (full controller + server-proxy fallback) ----------------
// Tries the full Scramjet v2 controller integration first (SW-based with
// WASM rewriting). Falls back to the server-proxy /sj-proxy endpoint if the
// controller fails to initialize (known SW RPC issue).

const PREFIX_SJ = "/~/sj/";
let scramjetController = null; // Singleton controller instance

// Wait for the SJ SW to become navigator.serviceWorker.controller. The
// controller's RPC works via MessageChannel, but fetch interception needs the
// SW to actually control the page. After unregistering UV and registering SJ,
// we poll controllerchange until the SJ SW takes over.
function waitForSjControl() {
  return new Promise((resolve) => {
    if (navigator.serviceWorker.controller) {
      const url = navigator.serviceWorker.controller.scriptURL || "";
      if (url.includes("sj.sw.js")) return resolve();
    }
    let done = false;
    const finish = () => { if (!done) { done = true; resolve(); } };
    const handler = () => {
      const c = navigator.serviceWorker.controller;
      if (c && (c.scriptURL || "").includes("sj.sw.js")) {
        navigator.serviceWorker.removeEventListener("controllerchange", handler);
        finish();
      }
    };
    navigator.serviceWorker.addEventListener("controllerchange", handler);
    // The SJ SW has skipWaiting + clients.claim, so this should resolve fast.
    // Timeout after 5s as a safety net.
    setTimeout(finish, 5000);
  });
}

// Try to initialize the full Scramjet controller
async function tryInitController() {
  if (scramjetController) return true;

  try {
    const { loadClassicScript, registerSw, createScramjetTransport } = await import("./scramjet-transport.js");

    // Load the scramjet v2 runtime IIFE (Tinf0il serves this at /scram/)
    await loadClassicScript("/scram/scramjet.js");
    if (typeof globalThis.$scramjet === "undefined") {
      throw new Error("scramjet.js did not set globalThis.$scramjet");
    }

    // Load the controller API IIFE (served at /controller/)
    await loadClassicScript("/controller/controller.api.js");
    if (typeof globalThis.$scramjetController === "undefined") {
      throw new Error("controller.api.js did not set globalThis.$scramjetController");
    }

    // Register the controller SW
    const sw = await registerSw("/sj.sw.js");

    // Create transport
    const transport = await createScramjetTransport();

    // Modify controller config in-place (Tinf0il pattern)
    const { Controller, config } = globalThis.$scramjetController;
    config.prefix = PREFIX_SJ;
    config.scramjetPath = "/scram/scramjet.js";
    config.injectPath = "/controller/controller.inject.js";
    config.wasmPath = "/scram/scramjet.wasm";
    console.log("[lux] SJ config prefix:", config.prefix);

    const controller = new Controller({
      serviceworker: sw,
      transport,
    });
    await controller.wait();
    scramjetController = controller;
    return true;
  } catch (e) {
    console.warn("[lux] Scramjet controller init failed, using server-proxy fallback:", e.message);
    scramjetController = null;
    return false;
  }
}

const scramjet = {
  name: "scramjet",
  label: "Scramjet v2",
  available: true,

  // Early init (called at boot when engine=scramjet). The SW is already
  // registered by initScramjetEarly in main.js; this just loads the bundles
  // + creates the controller.
  async tryInitEarly() {
    return tryInitController();
  },

  async init() {
    // If the controller was already initialized at boot (early init), skip.
    if (scramjetController) return;
    // Unregister UV's SW if active so SJ can take over the root scope.
    const existing = await navigator.serviceWorker.getRegistrations();
    for (const reg of existing) {
      if (!reg.scope.endsWith("/")) continue;
      const script = reg.active?.scriptUrl || "";
      if (script && script.includes("uv.sw.js")) {
        await reg.unregister();
      }
    }
    // Register the SJ SW if not already done by early init.
    const hasSjSw = existing.some((r) => (r.active?.scriptURL || "").includes("sj.sw.js"));
    if (!hasSjSw) {
      const { registerSw } = await import("./scramjet-transport.js");
      await registerSw("/sj.sw.js");
    }
    // Try the full controller init. If it fails, mount() falls back to
    // /sj-proxy server-side rewriting.
    await tryInitController();
  },

  encode(url) {
    return PREFIX_SJ + encodeURIComponent(url);
  },

  async mount(targetUrl, iframe) {
    await this.init();
    const controller = scramjetController;
    try {
      if (controller) {
        // Full Scramjet controller: create a frame and navigate
        const frame = controller.createFrame(iframe);
        frame.go(targetUrl);
        return;
      }
    } catch (e) {
      console.warn("[lux] Scramjet controller mount failed, falling back:", e.message);
      scramjetController = null;
    }
    // Fallback: server-proxy mode
    iframe.src = "/sj-proxy?url=" + encodeURIComponent(targetUrl);
  },
};

const engines = { uv, scramjet };

// getEngine reads the current engine from the unified settings store. Do NOT
// cache the result: the settings UI can change it at runtime, and a stale
// cache would silently keep using the old engine (the bug that made Scramjet
// selection appear to do nothing).
export function getEngine() {
  let key = "uv";
  try {
    const raw = localStorage.getItem("lux.settings.v1");
    if (raw) {
      const s = JSON.parse(raw);
      if (s && s.engine) key = s.engine;
    }
  } catch {}
  // If the selected engine is not available, fall back to UV silently.
  const engine = engines[key];
  if (engine && engine.available) return engine;
  return uv;
}

export function setEngine(name) {
  if (!engines[name]) throw new Error("Unknown engine: " + name);
  // Persist through the unified settings so getEngine() sees it.
  try {
    const raw = localStorage.getItem("lux.settings.v1");
    const s = raw ? JSON.parse(raw) : {};
    s.engine = name;
    localStorage.setItem("lux.settings.v1", JSON.stringify(s));
  } catch {}
}

export function listEngines() {
  return Object.values(engines).map((e) => ({
    name: e.name,
    label: e.label,
    available: e.available,
  }));
}

export { uv, scramjet };
