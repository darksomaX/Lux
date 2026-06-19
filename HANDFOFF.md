# Lux Handoff — June 2026

## Current State
**Project**: Self-hostable anti-censorship web proxy (Node + Express + vanilla ESM)
**GitHub**: darksomaX/Lux
**Stack**: Ultraviolet over wisp + Epoxy transport, Scramjet v2 (wired), service worker interception

## Test Status
- **45/45 tests pass** (block-sim, vault crypto, e2e wisp tunnel, feature harness)
- All 20+ JS files pass `node --check`
- Browser verification: proxy renders Example Domain via agent-browser/Playwright

## Architecture

### Key Files
| File | Purpose |
|------|---------|
| `server/index.js` | Express + wisp + session auth + /css + /npm mounts |
| `public/index.html` | Lock screen, tab strip, browser toolbar, new-tab page, taskbar, panels |
| `public/css/styles.css` | All styles (Chrome-style tabs, taskbar, windows, lock, etc.) |
| `public/js/main.js` | Orchestrator (798 lines): boot, toolbar, tab strip, navigation, taskbar, settings |
| `public/js/tabs.js` | Tab manager: create/activate/close/navigate tabs, history, orphans |
| `public/js/tab-nav.js` | Bridge: tabs → engine/transport/url-scheme, `encodeForTab()`, `mountTab()` |
| `public/js/engine.js` | UV + Scramjet v2 abstraction, `init()`, `encode()`, `mount()` |
| `public/js/transport.js` | bare-mux + Epoxy setup, `setTransportFor()` |
| `public/js/wm.js` | Window manager: draggable/resizable windows, snap, double-click maximize |
| `public/js/editor.js` | TipTap rich text editor (CDN-loaded via esm.sh), save/export |
| `public/js/lock.js` | Lock screen: create-password flow, skip, reset |
| `public/js/devtools.js` | DevTools request viewer (SW postMessage → side panel) |
| `public/js/info.js` | Info panel: IP, screen, time, battery, volume slider |
| `public/js/cloak.js` | Cloak: about:blank popup, panic key, anti-close |
| `public/js/settings.js` | All settings defaults (localStorage) |
| `public/js/vault.js` | Encrypted IndexedDB vault (AES-GCM + gzip) |
| `public/js/url-scheme.js` | URL normalization + proxy path building |
| `public/js/search-engines.js` | DuckDuckGo, Google, Startpage, Brave, Bing |
| `public/js/kill-switch.js` | Network change + IP change detection |
| `public/js/extensions.js` | ClearURLs, ad block, event toggle, Google opt-out |
| `public/js/iframe-watch.js` | Nested iframe detection |
| `public/js/true-title.js` | Real title/favicon from proxied pages |
| `public/js/smart-iframe.js` | Nesting guard: prevent Lux-in-Lux |
| `public/data/filters.js` | Ad-block host rules + cosmetic CSS selectors |
| `scripts/build-uv.mjs` | Bundle copier + SW wiring with ad-block + devtools reporting |
| `tests/features/harness.test.js` | HTTP + HTML integrity checks |
| `tests/browser/` | Playwright browser tests for proxy verification |

### Features Implemented
- Lock screen: create-password on first visit, skip, reset on wrong password
- Tab strip: Chrome-style rounded tabs, HTML5 drag-reorder, close buttons
- Browser toolbar: back/forward (dimmed when no history), reload/stop toggle, URL omnibox, incognito, new/close
- New-tab page: Lux logo with fade-in + float animation, URL search input
- Windows: draggable, resizable, macOS traffic-light buttons, double-click maximize, edge snapping (full/left/right)
- TipTap rich text editor: bold, italic, headings, lists, links, images, save/export
- Info panel: IP, screen, time, battery, volume slider
- DevTools request viewer: SW postMessage → side panel
- Night sky galaxy spin: slow rotational drift, persists across settings
- Taskbar auto-hide: slides below, 6px hover zone
- Settings: engine switch (UV/Scramjet v2), search engine, theme, lock, ad-block, kill switch, devtools toggle
- Ad-block: host rules + cosmetic CSS inlined into SW

## QA Verification (2026-06-19)

### Fixes Applied
1. **bare-mux SharedWorker MessagePort** — Fix IS applied (transport re-set after SW claim in engine.js). ✅ VERIFIED: no console errors in browser.
2. **Scramjet v2 bundle** — BROKEN. `controller.api.js` from `@mercuryworkshop/scramjet-controller` expects v2 scramjet runtime (`globalThis.$scramjet` with `versionInfo.version === "2.0.67-alpha.1"`), but only `@mercuryworkshop/scramjet@1.1.0` (v1) is installed. The `globalThis.$scramjet = BareMux` hack doesn't provide the APIs. **FIX**: Set `available: false` in engine.js, `getEngine()` falls back to UV if selected engine is unavailable. Settings shows "Scramjet v2 (unavailable)".
3. **SW reportRequest null body** — Fix IS applied (204/304/null-body check before `resp.text()` in build-uv.mjs). ✅ VERIFIED.
4. **info.js screen TDZ** — Fix IS applied (renamed to `screenInfo`). ✅ VERIFIED.
5. **Initial tab rendering** — Working. New-tab page shows on fresh load with Lux logo and URL input. ✅ VERIFIED.
6. **Toolbar buttons** — Reload/Stop toggle, Back/Forward dimming all working. ✅ VERIFIED.

### Browser QA Results (agent-browser)
- **Lock screen**: Create/skip password flow works
- **Home screen**: Lux logo with fade-in, URL search bar
- **Toolbar**: Back/Forward/Reload/Stop/Incognito/New/Close all functional
- **Tab strip**: "+" creates new tab, tabs show titles
- **Proxy navigation**: example.com renders "Example Domain" in iframe (verified via JS eval)
- **Search**: Navigates to Startpage with query
- **Settings**: All toggles present, engine shows "Scramjet v2 (unavailable)"
- **Info panel**: IP, screen, time, battery, volume slider all show
- **TipTap editor**: Bold, italic, headings, lists, links, images toolbar present
- **Console**: ZERO errors — only bare-mux debug messages
- **Tests**: 45/45 pass

### Known Issues
- **Scramjet v2**: Disabled until the v2 scramjet runtime (`@mercuryworkshop/scramjet@>=2.0.67-alpha.1`) is properly installed and the controller init is re-wired via ESM import (not classic script tag).
- **Initial tab rendering**: No visible bug found — tab shows and new-tab page renders correctly.
- **Iframe-watch**: May trigger re-navigation when `createTab()` adds a new iframe to the DOM. Not causing visible issues currently.

## Testing Commands
```bash
# Start server
npm start

# Run headless tests
npm test

# Browser verification
node .agents/skills/webapp-testing/scripts/with_server.mjs \
  --server "node server/index.js" --port 8080 -- \
  node tests/browser/verify.mjs

# agent-browser verification
agent-browser open http://127.0.0.1:8080/
agent-browser snapshot -i
```

## Key Lessons
- SW scope is isolated from page: `importScripts` the UV bundle inside the SW.
- bare-mux transport must be re-set after SW claims the page (MessagePort invalidated).
- Two root-scoped SWs cannot coexist: unregister old before registering new.
- `navigator.serviceWorker.ready` ≠ controlling — wait for `controllerchange` event.
- Dynamic imports in browser can't resolve bare package names — use full URLs or CDN.
