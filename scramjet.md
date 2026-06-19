# Scramjet v2 Integration — Complete Architecture & Findings

## What is Scramjet?

Scramjet is an interception-based web proxy (alternative to Ultraviolet) from
[Mercury Workshop](https://github.com/MercuryWorkshop). Unlike UV which uses a
bare-bones service-worker + config approach, Scramjet has a multi-layer
architecture: a WASM-powered rewriter, a client-side DOM interception layer,
cookie emulation, and a controller-based frame management system.

**Docs**: https://mercuryworkshop-scramjet.mintlify.app/
**Reference app**: https://github.com/MercuryWorkshop/Scramjet-App
**Latest runtime**: https://scramjet.mercurywork.shop/
**Alternative implementation**: https://github.com/Aluminum-Depot/Tinf0il

---

## Core Components

### 1. Service Worker Layer (`ScramjetServiceWorker`)

The heart of Scramjet's interception. It:
- Intercepts all fetch requests via the Service Worker API
- Decodes proxied URLs back to real destination URLs
- Fetches content using a transport layer (BareClient / Epoxy / libcurl)
- Rewrites responses (HTML, JS, CSS) before returning them
- Manages cookies through an emulated cookie store

### 2. Client Layer (`ScramjetClient`)

Runs in each proxied page (window or worker). It:
- Intercepts DOM APIs and JavaScript APIs to rewrite URLs
- Maintains a reference to the real URL of the current page
- Handles navigation events and URL changes
- Injected into every HTML document via `<script>` tags in `<head>`

### 3. Controller Layer (`ScramjetController`)

High-level API from `@mercuryworkshop/scramjet-controller`. It:
- Stores configuration in IndexedDB for persistence
- Provides `encodeUrl()` / `decodeUrl()` methods
- Creates `ScramjetFrame` instances for iframe management
- Dispatches global events like downloads
- Manages cookie sync between the SW and page via RPC (MessageChannel)

### 4. Frame Abstraction (`ScramjetFrame`)

`controller.createFrame(existingIframe)` wraps an iframe. It:
- Sets up automatic frame name generation for internal tracking
- Provides `frame.go(url)` for navigation
- Exposes the `ScramjetClient` instance for the iframe
- Dispatches `urlchange` events

### 5. WASM Rewriter

Scramjet ships a Rust-based WASM rewriter for high-performance JS/CSS/HTML
transformation. The `.wasm` file is ~2MB and must be served with MIME type
`application/wasm`. The runtime can also bundle WASM inline (scramjet_bundled.js).

---

## Package Structure

### npm Packages

| Package | Version | Purpose |
|---------|---------|---------|
| `@mercuryworkshop/scramjet` | `2.0.67-alpha.1` | Core runtime (page-side IIFE) |
| `@mercuryworkshop/scramjet-controller` | `0.0.13` | Controller + Frame management |
| `@mercuryworkshop/bare-mux` | `^2.1.9` | Transport multiplexer (SharedWorker) |
| `@mercuryworkshop/epoxy-transport` | `^2.1.3` | HTTP/WS transport via WASM |
| `@mercuryworkshop/epoxy-tls` | `^2.1.19-1` | TLS for Epoxy |

### V2 vs V1

**`@mercuryworkshop/scramjet` v1.x** (latest stable: 1.1.0):
- Files: `scramjet.bundle.js`, `scramjet.all.js`, `scramjet.wasm.wasm`, `scramjet.sync.js`
- Global: `$scramjetLoadController()`, `$scramjetLoadWorker()`, `self.$scramjet`
- v1 has `scramjet.all.js` (for SW importScripts) and `scramjet.bundle.js` (for pages)

**`@mercuryworkshop/scramjet` v2.x** (latest alpha: 2.0.67-alpha.1):
- Files: `scramjet.js`, `scramjet_bundled.js`, `scramjet.mjs`, `scramjet_bundled.mjs`, `scramjet.wasm`
- Global: `self.$scramjet` (set by IIFE), NO `$scramjetLoadController()` or `$scramjetLoadWorker()`
- **CRITICAL**: v2 does NOT export `$scramjetLoadWorker()` — the factory functions described in
  the Mintlify docs do NOT exist in any published version of the v2 package.
  The docs appear to describe an unreleased/planned API.
- `scramjet_bundled.js` is self-contained (WASM inlined via base64)
- `scramjet-external.mjs` re-exports from `globalThis.$scramjet`

### Controller Package

`@mercuryworkshop/scramjet-controller`:
- Requires `@mercuryworkshop/scramjet` as a peer dependency (any version)
- Built against scramjet `2.0.67-alpha.1` internally
- Provides `controller.api.js` (IIFE that sets `globalThis.$scramjetController`)
- Provides `controller.sw.js` (RPC-based service worker)
- Provides `controller.inject.js` (injected into proxied pages)
- Provides `controller-external.mjs` (ESM re-export wrapper for bundlers)

---

## How the Controller RPC System Works

This was the most challenging part to understand. The controller package
establishes a bi-directional MessageChannel between the page and the SW:

```
Page Controller                          Service Worker
  │                                         │
  ├─ create MessageChannel                  │
  ├─ send port2 + $controller$init ────────>│
  │                                         ├─ create ControllerServer
  │                                         ├─ store prefix + id
  │                                         ├─ send "ready" via RPC
  │  <────── $controller$ready ─────────────┤
  │                                         │
  │  [User navigates iframe]                │
  │  iframe.src = /~/sj/{id}/{frameId}/url  │
  │                                         │
  │  [SW intercepts fetch]                  │
  │  ── fetch /~/sj/{id}/{frameId}/url ────>│
  │                                         ├─ find controller by prefix
  │                                         ├─ rpc.call("request", ...) ──>│
  │  <── RPC response with body ────────────┤
  │  ── Response(body) ─────────────────────>│
```

### The MessagePort Bug

The `controller.sw.js` uses `ServiceWorker.postMessage()` to receive the
`$controller$init` message. The page sends:

```js
serviceworker.postMessage(
  { $controller$init: { prefix, id } },
  [messageChannel.port2]
);
```

**This works** — `controller.wait()` resolves, meaning the SW received the
message and sent "ready" back. However, the SW's `route()` function fails
to find the controller when processing fetch events because:

1. The controllers array `i` is a local variable inside the IIFE closure
2. The `message` event handler and `fetch` event handler both close over `i`
3. Despite `wait()` resolving, the fetch handler can't find the controller

**Root cause**: Not fully determined. The most likely cause is that the
`ServiceWorker.postMessage()` call transfers the MessagePort, but the SW
processes it asynchronously. By the time the fetch arrives, the controller
might not be fully registered in the SW's internal state. The 100ms timeout
for the `$controller$swrevive` message suggests the developers knew about
timing issues.

**Workaround**: Server-side proxy. Instead of routing through the SW, the
engine sets `iframe.src` to a server endpoint (`/sj-proxy?url=...`) that
fetches the URL server-side and returns the response. This completely
bypasses the SW interception layer.

---

## Current Lux Implementation (Server-Proxy Approach)

### Architecture

```
User types URL → normalizeUrl() → engine.encode(url)
  → iframe.src = "/sj-proxy?url=" + encodeURIComponent(url)
  → Server receives request at /sj-proxy
  → Server fetch()'s the real URL
  → Server strips content-encoding (Node auto-decompresses)
  → Server injects <base href="..."> tag into HTML
  → Server returns response to iframe
```

### Files

| File | Role |
|------|------|
| `public/js/engine.js` | Engine abstraction: `init()`, `encode()`, `mount()` |
| | UV: Registers UV SW, uses UV encoding for `/s/` prefix |
| | Scramjet v2: Unregisters UV SW, uses `/sj-proxy?url=` |
| `server/index.js` | `/sj-proxy` endpoint: server-side URL fetching |
| | `fetch()` with redirect-follow, header forwarding, `<base>` injection |
| | Strips `content-encoding` since Node auto-decompresses |
| | Strips `content-security-policy` to allow iframe rendering |
| `public/scramjet/sw.js` | Minimal pass-through SW (no interception needed) |
| `public/js/iframe-watch.js` | Polls for nested iframes; skips `/sj-proxy?` URLs |

### Header Forwarding Gotchas

When proxying through the server, these headers MUST be stripped:

- **`content-encoding`**: Node.js's `fetch()` auto-decompresses brotli/gzip,
  but the header is forwarded. The browser then tries to decompress again,
  corrupting the response.
- **`content-length`**: The injected `<base>` tag changes the body length.
- **`content-security-policy`**: Blocks iframe rendering if it doesn't allow
  the proxy origin.
- **`transfer-encoding`**, **`connection`**, **`keep-alive`**: Hop-by-hop
  headers that don't apply to the forwarded response.

---

## Bugs Found & Fixed

### Bug 1: bare-mux SharedWorker MessagePort (CRITICAL)
- **Error**: `uv.sw.js:85 bare-mux: failed to get a bare-mux SharedWorker
  MessagePort as all clients returned an invalid MessagePort.`
- **Root cause**: When the UV SW claims the page after registration, the
  bare-mux MessagePort from the previous page context is invalidated.
- **Fix**: In `uv.init()`, after `waitForController("uv.sw.js")`, re-set
  the transport via `setTransport()`.

### Bug 2: Scramjet v2 controller.api.js expects runtime (CRITICAL)
- **Error**: `Cannot destructure property 'BareResponse' of
  'globalThis.$scramjet' as it is undefined.`
- **Root cause**: `controller.api.js` module 423 destructures ALL exports
  from `globalThis.$scramjet`. If the runtime isn't loaded first (or if
  `globalThis.$scramjet = BareMux` is set incorrectly), every destructured
  variable becomes `undefined`, causing `Cannot read properties of undefined
  (reading 'flags')`.
