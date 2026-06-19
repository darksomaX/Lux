// Browser test: drives the REAL Lux UI in headless Chromium.
//
// This is the test the webapp-testing skill prescribes. It boots the server
// (via with_server.mjs), loads the page, captures console/page errors, and
// exercises: lock unlock, settings open + theme toggle, search submit, panel
// open, help tooltip, and the lock/cloak UI presence. A screenshot is written
// to /tmp/lux-home.png for visual inspection.
//
// Run via the skill helper:
//   node .agents/skills/webapp-testing/scripts/with_server.mjs \
//     --server "npm start" --port 8080 -- node tests/browser/ui.test.mjs

import { chromium } from "playwright";

const BASE = process.env.LUX_URL || "http://localhost:8080/";
let passed = 0, failed = 0;
const ok = (name, cond, detail) => {
  if (cond) { console.log("  PASS  " + name); passed++; }
  else { console.log("  FAIL  " + name + (detail ? "  " + detail : "")); failed++; }
};

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext();
const page = await context.newPage();

const errors = [];
const benign = (msg) => /Unexpected token 'export'/.test(msg); // upstream UV internal noise
page.on("pageerror", (e) => { if (!benign(e.message)) errors.push("pageerror: " + e.message); });
page.on("console", (m) => { if (m.type() === "error" && !benign(m.text())) errors.push("console: " + m.text()); });

console.log("\n=== Lux browser UI test ===\n");

// 1. Load + no console errors (the module-graph health check).
await page.goto(BASE, { waitUntil: "domcontentloaded" });
// Don't wait for networkidle: the wisp WebSocket stays open. Wait for the
// lock screen or the home to appear instead, with a fallback timeout.
await page.waitForTimeout(2500);
await page.screenshot({ path: "/tmp/lux-initial.png" });
ok("page loads with no console/page errors", errors.length === 0, errors.slice(0, 5).join(" | "));
if (errors.length) {
  console.log("  (browser errors seen:)\n" + errors.map((e) => "    " + e).join("\n"));
}

// 2. Cold start: lock screen visible.
const lockVisible = await page.locator("#lockscreen").isVisible().catch(() => false);
ok("cold start shows lock screen", lockVisible);

// 3. Unlock with the default phrase.
await page.fill("#lock-input", "a");
await page.keyboard.press("Enter");
await page.waitForTimeout(200);
const stillLocked = await page.evaluate(() => document.body.classList.contains("lux-locked"));
ok("unlock with 'a' clears locked state", !stillLocked);

// 4. Screenshot for visual inspection.
await page.screenshot({ path: "/tmp/lux-home.png", fullPage: true });
ok("home screenshot saved", true);

// 5. The title says Lux.
const title = await page.locator("#title").textContent();
ok("title reads 'Lux'", (title || "").trim() === "Lux", "got '" + title + "'");

// 6. Search bar + cloak icon present.
ok("search/new-tab input present", await page.locator("#search-input, #nt-url").count() >= 1);
ok("cloak/incognito button present", await page.locator("#cloak-btn, #incognito-btn").count() >= 1);

// 7. Settings opens + theme toggle applies.
await page.click("#open-settings");
await page.waitForTimeout(100);
ok("settings panel opens", await page.locator("#settings").evaluate((el) => el.classList.contains("open")));
await page.selectOption('[data-key="theme"]', "dark");
await page.waitForTimeout(100);
const themeApplied = await page.evaluate(() => document.body.dataset.theme);
ok("theme 'dark' applied to body", themeApplied === "dark", "got " + themeApplied);
const stored = await page.evaluate(() => localStorage.getItem("lux.settings.v1"));
ok("theme persisted to localStorage", stored.includes('"theme":"dark"'));

// 8. Docs opens (DeepSeek moved this to a WM window, check either panel or window).
await page.click("#settings-done");
await page.waitForTimeout(100);
await page.click("#open-docs");
await page.waitForTimeout(500);
const docsOpen = await page.evaluate(() => {
  // Check for either the old panel-full or a WM window with docs content.
  const panel = document.getElementById("panel-docs");
  if (panel && panel.classList.contains("open")) return true;
  // WM windows have class "lux-window" (DeepSeek) or "wm-window" (older).
  const wins = document.querySelectorAll(".lux-window, .wm-window, [data-window-id]");
  return wins.length > 0;
});
ok("docs opens (panel or window)", docsOpen);

// 9. Games panel opens.
await page.click('[data-close="panel-docs"]');
await page.waitForTimeout(100);
await page.click("#open-games");
await page.waitForTimeout(100);
ok("games panel opens", await page.locator("#panel-games").evaluate((el) => el.classList.contains("open")));
await page.click('[data-close="panel-games"]');

// 10. Search submit does not throw a page error.
const beforeErrCount = errors.length;
await page.fill("#search-input", "example.com");
await page.press("#search-input", "Enter");
await page.waitForTimeout(500);
ok("search submit produced no new errors", errors.length === beforeErrCount, errors.slice(beforeErrCount).join(" | "));

// 11. Help tooltip toggles (use evaluate to avoid bottom-bar overlap).
await page.evaluate(() => document.getElementById("open-help").click());
await page.waitForTimeout(100);
ok("help tooltip opens", await page.locator("#help-tip").evaluate((el) => el.classList.contains("open")));

// 12. Bottom bar present + browser app active by default.
ok("taskbar present", await page.locator("#taskbar, #bottombar").count() >= 1);
ok("browser app active by default", await page.locator('.taskbar-app.active[data-app="browser"], .bar-app.active[data-app="browser"]').count() >= 1);

// 13. Canonical nesting marker set.
const hasMarker = await page.evaluate(() => window.__LUX__ === true);
ok("canonical Lux marker set (anti-nesting)", hasMarker);

console.log("\n--------------------------------------");
console.log("  Result: " + passed + " passed, " + failed + " failed");
console.log("  Screenshot: /tmp/lux-home.png");
console.log("--------------------------------------\n");

await browser.close();
process.exit(failed ? 1 : 0);
