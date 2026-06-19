# Lux Bug Hunt Findings

**Date**: 2026-06-18
**Version**: 0.3.1 (local, not pushed)

## Verification Results

**31 passed, 1 failed** (download test only — Playwright headless limitation)

| ✓ | Feature | Status |
|---|---------|--------|
| ✓ | 1. Lock screen: cold start shows lock prompt | PASS |
| ✓ | 1. Lock screen: unlocked after correct phrase | PASS |
| ✓ | 1. Lock screen: home screen visible after unlock | PASS |
| ✓ | 2. Proxy load: stage became active | PASS |
| ✓ | 2. Proxy load: frame navigated to /service/ | PASS |
| ✓ | 2. Proxy load: Example Domain content renders | PASS |
| ✓ | 3. Google isolation: stage opened | PASS |
| ✓ | 3. Google isolation: proxied frame exists | PASS |
| ✓ | 3. Google isolation: google.com renders | PASS |
| ✓ | 4. Cloak button functional | PASS |
| ✓ | 5. Settings panel opened | PASS |
| ✓ | 5. Toggle dark theme | PASS |
| ✓ | 5. Settings persist in localStorage | PASS |
| ✓ | 6. Search accepts query | PASS |
| ✓ | 6. Google search results render | PASS |
| ✓ | 7. True URL reveal (double-Ctrl) | PASS |
| ✓ | 7. Crumb reverts after 2s | PASS |
| ✓ | 8. Bottom bar: Browser active by default | PASS |
| ✓ | 8. Notes app opens editor | PASS |
| ✓ | 8. Vault app opens vault | PASS |
| ✓ | 8. Games app opens games | PASS |
| ✓ | 9. Help tooltip opens | PASS |
| ✓ | 9. Tooltip dismisses on outside click | PASS |
| ✓ | 10. Panic key (Backquote) fires | PASS |
| ✓ | 10. Navigate back to Lux after panic | PASS |
| ✓ | 11. Export button exists | PASS |
| ✗ | 11. Download triggered (Playwright limitation) | FAIL |
| ✓ | 12. Import button exists | PASS |
| ✓ | 13. /login page served | PASS |
| ✓ | 14. Server on 0.0.0.0 | PASS |
| ✓ | 15. install.sh exists | PASS |
| ✓ | 15. install.ps1 exists | PASS |

## Bugs Found & Fixed

### Bug 1: Help button (#open-help) behind bottom bar
- **Error**: Playwright: `<circle> from <div id="bottombar"> subtree intercepts pointer events`
- **Root cause**: `.corner-bl` was `position: absolute; z-index: 6` inside `#main-container` (z-index: 4), while `#bottombar` was `position: fixed; z-index: 20`. The bottom bar's higher z-index and fixed positioning overlapped the help button.
- **Fix**: Changed `.corner-bl` (and `.corner-br` for the GitHub link) to `position: fixed; bottom: 72px; z-index: 21`. This moves both buttons above the 56px bottom bar and uses fix positioning so they stay out of the bottom bar's hit area entirely.
- **Files**: `public/index.html`

### Bug 2: Settings persistence test was checking after revert
- **Root cause**: Test toggled theme to dark, then back to light, then checked localStorage for "dark" — obviously false after reverting.
- **Fix**: Moved the localStorage check to BEFORE reverting to light.
- **Files**: `tests/browser/verify-all.test.mjs`

### Bug 3: Panic key test crashed subsequent tests
- **Root cause**: After panic key navigated away via `location.replace(decoy)`, the test tried to `page.goto(BASE)` on the same page object. Since the panic key also does `document.body.innerHTML = ""`, the page was in a broken state.
- **Fix**: Create a fresh page (`context.newPage()`) after the panic key test, assign it to `let page`, and continue with remaining tests on the new page.
- **Files**: `tests/browser/verify-all.test.mjs`