- **Fix**: Load `scramjet.js` IIFE (sets `self.$scramjet`) BEFORE loading
  `controller.api.js`. Never set `$scramjet = BareMux`.

### Bug 3: SW reportRequest null body
- **Error**: `uv.sw.js:174 Response with null body status cannot have body`
- **Root cause**: `reportRequest()` calls `resp.text()` on 204 No Content
  responses.
- **Fix**: In `build-uv.mjs`, added `resp.status === 204 || resp.status ===
  304 || !resp.body` check before `resp.text()`.

### Bug 4: info.js screen TDZ
- **Error**: `info.js:116 Cannot access 'screen' before initialization`
- **Root cause**: `const screen = screen.width + ...` shadows the global
  `window.screen`.
- **Fix**: Renamed to `const screenInfo`.

### Bug 5: waitForController marker collision
- **Root cause**: `waitForController("sw.js")` matches BOTH `/uv.sw.js` AND
  `/sj.sw.js`. The UV SW could match the scramjet marker and vice versa.
- **Fix**: Use specific markers: `"uv.sw.js"` for UV, `"/sj.sw.js"` for
  scramjet.

### Bug 6: iFrame-watch infinite recursion with Scramjet
- **Root cause**: When Scramjet creates a frame and navigates, the iframe-watch
  detects the new iframe and calls `navigateNewTab(src)`, creating another tab
  → another iframe → another detection → infinite loop.
