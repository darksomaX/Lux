# Tinf0il Architecture Analysis

**Repo**: https://github.com/Aluminum-Depot/Tinf0il
**Analyzed**: 2026-06-19

## Overview

Tinf0il is the most complete Scramjet-based proxy app available. It
successfully integrates the full `@mercuryworkshop/scramjet-controller`
package with working SW communication. This document captures what
they do differently from Lux's attempt.

---

## Key Architectural Differences

### 1. SW Registration (`registerSw()`)

Tinf0il's `registerSw()` function handles ALL SW lifecycle states:

```js
function registerSw(path) {
  return navigator.serviceWorker
    .register(path, { type: "classic", updateViaCache: "none" })
    .then(async (registration) => {
      await navigator.serviceWorker.ready;
      if (registration.active) return registration.active;
      if (registration.installing) {
        await new Promise((resolve) => {
          const sw = registration.installing;
          if (sw.state === "activated") resolve();
          else {
            sw.addEventListener("statechange", function onChange() {
              if (sw.state === "activated") {
                sw.removeEventListener("statechange", onChange);
                resolve();
              }
            });
          }
        });
        return registration.active;
      }
      if (registration.waiting) {
        registration.waiting.postMessage({ type: "SKIP_WAITING" });
        await new Promise((resolve) => {
          navigator.serviceWorker.addEventListener(
            "controllerchange", resolve, { once: true }
          );
        });
        return navigator.serviceWorker.controller;
      }
      throw new Error("No service worker found");
    });
}
```

**Key differences from Lux:**
- `type: "classic"` — explicit, even though it's the default
- `updateViaCache: "none"` — Lux uses "all", which can cause stale SW
- Handles `installing` state by listening to `statechange` events
- Handles `waiting` state by sending `SKIP_WAITING` + `controllerchange`
- Uses `{ once: true }` for event listeners (auto-cleanup)
- Returns `registration.active` or `navigator.serviceWorker.controller`

### 2. Controller Init

Tinf0il modifies the controller's DEFAULT config object in-place:

```js
const { Controller, config } = window.$scramjetController;
config.injectPath = "/controller/controller.inject.js";
config.wasmPath = "/scram/scramjet.wasm";
config.scramjetPath = "/scram/scramjet.js";

const controller = new Controller({ serviceworker: sw, transport });
```

**Key insight**: They extract `config` from the module's exports (it's a
mutable object), modify it directly, then DON'T pass `config` to the
Controller constructor. The Controller uses its module-level default
config (`c`), which was modified in-place.

Lux tried to pass `config` as a constructor option, which should have
worked (the Controller deep-merges `t.config` with defaults). The issue
was likely in how the Controller's internal init handles the config.

### 3. Transport

Tinf0il uses **libcurl-client** (not epoxy):

```js
await loadScript("/clients/libcurl-client.js");
const LibcurlCtor = window.LibcurlTransport.LibcurlClient;
const transport = new LibcurlCtor({ wisp: wispWebSocketUrl() });
```

Libcurl requires building WASM from source (emscripten). But they ship
pre-built binaries. Lux uses epoxy-transport which ships its WASM.

The controller's `transport` interface is just `{ request(), connect() }`.
Both libcurl and epoxy can be adapted.

### 4. Frame Management

Tinf0il's `frame()` function:

```js
async function frame(el, url) {
  if (!el || !url) return;
  const controller = await getController();
  let fr = el[FRAME];
  if (!fr) fr = controller.createFrame(el);
  fr.go(url);
}
```

They cache the frame on the element using a Symbol:
```js
const FRAME = Symbol.for("controller frame handle");
```

This prevents creating duplicate frames for the same element.

### 5. SW File

Tinf0il serves the controller package's `controller.sw.js` at `/sw.js`
(with proper Service-Worker-Allowed header). The SW handles all Scramjet
routing via RPC with the page controller.

### 6. Build System

Tinf0il has a `bootstrap-server.js` module that:
- Downloads npm packages at startup
- Copies dist files to appropriate paths
- Handles MIME types
- Starts wisp server

