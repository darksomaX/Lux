// Scramjet v2 transport adapter. Wraps the Epoxy transport (used by bare-mux)
// into the Scramjet Controller's expected transport interface.
// The controller expects:
//   transport.request(url, method, body, headers, signal) => [Response, [transfers]]
//   transport.connect(url, protocols, requestHeaders, onOpen, onData, onClose, onError) => [send, close]

let epoxyClient = null;
let epoxyReady = null;

async function getEpoxyClient() {
  if (epoxyClient) return epoxyClient;
  if (!epoxyReady) {
    epoxyReady = (async () => {
      const mod = await import("/epoxy/index.mjs");
      const proto = location.protocol === "https:" ? "wss" : "ws";
      const wispUrl = proto + "://" + location.host + "/wisp/";
      epoxyClient = mod.default({ wisp: wispUrl });
      await epoxyClient.ready;
    })();
  }
  await epoxyReady;
  return epoxyClient;
}

export async function createScramjetTransport() {
  const client = await getEpoxyClient();

  return {
    async request(url, method, body, headers, signal) {
      // Normalize URL to string
      const target = typeof url === "string" ? url : url.href;
      const hdrs = {};
      if (headers) {
        for (const [k, v] of headers) hdrs[k] = v;
      }
      const resp = await client.request(target, {
        method: method || "GET",
        headers: hdrs,
        body: body || null,
        signal,
      });
      return [resp, resp.body instanceof ReadableStream ? [resp.body] : []];
    },

    connect(url, protocols, requestHeaders, onOpen, onData, onClose, onError) {
      let ws = null;
      let closed = false;

      const target = typeof url === "string" ? url : url.href;

      try {
        ws = client.connect(target);
      } catch (err) {
        onError(err.message);
        return [() => {}, () => {}];
      }

      ws.addEventListener("open", () => {
        if (!closed) onOpen(ws.protocol || "", []);
      });
      ws.addEventListener("message", (e) => {
        if (!closed) onData(e.data);
      });
      ws.addEventListener("close", (e) => {
        closed = true;
        onClose(e.code || 1000, e.reason || "");
      });
      ws.addEventListener("error", (e) => {
        if (!closed) onError(e.message || "WebSocket error");
      });

      const send = (data) => { try { ws.send(data); } catch {} };
      const close = (code, reason) => { closed = true; try { ws.close(code, reason); } catch {} };

      return [send, close];
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