- **Fix**: Skip Scramjet-prefixed URLs (`/~/sj/`, `/scramjet/`, `/sj-proxy?`)
  in iframe-watch.js.

### Bug 7: content-encoding forwarded from server proxy
- **Root cause**: Node's `fetch()` auto-decompresses brotli, but the
  `content-encoding: br` header is forwarded. The browser tries to decompress
  the already-decompressed body, corrupting it.
- **Fix**: Strip `content-encoding` and `content-length` from proxy responses.

### Bug 8: Settings cache staleness
- **Root cause**: `loadSettings()` caches the result. If localStorage is
  modified externally (e.g., by another tab), the cache returns stale data.
- **Fix**: Clear cache on `saveSettings()` — already done.

### Bug 9: SW fetch() fails for external URLs
- **Root cause**: When a SW calls `fetch('https://example.com')`, it fails
  with "Failed to fetch". This appears to be a mixed-content or CORS issue
  specific to localhost-origin SWs trying to fetch HTTPS URLs.
- **Workaround**: Proxy all fetches through the server's `/sj-proxy` endpoint
  instead of making external fetches from the SW.

### Bug 10: Dynamic import causes "missing ) after argument list"
- **Root cause**: Using `import()` in an `agent-browser eval` context with
  certain argument formats causes SyntaxError due to the eval wrapper.
