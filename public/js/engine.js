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

// ---- Scramjet (optional, currently disabled) ------------------------------
// Scramjet is wired but NOT verified end to end. Two blockers were found by
// browser testing:
//   1. @mercuryworkshop/libcurl-transport does not ship its wasm in the npm
//      package, so the transport loads but fails at wasm init (500).
//   2. Two root-scoped service workers (UV's and Scramjet's) cannot reliably
//      coexist; switching engines races on SW registration.
// Epoxy works for UV but Scramjet's SW still does not intercept /scramjet/*
// reliably. Rather than ship a silently-failing option, Scramjet is marked
// unavailable in the UI until these are resolved. UV is the verified engine.

const scramjet = {
  name: "scramjet",
  label: "Scramjet (unavailable)",
  available: false,

  _controller: null,
  _frame: null,

  async init() {
    // Lazy-load Scramjet only when this engine is selected. Use scramjet.all.js
    // (the classic IIFE build that sets globalThis.$scramjetLoadController),
    // NOT scramjet.bundle.js (the ESM build whose `export` throws when loaded
    // as a classic script — that was the source of the export console warning).
    if (typeof $scramjetLoadController !== "function") {
      await loadScript("/scramjet/scramjet.all.js");
      if (typeof $scramjetLoadController !== "function") {
        throw new Error("Scramjet bundle failed to load.");
      }
    }
    // Register the Scramjet service worker at scope "/" so it can intercept
    // the proxied paths. The server serves it at /sj.sw.js with
    // Service-Worker-Allowed: /. Unregister any other root-scoped SW (e.g.
    // UV's) first, since two root-scoped SWs cannot coexist.
    if ("serviceWorker" in navigator) {
      const existing = await navigator.serviceWorker.getRegistrations();
      for (const reg of existing) {
        if (reg.scope.endsWith("/")) await reg.unregister();
      }
      await navigator.serviceWorker.register("/sj.sw.js", { scope: "/" });
      await navigator.serviceWorker.ready;
    }
    if (!this._controller) {
      const { ScramjetController } = $scramjetLoadController();
      this._controller = new ScramjetController({
        files: {
          wasm: "/scramjet/scramjet.wasm.wasm",
          all: "/scramjet/scramjet.all.js",
          sync: "/scramjet/scramjet.sync.js",
        },
      });
      await this._controller.init();
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
