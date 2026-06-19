# Lux Development Instructions

**Project**: Self-hostable anti-censorship web proxy
**Location**: C:\Users\santi\Documents\workspace\proxy
**GitHub**: darksomaX/Lux
**Stack**: Node + Express + vanilla ESM frontend, Ultraviolet over wisp + Epoxy
**Status**: v0.4.0-dev

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [Key Files & Their Purposes](#2-key-files--their-purposes)
3. [Current State](#3-current-state)
4. [Known Bugs & Lessons Learned](#4-known-bugs--lessons-learned)
5. [Scramjet v2 Integration](#5-scramjet-v2-integration)
6. [Tinf0il Analysis & Comparison](#6-tinf0il-analysis--comparison)
7. [Remaining Work](#7-remaining-work)
8. [Development Rules](#8-development-rules)

---

## 1. Architecture Overview

Lux is a multi-engine web proxy with a tabbed browsing interface.
Users can switch between **Ultraviolet** (default) and **Scramjet v2**
engines in settings. Both engines proxy through the same wisp WebSocket
backend.

### Core Flow

```
User types URL → normalizeUrl() → engine.encode(url)
  → iframe.src = proxy-path + encoded-url
  → Service Worker intercepts and proxies (UV)
  → OR Server proxy endpoint fetches (Scramjet)
  → Page renders in iframe
```

### Two Engines

**Ultraviolet** (fully working):
- Registers `/uv.sw.js` as root-scoped SW
- Uses UV's XOR encoding (`/s/<encoded>`)
- Proxies through bare-mux SharedWorker → Epoxy WASM → wisp tunnel
- Full HTML/JS/CSS rewriting, ad-block inlined into SW

**Scramjet v2** (server-proxy mode, working):
- Simple server-side proxy via `/sj-proxy?url=...`
- No SW interception needed (pass-through SW at `/sj.sw.js`)
- Server fetches URL, injects `<base>` tag, returns response
- No client-side rewriting (future: full controller integration)

### Page Lifecycle

```
1. HTML loads → CSS renders lock screen or home page
2. Scripts load: uv.bundle.js → uv.config.js → main.js (module)
3. boot() runs: initBackground → initToolbar → initTabStrip →
   initTaskbar → initSettingsUi → initLock → initInfoPanel → ...
4. initTabStrip() creates first "New Tab" tab
5. User types URL → navigate() → Tabs.createTab() / navigateTab()
6. navigateTab() calls mountTab() which calls engine.init() + mount()
7. Engine registers SW (if needed), encodes URL, sets iframe.src
8. SW/proxy fetches real URL, iframe renders content
```

---

## 2. Key Files & Their Purposes

### Server (`server/index.js`)
- Express app with static mounts, wisp WebSocket server
- `/uv.sw.js` serves UV service worker with `Service-Worker-Allowed: /`
- `/sj.sw.js` serves Scramjet service worker (no-cache header)
- `/sj-proxy?url=<encoded>` — Scramjet proxy endpoint (server-side fetch)
  - Strips `content-encoding`, `content-length`, `content-security-policy`
  - Injects `<base href="${target}">` for relative URL resolution
  - Returns clean 404 page for invalid/broken URLs
- Health check at `/health`, stats at `/stats/json`, IP at `/ip`

### Frontend — HTML (`public/index.html`)
- Lock screen (`#lockscreen`) — password create/enter/skip
- Tab strip (`#tab-strip`) — Chrome-style tabs, dynamically rendered
- Browser toolbar (`#browser-toolbar`) — back, forward, reload/stop, URL bar, incognito, new/close
- Viewport (`#tab-viewport`) — contains new-tab page + tab iframes
  - `#new-tab-page` — Lux logo with fade-in animation, URL search input
- Taskbar (`#taskbar`) — app buttons (Browser/Notes/Vault/Games), settings, docs, help, clock
- Panels: settings overlay, docs, editor, vault, games
- Kill switch banner, help tooltip, IP badge
- Reload button SVG: circular arrow (`M21 12a9 9 0 1 1-3-6.7 M21 3v5h-5`)

### Frontend — CSS (`public/css/styles.css`)
- All styles in single file: tabs, toolbar, taskbar, panels, lock screen
- Key selectors:
  - `#tab-viewport iframe` — absolute-positioned, `z-index: 1`
  - `#new-tab-page` — absolute, `z-index: 2` (above iframes), fade-in + float animations
  - `#new-tab-page.hidden` — `display: none`
  - `#browser-toolbar` — fixed toolbar with nav buttons
  - `#taskbar` — fixed bottom bar with frosted glass, auto-hide via `data-taskbar-hide`
  - `.lux-locked` — body class when lock screen active

### Frontend — JS Modules

**`main.js`** — Orchestrator (~620 lines)
- `boot()` — initialization sequence
- `navigate(input)` — normalizes URL, creates/activates tab, calls navigateTab
- `renderTabStrip()` — renders tabs, toggles new-tab page visibility
- `initToolbar()` — wires back/forward/reload/stop/URL/incognito/new/close buttons
- `initTabStrip()` — creates first tab, wires tab event handlers
- `initTaskbar()` — wires app buttons (browser/notes/vault/games), settings/docs/help
- `initSettingsUi()` — builds settings HTML from engine list + settings defaults
- `initBackground()` — night sky star canvas with galaxy rotation
- `applySettingsToDom()` — sets body data attributes for theme/background/chrome

**`tabs.js`** — Tab manager (~256 lines)
- `createTab(url?)` — creates tab with iframe, activates it
- `activateTab(id)` — shows/hides iframes, emits events
- `closeTab(id)` — closes tab, prevents closing last tab (`tabs.length <= 1`)
- `navigateTab(id, url, recordHistory)` — engine init, mount, history management
- `goBack(id)` / `goForward(id)` — history navigation
- `reloadTab(id)` — iframe reload
- Events: `tabCreated`, `tabClosed`, `tabActivated`, `tabUpdated`
- `detectOrphan()` — detects if loaded at bare proxied URL

**`tab-nav.js`** — Engine bridge (~30 lines)
- `encodeForTab(url)` — encodes URL for current engine
- `mountTab(tab, url)` — engine-specific mount (UV sets iframe.src, Scramjet uses init)
- Re-exports: `setTransportFor`, `getEngine`, `buildProxyPath`

**`engine.js`** — Engine abstraction (~180 lines)
- `uv` — Ultraviolet engine object
  - `init()`: unregisters non-UV SWs, registers `/uv.sw.js`, waits for controller, resets transport
  - `encode(url)`: uses `window.__uv$config.encodeUrl()`
  - `mount(targetUrl, iframe)`: calls init(), sets iframe.src
- `scramjet` — Scramjet v2 engine object
  - `init()`: unregisters non-scramjet SWs (no SW registration needed)
  - `encode(url)`: returns `/~/sj/` + encodeURIComponent(url) (note: unused)
  - `mount(targetUrl, iframe)`: calls init(), sets iframe.src to `/sj-proxy?url=...`
- `getEngine()` — reads engine from localStorage, falls back to UV if unavailable
- `listEngines()` — returns engine objects with availability flags

**`transport.js`** — bare-mux transport setup (~45 lines)
- `BareMuxConnection` from `/baremux/index.mjs`
- `setTransport(path, options)` — configures transport in SharedWorker
- `setTransportFor(engineName)` — sets Epoxy over wisp for either engine

**`iframe-watch.js`** — Nested iframe detection (~45 lines)
- Polls viewport every 2s for new iframes
- Skips: `about:blank`, small frames (<50px), Scramjet-prefixed URLs (`/~/sj/`, `/scramjet/`, `/sj-proxy?`)
- Calls `onNested(src)` callback for real nested content frames

**`lock.js`** — Lock screen (~189 lines)
- Create-password flow (first visit) or enter-password flow (returning)
- Skip button for first visit
- `isUnlocked()` checks `!s.lockEnabled || sessionStorage.hasKey`
- `dismiss()` hides lock screen, sets session key
- Idle re-lock timer

**`settings.js`** — Settings storage (~103 lines)
- `DEFAULTS` object with all settings
- `loadSettings()` — reads from localStorage, merges with defaults, caches
- `saveSettings(partial)` — merges, writes, dispatches event
- `resetSettings()` — clears all settings

**`info.js`** — Info panel (~152 lines)
- IP, screen, time, battery, volume slider
- Battery indicator in taskbar
- AudioContext gain node for volume

### Build Script (`scripts/build-uv.mjs`)
- Copies from node_modules to public:
  - `@titaniumnetwork-dev/ultraviolet/dist` → `public/uv/`
  - `@mercuryworkshop/bare-mux/dist` → `public/baremux/`
  - `@mercuryworkshop/epoxy-transport/dist` → `public/epoxy/`
  - `@mercuryworkshop/scramjet/dist` → `public/scramjet/`
  - `@mercuryworkshop/scramjet-controller/dist` → `public/scramjet/` (controller files)
- Rewrites `uv.config.js` paths to `/uv/` prefix
- Makes `uv.sw.js` self-contained: prepends `importScripts`, inlines ad-block filters, appends fetch handler

### Reference Documents
- `scramjet.md` — Complete Scramjet v2 architecture, package analysis, bugs, findings
- `tinf0il-analysis.md` — Tinf0il architecture comparison
- `HANDFOFF.md` — Current state, QA results, issues

---

## 3. Current State

### What Works
- **Ultraviolet engine**: Full proxy support (Example Domain, Google search, etc.)
- **Scramjet v2 engine**: Server-proxy approach works (Example Domain renders)
- **Lock screen**: Create-password, skip, enter-password, reset
- **Tab strip**: Chrome-style tabs, create/activate/close, drag reorder
- **Browser toolbar**: Back/forward (dimmed when no history), reload/stop toggle, URL omnibox, incognito, new/close
- **New-tab page**: Lux logo with fade-in + float animation, URL search input
- **Taskbar**: App buttons (Browser/Notes/Vault/Games), settings/docs/help icons, clock, battery
- **Settings**: All toggles, engine switcher (UV default, Scramjet v2 available)
- **Info panel**: IP, screen, time, battery, volume slider
- **TipTap editor**: Rich text editing with formatting toolbar
- **Night sky**: Galaxy spin animation
- **Iframe-watch**: Nested iframe detection (skips Scramjet prefixes)
- **Kill switch**: Network change detection
- **Vault**: Encrypted IndexedDB storage
- **45/45 tests pass**

### What's Partially Working
- **Window manager (wm.js)**: Windows are created but dragging is broken (event handler issues)
- **Editor**: TipTap loaded via CDN, works but no document management
- **Games**: ROM picker exists but no actual emulator loading
- **DevTools panel**: SW reports requests but panel UI needs wiring
- **Cloak**: about:blank popup works, panic key works

### What's Broken / Missing
- **Window drag**: `wm.js` mousedown/mousemove/mouseup handlers not working
- **Browser as window**: Browser should open as a draggable window like other apps
- **TV / Live tabs**: Not implemented
- **Game tab improvements**: Tinf0il has a full games page with categories
- **Chatroom**: Not implemented
- **Full Scramjet controller integration**: SW RPC communication not working (server-proxy workaround in place)

---

## 4. Known Bugs & Lessons Learned

### Critical Bugs Fixed

1. **bare-mux MessagePort invalidated** — Transport must be re-set after SW claims page
2. **controller.api.js expects runtime** — Load `scramjet.js` IIFE BEFORE `controller.api.js`
3. **reportRequest null body** — Check for 204/304/null-body before `resp.text()`
4. **info.js screen TDZ** — Rename `const screen` to `const screenInfo`
5. **waitForController marker collision** — Use specific markers (`/sj.sw.js`, not `sw.js`)
6. **iframe-watch infinite recursion** — Skip Scramjet-prefixed URLs
7. **content-encoding forwarded** — Strip `content-encoding` from proxy responses
8. **Settings cache staleness** — Clear cache on `saveSettings()`
9. **SW fetch() fails for HTTPS** — Always proxy through same-origin server endpoint
10. **Logo covered by iframe** — Set `#new-tab-page { z-index: 2 }`, iframes `z-index: 1`

### Lessons Learned

1. `self.$scramjet` ≠ `globalThis.$scramjet` in all contexts
2. `navigator.serviceWorker.ready` ≠ controlling — wait for `controllerchange`
3. Two root-scoped SWs cannot coexist — unregister before registering new
4. `importScripts()` only works with classic scripts, not ESM modules
5. `fetch()` inside SW for HTTPS from HTTP origin fails ("Failed to fetch")
6. Node's `fetch()` auto-decompresses but forwards `content-encoding` header
7. `getEngine()` must NOT cache — settings change engine at runtime
8. bare-mux exports `BareMuxConnection` as named ESM export, not `window.BareMux`
9. Filters use ESM export keywords — strip them before inlining into classic SW
10. jsdom cannot run modules or SWs — always use agent-browser/Playwright

---

## 5. Scramjet v2 Integration

### Current Implementation (Server-Proxy Mode)

Scramjet v2 is wired as a simple server-side proxy:

```
engine.js → mount() sets iframe.src = "/sj-proxy?url=" + encodeURIComponent(url)
         → Server /sj-proxy endpoint fetch()'s the URL
         → Injects <base href> tag
         → Strips content-encoding, CSP, content-length headers
         → Returns response to iframe
```

This works but lacks client-side rewriting (HTML/JS/CSS). The
`@mercuryworkshop/scramjet` v2 runtime (`scramjet.js`) is available
at `/scramjet/scramjet.js` for future integration.

### Full Controller Integration (Not Working — Needs Fix)

The `@mercuryworkshop/scramjet-controller` package provides proper
page↔SW communication for full Scramjet proxying. See `scramjet.md`
for complete architecture details.

**The blocking issue**: The controller's `controller.sw.js` RPC
communication works (`controller.wait()` resolves), but the SW's
fetch handler can't find the registered controller when processing
requests. The controller sends `$controller$init` via MessagePort,
the SW responds "ready", but subsequent fetch events don't match
the controller prefix.

**Tinf0il's approach that might fix this** (see `tinf0il-analysis.md`):

```js
// Proper SW lifecycle registration
async function registerSw(path) {
  const reg = await navigator.serviceWorker.register(path, {
    scope: "/", type: "classic", updateViaCache: "none",
  });
  await navigator.serviceWorker.ready;
  if (reg.active) return reg.active;
  // Handle installing state
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
  // Handle waiting state
  if (reg.waiting) {
    reg.waiting.postMessage({ type: "SKIP_WAITING" });
    return new Promise((resolve) => {
      navigator.serviceWorker.addEventListener("controllerchange",
        () => resolve(navigator.serviceWorker.controller),
        { once: true }
      );
    });
  }
}

// Modify controller default config IN-PLACE (not as constructor arg)
const { Controller, config } = globalThis.$scramjetController;
config.prefix = "/~/sj/";
config.injectPath = "/scramjet/controller.inject.js";
config.wasmPath = "/scramjet/scramjet.wasm";
config.scramjetPath = "/scramjet/scramjet.js";

// Create controller without config override
const controller = new Controller({
  serviceworker: sw,
  transport: transportAdapter,
});
await controller.wait();
```

### Required Packages

| Package | Version | Status |
|---------|---------|--------|
| `@mercuryworkshop/scramjet` | `2.0.67-alpha.1` | ✅ Installed |
| `@mercuryworkshop/scramjet-controller` | `0.0.13` | ✅ Installed |
| `@mercuryworkshop/bare-mux` | `^2.1.9` | ✅ Installed |
| `@mercuryworkshop/epoxy-transport` | `^2.1.3` | ✅ Installed |
| `@mercuryworkshop/epoxy-tls` | `^2.1.19-1` | ✅ Installed |

### V2 Package Files

After `npm run build`, the following are available at `/scramjet/`:

- `scramjet.js` — Page-side IIFE, sets `self.$scramjet`
- `scramjet_bundled.js` — Self-contained (WASM inlined), for SW importScripts
- `scramjet.wasm` — WASM rewriter binary (2MB)
- `controller.api.js` — Controller IIFE, sets `globalThis.$scramjetController`
- `controller.inject.js` — Injected into proxied pages
- `controller.sw.js` — RPC-based service worker
- `sw.js` — Copy of controller.sw.js for Lux (served at `/sj.sw.js`)

---

## 6. Tinf0il Analysis & Comparison

**Repo**: https://github.com/Aluminum-Depot/Tinf0il

### Architecture Differences

| Aspect | Lux | Tinf0il |
|--------|-----|---------|
| **SW registration** | `waitForController()` | Lifecycle-aware `registerSw()` |
| **SW cache** | `updateViaCache: "all"` | `updateViaCache: "none"` |
| **Controller init** | Passes `config` as constructor arg | Modifies module defaults in-place |
| **Transport** | Epoxy via bare-mux | Libcurl client (WASM) |
| **Proxy engine** | UV (default) + Scramjet v2 | Scramjet only |
| **Apps** | Notes, Vault, Games (ROM) | TV, Games (3kh0), Chatroom |
| **Lock screen** | ✅ Create-password flow | ❌ None |
| **Tab strip** | ✅ Chrome-style | Partial |
| **Window manager** | ✅ (broken drag) | ❌ |

### What Tinf0il Does Better

1. **SW lifecycle management** — Their `registerSw()` handles ALL states
   (installing, waiting, active) with proper event cleanup. Lux's
   `waitForController()` is simpler but misses edge cases.

2. **Controller config** — Modifying the module's default config in-place
   is cleaner than passing as constructor argument. Both should work,
   but in-place mutation avoids deep-merge issues.

3. **Transport** — They use libcurl-client directly (instantiated on the
   page), not through bare-mux's SharedWorker. This avoids the MessagePort
   invalidation issue entirely.

4. **TV streaming** — Full TV app with proxy for sports/live content
5. **Games** — Categories, 3kh0 game library integration
6. **Chatroom** — Real-time chat

### What Lux Does Better

1. **UV engine** — Full proxy support with ad-block
2. **Lock screen** — Password create/enter/skip with reset
3. **Window manager** — Draggable/resizable windows (even with broken drag)
4. **Info panel** — IP, screen, time, battery, volume
5. **Settings** — Full settings panel with many toggles
6. **Vault** — Encrypted IndexedDB storage
7. **Night sky animation** — Galaxy spin
8. **TipTap editor** — Rich text editing

### How to Add Tinf0il's Features to Lux

#### TV / Live Tab

Tinf0il has a `movieverse` subdirectory with a Next.js app that provides
TV streaming. They proxy requests through:

```
/api/tv-proxy?url=<target-url>
```

Features:
- Headers are mapped: `x-cookie` → `cookie`, `x-referer` → `referer`, etc.
- Response headers are cleaned (strips `content-encoding`, `content-length`, etc.)
- Separate Next.js app runs on port 8791

To add to Lux:
1. Create a TV page/panel (similar to existing panel-full sections)
2. Add a server proxy endpoint for TV content (mirror Tinf0il's `/api/tv-proxy`)
3. Add a "Live" button to the taskbar that opens the TV panel
4. Embed the TV app in an iframe or window

#### Games Tab

Tinf0il's games are powered by 3kh0 (https://3kh0v2.github.io/). They:
- Scrape game data from 3kh0's API
- Build a local game catalog (`public/data/3kh0-games.js`)
- Display games in a grid with categories
- Games open in iframes or new tabs

To add to Lux:
1. Create a games browser page (replace the current ROM picker)
2. Integrate with 3kh0 game catalog or embed
3. Show game categories in the taskbar's Games app

#### Chatroom

Tinf0il has a chat feature (likely using WebSockets or a third-party
service). The specific implementation details are not clear from the
codebase inspection.

---

## 7. Remaining Work

### Priority 1: Fix Window Drag (`public/js/wm.js`)

Window manager is created but dragging doesn't work. Common issues:
- Event listeners not capturing mousedown on title bar
- Event propagation interfering with iframe events
- CSS `transform` vs `left/top` positioning confusion

**Files**: `public/js/wm.js`, relevant CSS in `public/css/styles.css`

### Priority 2: Browser as a Window

Currently the browser viewport is the main content area. Convert it to
behave like other windows (draggable, resizable, focusable).

Changes:
- Wrap the viewport in a window container like other apps
- The "Browser" taskbar button opens/focuses the browser window
- Tab strip stays at the top of the browser window (not the page)

### Priority 3: TV / Live Tab

Add a TV streaming feature similar to Tinf0il's movieverse.

**Files to create/modify**:
- `server/index.js` — Add `/api/tv-proxy` endpoint
- `public/index.html` — Add TV/Live panel section
- `public/js/main.js` — Add TV to taskbar + window management
- `public/css/styles.css` — TV panel styles

### Priority 4: Full Scramjet Controller Integration

Move from server-proxy mode to full controller SW mode.

**Required changes** (see `tinf0il-analysis.md` for exact patterns):
1. Fix SW registration to handle all lifecycle states
2. Modify controller config in-place instead of constructor argument
3. Create proper transport adapter (BareClient or direct EpoxyTransport)
4. Use controller.sw.js (RPC version) for SW communication
5. Remove server-proxy workaround once full integration works

### Priority 5: Enhanced Games

Replace current ROM picker with a proper games browser:
- Game categories grid
- Integration with game libraries (3kh0, etc.)
- In-browser emulator for ROMs
- Games open in windows

### Priority 6: Chatroom

Add a chat feature (WebSocket-based or embedded service).

### Priority 7: Polish

- Fix remaining CSS issues
- Add transition animations
- Improve mobile responsiveness
- Keyboard shortcuts

---

## 8. Development Rules

1. **TEST IN A REAL BROWSER** — "Tests pass" is not sufficient.
   Use `agent-browser` to verify every change.

2. **Run `node --check <file>`** on every JS file before committing.
   Zero syntax errors. Zero import path mistakes.

3. **Do NOT push to GitHub**. Commit locally only.

4. **Be honest** about what works and what does not.

5. **Run `npm run build`** after changing engine code or the build script.

6. **The UV service worker MUST be self-contained**: `importScripts` the
   UV bundle, inline ad-block filters, append fetch handler. Do NOT load
   `uv.bundle.js` separately expecting the SW to see it.

7. **Filters** (`public/data/filters.js`) use ESM export keywords.
   The build strips them before inlining into the classic-script SW.

8. **Two root-scoped SWs cannot coexist**. When switching engines,
   unregister the old SW first.

9. **SW scope is isolated from the page**. `importScripts` the bundle
   INSIDE the SW.

10. **`navigator.serviceWorker.ready` ≠ controlling**. Wait for
    `controllerchange` event or use Tinf0il's lifecycle-aware pattern.

11. **Settings cache** (`loadSettings()`) persists across calls.
    Modify `saveSettings()` or clear cache when changing settings externally.

12. **iframe-watch** polls every 2 seconds. Always add new proxy URL
    patterns to the skip list to prevent infinite tab creation.

13. **Server proxy responses** must strip `content-encoding`,
    `content-length`, and `content-security-policy` headers since
    Node's `fetch()` auto-decompresses and the body is modified.

14. **Agent-browser sessions** are isolated. `close` + `open` wipes
    localStorage. Use `eval` + localStorage in the same session for
    persistent settings.

15. **Dynamic imports** in `agent-browser eval` may cause syntax errors.
    Use `var` or `function` wrappers instead of arrow functions with
    destructuring.