- **Fix**: Use `var` or `function` wrappers instead of arrow functions with
  destructuring in eval strings.

---

## How the Runtimes Export Their APIs

### `scramjet.js` (v2, page-side IIFE)
```
Last line: self.$scramjet = h
Exports (via self.$scramjet):
  BareResponse, CookieJar, IncrementalHtmlRewriter, Plugin,
  SCRAMJETCLIENT, SCRAMJETCLIENTNAME, ScramjetClient,
  ScramjetFetchHandler, ScramjetFetchTrackedClient, ScramjetHeaders,
  Tap, createLocationProxy, defaultConfig, defaultConfigDev,
  flagEnabled, getOwnPropertyDescriptorHandler, getRewriter,
  htmlRules, isArchiveMimeType, isAudioOrVideoMimeType,
  isFontMimeType, isHtmlMimeType, isImageMimeType,
  isInlineDisplayableMimeType, isJavascriptMimeType,
  isJavascriptMimeTypeEssenceMatch, isModuleScriptType,
  isScriptType, isScriptableMimeType, isXmlMimeType,
  isZipBasedMimeType, isdedicated, isshared, issw, iswindow,
  isworker, parseMimeType, rewriteBlob, rewriteCss, rewriteHtml,
  rewriteJs, rewriteJsInner, rewriteSrcset, rewriteUrl,
  rewriteWorkers, setWasm, unrewriteBlob, unrewriteCss,
  unrewriteHtml, unrewriteUrl, versionInfo
```

### `controller.api.js` (v2 controller IIFE)
```
Exports (via globalThis.$scramjetController):
  Controller, Frame, ManagedPlugin, VERSION,
  assertRuntimeScramjetVersion, config
```

### `scramjet-external.mjs` (v2 ESM wrapper)
```js
const __external = globalThis.$scramjet;
export const { ... } = __external;
```

### `controller-external.mjs` (controller ESM wrapper)
```js
const __external = globalThis.$scramjetController;
export const { ... } = __external;
```

---

## Transport Integration Options

### Option 1: Through bare-mux SharedWorker (UV's approach)
- `BareMuxConnection.setTransport("/epoxy/index.mjs", [{ wisp: url }])`
- Creates a SharedWorker that handles all HTTP/WS traffic
- `BareClient` wraps the SharedWorker communication
- Both UV and Scramjet can share the same transport
- **Pro**: Proven, works with UV
- **Con**: SharedWorker adds complexity, port management

### Option 2: Direct EpoxyTransport
- Import `EpoxyTransport` from `/epoxy/index.mjs`
- Instantiate directly: `new EpoxyTransport(); await t.init();`
- No SharedWorker needed
- **Pro**: Simpler, direct control
- **Con**: No shared worker buffering

### Option 3: Server-side proxy (current implementation)
- Server fetches URLs on behalf of the client
- No SW interception, no WASM transport needed
- **Pro**: Simplest to debug, works reliably
- **Con**: Server bandwidth doubles (fetch + serve), no client-side rewriting

---

## Service Worker Registration Patterns

### Two root-scoped SWs cannot coexist
UV and Scramjet both register at scope `/`. Only one can control the page.
When switching engines:
1. Unregister the old engine's SW
2. Register the new engine's SW
3. Wait for `.controllerchange` event
4. Re-set the transport (bare-mux port invalidated)