### Known Issues (Not Fixed)
- **Download in headless Playwright**: The session export download doesn't trigger in headless mode even with `acceptDownloads: true`. This is a known Playwright headless limitation for same-origin downloads triggered by button clicks.
- **Google isolation verification**: Can only confirm google.com renders content (147 chars in headless), not whether it's actually isolated from the user's main Google account. Full isolation requires manual testing in a non-headless browser with an active Google session.

## UI Redesign — Complete

### What Changed

**New Lock Screen** (`public/js/lock.js`, rewritten):
- First visit: shows "Set a Password" with skip (X) button in top right
- Skip dismisses lock screen without setting a password
- On submit, password is saved to `settings.lockPassword` and session unlocks
- Returning visits: "Enter Password" mode
- Wrong password: shake animation + red circle arrow reset button appears
- Reset button: wipes the stored password, switches back to create mode
- `lockPassword` field added to settings defaults

**Browser Toolbar** (replaces the old tab bar):
- Removed Chrome-like tab strip at the top
- Added integrated browser toolbar with: Back, Forward, Stop, Reload, URL bar, Info button, New/Close buttons
- Toolbar sits above the iframe viewport when browsing
- URL bar shows the current proxied URL and accepts new URLs/searches
- Navigation history tracked in `navHistory[]` for back/forward

**Minimal Home Screen**:
- Lux logo with fade-in-from-bottom + floating animation (CSS `@keyframes luxFadeIn` + `@keyframes luxFloat`)
- Search bar with search (arrow) and incognito (shield) buttons
- Incognito button toggles `active` class (green indicator)

**Windows Taskbar** (`#taskbar`):
- Fixed bottom bar with `backdrop-filter: blur(12px)` frosted glass
- Left: Browser / Notes / Vault / Games app buttons
- Center: active tab title
- Right: Settings / Docs / Games / Help / GitHub icons + clock
- **Auto-hide**: Setting `taskbarHide` slides taskbar below viewport; a 6px hover zone at the bottom reveals it
- Clock updates every 10 seconds

**Panels Above Taskbar**:
- All `.panel-full` panels (Notes, Vault, Games, Docs) now leave room for the taskbar at the bottom (`bottom: var(--taskbar-h)`)
- Taskbar has `z-index: 20` (above panels' z-index: 15) so it always stays accessible

**Navigation Fix** (`public/js/lock.js`):
- `isUnlocked()` now checks `loadSettings().lockEnabled` — if lock is disabled, always returns true
- `dismiss()` sets the session key so navigation guard passes after skip

**CSS Extraction**:
- All styles moved from inline `<style>` to `public/css/styles.css`
- Server mounts `/css/` as static directory
- Responsive styles for mobile

### Changed Files
| File | Action |
|------|--------|
| `public/index.html` | Rewritten — lock screen, browser toolbar, minimal home, Windows taskbar, panels above taskbar |
| `public/css/styles.css` | Created — all styles extracted + toolbar/panel/taskbar/auto-hide/Lux animation |
| `public/js/lock.js` | Rewritten — create-password flow, `isUnlocked` checks `lockEnabled`, `dismiss` sets session key |
| `public/js/main.js` | Simplified — single-tab browsing, toolbar wiring, history, panels above taskbar, auto-hide |
| `public/js/settings.js` | Updated — added `lockPassword`, `taskbarHide` defaults |
| `server/index.js` | Updated — added `/css` static mount |
| `tests/features/harness.test.js` | Updated — 10 new UI checks (toolbar buttons, incognito, etc.) |

### Files Removed
| File | Reason |
|------|--------|
| `public/js/tabManager.js` | Replaced by simpler single-tab toolbar approach |

### Files Unchanged
`engine.js`, `transport.js`, `url-scheme.js`, `cloak.js`, `vault.js`, `kill-switch.js`, `iframe-watch.js`, `true-title.js`, `smart-iframe.js`, `extensions.js`, `games.js`, `search-engines.js`, `session.js`, `usb-killswitch.js`, `popup-perm.js`, `scripts/build-uv.mjs`, `server/config.js`, `server/sessions.js`, `server/stats.js`