---

## Why Tinf0il's SW Communication Works

The critical difference is in the **SW lifecycle handling**:

1. `registerSw()` waits for the SW to reach `activated` state (not just
   `navigator.serviceWorker.ready`)
2. It returns `registration.active` (the actual active worker)
3. The Controller is created WITH a fully active worker reference
4. `controller.wait()` resolves when the SW confirms readiness via RPC

In Lux, the `waitForController()` function uses a `controllerchange`
event listener that checks if `scriptURL` includes the marker. But the
marker check is flawed — `"sw.js"` matches both UV and Scramjet SWs.

Additionally, Lux's transport might not be properly wired. The controller
needs a working `request()` function to proxy HTTP requests. Without it,
the SW can't serve proxied pages.

---

## How to Fix Lux's Controller Integration

Based on the Tinf0il analysis, here's what needs to change:

### 1. Fix SW Registration

Replace `waitForController()` with a proper lifecycle-aware registration:

```js
async function registerSw(path) {
  const reg = await navigator.serviceWorker.register(path, {
    scope: "/",
    type: "classic",
    updateViaCache: "none",
  });

  await navigator.serviceWorker.ready;

  if (reg.active) return reg.active;
  
  return new Promise((resolve) => {
    if (reg.installing) {
      reg.installing.addEventListener("statechange", function fn() {
        if (reg.installing.state === "activated") {
          reg.installing.removeEventListener("statechange", fn);
          resolve(reg.active);
        }
      });
    } else if (reg.waiting) {
      reg.waiting.postMessage({ type: "SKIP_WAITING" });
      navigator.serviceWorker.addEventListener("controllerchange", () => {
        resolve(navigator.serviceWorker.controller);
      }, { once: true });
    }
  });
}
```

### 2. Modify Controller Config In-Place

```js
const { Controller, config } = globalThis.$scramjetController;
config.prefix = "/~/sj/";
config.injectPath = "/scramjet/controller.inject.js";
config.wasmPath = "/scramjet/scramjet.wasm";
config.scramjetPath = "/scramjet/scramjet.js";
```

### 3. Create Controller Without Config Override

```js
const controller = new Controller({
  serviceworker: sw,
  transport: transportAdapter,
});
await controller.wait();
```

### 4. Use Correct Transport

```js
async function createTransport() {
  const { EpoxyTransport } = await import("/epoxy/index.mjs");
  const proto = location.protocol === "https:" ? "wss" : "ws";
  const wispUrl = proto + "://" + location.host + "/wisp/";
  const transport = new EpoxyTransport([{ wisp: wispUrl }]);
  await transport.init();
  return transport;
}
```

Note: `EpoxyTransport` from epoxy-transport implements the bare-mux
`BareTransport` interface, which the controller expects. If the
interface doesn't match exactly, a small adapter is needed.

---

## Features Tinf0il Has That Lux Doesn't

| Feature | Tinf0il | Lux |
|---------|---------|-----|
| Full controller SW RPC | ✅ | ❌ (server proxy workaround) |
| Tabbed browsing | ✅ | ✅ |
| Chrome-style tabs | Partial | ✅ |
| Lock screen | ❌ | ✅ |
| Vault/crypto | ❌ | ✅ |
| Rich text editor | ❌ | ✅ |
| TV streaming | ✅ | ❌ |
| Games | ✅ | ✅ (ROM emulator) |
| Chatroom | ✅ | ❌ |
| Cloak/panic | ✅ | ✅ |
| Settings panel | ✅ | ✅ |
| Window manager | ❌ | ✅ |
| Info panel | ❌ | ✅ |

---

## Recommended Next Steps for Full Scramjet v2

1. **Fix the SW registration** using the Tinf0il pattern (lifecycle-aware)
2. **Modify controller config in-place** (not as constructor argument)
3. **Create a proper transport adapter** that wraps `BareClient`
4. **Test the controller SW** (`controller.sw.js`) with new init
5. **If SW RPC still fails**, fall back to the server-proxy approach
   (currently working) while debugging the RPC issue