### SW Lifecycle
```
register() → installing → installed (waiting for old SW to close)
  → activate (skipWaiting() forces this) → controlling (clients.claim())
```

### waitForController() Pattern
```js
function waitForController(marker) {
  if (navigator.serviceWorker.controller?.scriptURL?.includes(marker))
    return;
  navigator.serviceWorker.addEventListener("controllerchange", handler);
  setTimeout(finish, 8000);
}
```

`navigator.serviceWorker.ready` ≠ controlling. Always wait for
`controllerchange` after registration.

---

## Tinf0il Architecture (for reference)

The Aluminum-Depot/Tinf0il repo is the most complete Scramjet implementation
available. From the README and code inspection:

- **Server**: Uses bare-mux + epoxy-transport + wisp-js
- **Frontend**: Tabbed browsing with Chrome-style tab strip
- **Apps**: TV, games, chatroom as separate browser windows/tabs
- **Scramjet integration**: Uses the full controller package with proper
  SW communication
- **Build**: Copies scramjet + controller + baremux + epoxy files to `public/`
  similar to Lux's build-uv.mjs

---

## Recommendations for Full Scramjet v2 Integration

To move from the server-proxy approach to full Scramjet v2:

1. **Fix the SW RPC communication**: The `controller.api.js` + `controller.sw.js`
   RPC system works in principle (wait() resolves) but the fetch routing fails.
   Debug by logging in the SW's fetch handler to see if controllers are found.

2. **Use `scramjet_bundled.js` for the SW**: Loads WASM inline, no separate
   WASM fetch needed. Use `self.$scramjet.ScramjetServiceWorker` directly
   instead of `$scramjetLoadWorker()`.

3. **Transport via bare-mux**: The controller's `transport` object needs a
   `{ request(url, method, body, headers) → [Response, Transferable[]] }`
   interface. `BareClient.fetch()` returns a Response-like object that can
   be adapted.

4. **Controller config structure**:
   ```js
   new Controller({
     config: {
       prefix: "/~/sj/",
       scramjetPath: "/scramjet/scramjet.js",
       injectPath: "/scramjet/controller.inject.js",
       wasmPath: "/scramjet/scramjet.wasm",
       codec: { encode: encodeURIComponent, decode: decodeURIComponent }
     },
     scramjetConfig: {
       flags: { allowFailedIntercepts: true, captureErrors: true,
                strictRewrites: true }
     },
     serviceworker: reg.active,
     transport: transportAdapter
   })
   ```

5. **The random controller ID**: The controller generates a random 8-char ID.
   The full prefix becomes `/~sj/{controllerId}/`. Frames add another random
   ID: `/~sj/{controllerId}/{frameId}/`. The SW matches by controller prefix.

---

## Key Lessons Learned

1. `self.$scramjet` ≠ `globalThis.$scramjet` in all contexts. In a `<script>`
   tag, `self === window === globalThis`. In a Worker, `self` is the worker
   global. In an ESM module, `self` is `undefined`.

2. `importScripts()` in a SW only works with classic scripts, not ESM modules.

3. ServiceWorker `postMessage()` with MessagePort transfer works, but the
   timing is tricky. The SW might not have its message listener ready.

4. `fetch()` inside a SW for HTTPS URLs from an HTTP origin fails with
   "Failed to fetch" — this is a mixed-content issue. Always proxy through
   the same origin.

5. `navigator.serviceWorker.ready` ≠ the SW controlling THIS page. It just
   means the registration is ready. Always wait for `controllerchange`.

6. The `@mercuryworkshop/scramjet` v2 package DOES NOT have `scramjet.all.js`
   or `$scramjetLoadWorker()`. These exist only in v1 and in the (possibly
   unreleased) documentation.

7. Node.js's `fetch()` auto-decompresses brotli/gzip, but forwards the
   `content-encoding` header. Always strip it when proxying.
