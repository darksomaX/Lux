// Scramjet v2 transport. Tinf0il uses the libcurl transport (libcurl-client.js)
// which has the exact interface the Scramjet runtime expects (init, request,
// connect with the right argument formats). The libcurl wasm is embedded in
// the 2.1MB dist/index.js bundle. We load it as a classic script and construct
// the client with the wisp URL.
//
// Previously we tried an Epoxy adapter but it had an impedance mismatch with
// the Scramjet runtime's RPC layer (URLs arrived as undefined). The libcurl
// client is what Scramjet is designed for.

let libcurlClient = null;

async function getLibcurlTransport() {
  if (libcurlClient) return libcurlClient;
  // Load the libcurl client IIFE (sets window.LibcurlTransport).
  await loadClassicScriptInternal("/clients/index.js");
  const proto = location.protocol === "https:" ? "wss" : "ws";
  const wispUrl = proto + "://" + location.host + "/wisp/";
  const LibcurlClient = window.LibcurlTransport?.LibcurlClient;
  if (!LibcurlClient) throw new Error("LibcurlTransport.LibcurlClient not found after loading libcurl");
  libcurlClient = new LibcurlClient({ wisp: wispUrl });
  return libcurlClient;
}

function loadClassicScriptInternal(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = src;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("Failed to load " + src));
    document.head.appendChild(s);
  });
}

export async function createScramjetTransport() {
  const transport = await getLibcurlTransport();
  // The libcurl client already has init/request/connect with the exact
  // signatures Scramjet expects. Pass it through directly.
  return transport;
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
