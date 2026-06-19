// Scramjet v2 transport adapter. Uses EpoxyTransport directly (the same
// WASM-backed transport that bare-mux loads in its SharedWorker).
// The Scramjet Controller expects:
//   transport.request(url, method, body, headers, signal) => [Response, [transfers]]
//   transport.connect(url, protocols, requestHeaders, onOpen, onData, onClose, onError) => [send, close]

let epoxyTransport = null;
let epoxyReady = null;

async function getEpoxyTransport() {
  if (epoxyTransport) return epoxyTransport;
  if (!epoxyReady) {
    epoxyReady = (async () => {
      const mod = await import("/epoxy/index.mjs");
      const EpoxyTransport = mod.default;
      const proto = location.protocol === "https:" ? "wss" : "ws";
      const wispUrl = proto + "://" + location.host + "/wisp/";
      // EpoxyTransport is a class — must use new
      epoxyTransport = new EpoxyTransport({ wisp: wispUrl });
      await epoxyTransport.init();
    })();
  }
  await epoxyReady;
  return epoxyTransport;
}

export async function createScramjetTransport() {
  const transport = await getEpoxyTransport();

  return {
    async request(url, method, body, headers, signal) {
      const target = typeof url === "string" ? url : url.href;
      const resp = await transport.request(target, method || "GET", body || null, headers || [], signal);
      // Controller expects [Response, [transfers]]
      return [resp, resp?.body instanceof ReadableStream ? [resp.body] : []];
    },

    connect(url, protocols, requestHeaders, onOpen, onData, onClose, onError) {
      const target = typeof url === "string" ? url : url.href;
      try {
        transport.connect(
          target,
          protocols || [],
          requestHeaders || [],
          onOpen,
          onData,
          onClose,
          onError
        );
      } catch (err) {
        onError(err.message);
      }
      // Return noop send/close — EpoxyTransport's connect manages the lifecycle
      return [() => {}, () => {}];
    },
  };
}

// Load an IIFE script and resolve when loaded
export function loadClassicScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = src;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("Failed to load " + src));
    document.head.appendChild(s);
  });
}

// Lifecycle-aware SW registration (from Tinf0il)
export async function registerSw(path) {
  const reg = await navigator.serviceWorker.register(path, {
    scope: "/",
    type: "classic",
    updateViaCache: "none",
  });
  await navigator.serviceWorker.ready;
  if (reg.active) return reg.active;
  if (reg.installing) {
    return new Promise((resolve) => {
      reg.installing.addEventListener("statechange", function fn() {
        if (reg.installing.state === "activated") {
          reg.installing.removeEventListener("statechange", fn);
          resolve(reg.active);
        }
      });
    });
  }
  if (reg.waiting) {
    reg.waiting.postMessage({ type: "SKIP_WAITING" });
    return new Promise((resolve) => {
      navigator.serviceWorker.addEventListener("controllerchange",
        () => resolve(navigator.serviceWorker.controller),
        { once: true }
      );
    });
  }
  return reg.active;
}
