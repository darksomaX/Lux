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

// ---- Scramjet (optional) --------------------------------------------------
// Scramjet ships a controller + a separate service worker. We load its bundle
// lazily and create a frame. Requires libcurl-transport in /libcurl/.

const scramjet = {
  name: "scramjet",
  label: "Scramjet",
  available: typeof $scramjetLoadController === "function" || !!document.querySelector('script[src*="scramjet.bundle"]'),

  _controller: null,
  _frame: null,

  async init() {
    // Lazy-load the Scramjet bundle (900KB) only when this engine is actually
    // selected. It sets globalThis.$scramjetLoadController.
    if (typeof $scramjetLoadController !== "function") {
      await loadScript("/scramjet/scramjet.bundle.js");
      if (typeof $scramjetLoadController !== "function") {
        throw new Error("Scramjet bundle failed to load.");
      }
    }
    // Register the Scramjet service worker at scope "/" so it can intercept
    // the proxied paths. The server serves it at /sj.sw.js with
    // Service-Worker-Allowed: /.
    if ("serviceWorker" in navigator) {
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

let current = null;
export function getEngine() {
  if (current) return current;
  const key = localStorage.getItem("lux.engine") || "uv";
  current = engines[key] || uv;
  return current;
}

export function setEngine(name) {
  if (!engines[name]) throw new Error("Unknown engine: " + name);
  localStorage.setItem("lux.engine", name);
  current = engines[name];
}

export function listEngines() {
  return Object.values(engines).map((e) => ({
    name: e.name,
    label: e.label,
    available: e.available,
  }));
}

export { uv, scramjet };
