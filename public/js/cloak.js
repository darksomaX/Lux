// Cloak: about:blank popup, tab disguise, panic key, anti-close.
// Rewritten from the original cloak.js as an ESM module (no window globals
// required; main.js imports what it needs).

const DEFAULT_DECOY = "https://classroom.google.com/";

let disguisesCache = null;
async function loadDisguises() {
  if (disguisesCache) return disguisesCache;
  try {
    const r = await fetch("/cloak/disguises.json");
    disguisesCache = await r.json();
  } catch {
    disguisesCache = {};
  }
  return disguisesCache;
}

export async function openCloaked(targetUrl, encodeFn) {
  const proxied = encodeFn(targetUrl);
  const popup = window.open("", "_blank");
  if (!popup) {
    throw new Error("Popup blocked. Allow popups for this site, then retry.");
  }
  popup.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>Loading</title>
<style>html,body{margin:0;padding:0;height:100%;background:#000;overflow:hidden}iframe{width:100%;height:100%;border:0}</style>
</head><body><iframe src="${proxied}" allow="fullscreen; clipboard-read; clipboard-write; encrypted-media; gamepad; web-share"></iframe></body></html>`);
  popup.document.close();
  return popup;
}

export async function applyDisguise(name) {
  const d = (await loadDisguises())[name];
  if (!d) throw new Error("Unknown disguise: " + name);
  document.title = d.title;
  let link = document.querySelector("link[rel~='icon']");
  if (!link) {
    link = document.createElement("link");
    link.rel = "icon";
    document.head.appendChild(link);
  }
  link.href = d.favicon;
}

export async function listDisguises() {
  return Object.entries(await loadDisguises()).map(([key, v]) => ({ key, ...v }));
}

let panicBound = false;
export function armPanicKey(opts = {}) {
  if (panicBound) return;
  const decoy = opts.decoy || DEFAULT_DECOY;
  const key = opts.key || "Backquote";
  document.addEventListener("keydown", (e) => {
    if (e.code === key) {
      e.preventDefault();
      document.body.innerHTML = "";
      location.replace(decoy);
    }
  });
  panicBound = true;
}

let antiCloseBound = false;
export function enableAntiClose() {
  if (antiCloseBound) return;
  window.addEventListener("beforeunload", (e) => {
    e.preventDefault();
    e.returnValue = "";
    return "";
  });
  antiCloseBound = true;
}
