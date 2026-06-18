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

// ---- Scramjet (optional) --------------------------------------------------
// Scramjet is the newer interception proxy by the same authors as UV. It uses
// a runtime-injection rewriter (realm pollution + proxies) rather than UV's
// URL-string rewriting, and its own service worker + controller.
//
// The previous blocker was SW control timing: navigator.serviceWorker.ready
// resolves when the SW is "active" but NOT when it "controls" the page. Without
// control, /scramjet/* requests fall through to Express. The fix is twofold:
//   1. The SJ SW calls clients.claim() on activate (build-uv.mjs).
//   2. init() waits for navigator.serviceWorker.controller to become the SJ SW
//      before returning, using the controllerchange event.

const scramjet = {
  name: "scramjet",
  label: "Scramjet (unavailable)",
  // Scramjet v1's controller has a bug: on a fresh IndexedDB it opens the DB
  // without creating the object stores it then tries to transaction on
  // ("object store not found"). v2 is alpha-only with no reference app. The
  // SW registration + clients.claim + waitForController work, but the
  // controller init throws. Disabled until v1 is patched upstream or v2
  // stabilizes. UV is the verified engine.
  available: false,

  _controller: null,
  _frame: null,

  async init() {
    // Lazy-load Scramjet only when this engine is selected. Use scramjet.all.js
    // (the classic IIFE build that sets globalThis.$scramjetLoadController),
    // NOT scramjet.bundle.js (the ESM build whose `export` throws when loaded
    // as a classic script).
    if (typeof $scramjetLoadController !== "function") {
      await loadScript("/scramjet/scramjet.all.js");
      if (typeof $scramjetLoadController !== "function") {
        throw new Error("Scramjet bundle failed to load.");
      }
    }
    if ("serviceWorker" in navigator) {
      // Unregister any other root-scoped SW (e.g. UV's).
      const existing = await navigator.serviceWorker.getRegistrations();
      for (const reg of existing) {
        const script = reg.active?.scriptUrl || "";
        if (reg.scope.endsWith("/") && script && !script.includes("sj.sw.js")) {
          await reg.unregister();
        }
      }
      await navigator.serviceWorker.register("/sj.sw.js", { scope: "/" });
      await navigator.serviceWorker.ready;
      // CRITICAL: wait until the SJ SW actually controls this page. Without
      // this, /scramjet/* navigations are not intercepted.
      await waitForController("sj.sw.js");
    }
    if (!this._controller) {
      // Delete the "scramjet" DB with a hard timeout so a blocked delete can't
      // hang init forever. The controller recreates it fresh on init.
      await deleteDbWithTimeout("scramjet");
      const { ScramjetController } = $scramjetLoadController();
      this._controller = new ScramjetController({
        files: {
          wasm: "/scramjet/scramjet.wasm.wasm",
          all: "/scramjet/scramjet.all.js",
          sync: "/scramjet/scramjet.sync.js",
        },
      });
      // Race the init against a timeout so we never hang silently.
      await Promise.race([
        this._controller.init(),
        new Promise((_, rej) => setTimeout(() => rej(new Error("Scramjet controller init timed out")), 30000)),
      ]);
    }
    return this._controller;
  },

  encode(url) {
    // Scramjet does not expose a simple path encoder like UV; it owns the frame.
    return null;
  },

  async mount(targetUrl, iframe) {
    const ctrl = await this.init();
    // Reuse a single frame; Scramjet manages its own iframe.
    if (!this._frame) {
      this._frame = ctrl.createFrame();
      this._frame.frame.id = "lux-sj-frame";
      this._frame.frame.style.cssText = "width:100%;height:100%;border:0;";
    }
    // Replace any prior frame in the host container.
    if (iframe && iframe.parentElement) {
      iframe.parentElement.appendChild(this._frame.frame);
    }
    this._frame.go(targetUrl);
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
  return engines[key] || uv;
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
