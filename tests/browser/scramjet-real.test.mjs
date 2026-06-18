// Scramjet end-to-end test. Switches the engine to Scramjet in settings, then
// loads example.com and checks the real content renders. Scramjet uses a
// different client (controller + frame) and the libcurl transport over wisp,
// so this exercises a different code path than the UV test.
//
// Run: node tests/browser/scramjet-real.test.mjs  (server running)

import { chromium } from "playwright";
const BASE = process.env.LUX_URL || "http://localhost:8080/";
let passed = 0, failed = 0;
const ok = (n, c, d) => { if (c) { console.log("  PASS  " + n); passed++; } else { console.log("  FAIL  " + n + (d ? "  " + d : "")); failed++; } };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext();
const page = await context.newPage();
page.on("pageerror", () => {});
page.on("console", () => {});

console.log("\n=== Scramjet end-to-end test ===\n");

await page.goto(BASE, { waitUntil: "domcontentloaded" });
await wait(2500);

// Unlock.
await page.fill("#lock-input", "a");
await page.keyboard.press("Enter");
await wait(300);

// Switch engine to Scramjet via settings.
await page.evaluate(() => document.getElementById("open-settings").click());
await wait(200);
const switched = await page.evaluate(() => {
  const sel = document.querySelector('[data-key="engine"]');
  if (!sel) return false;
  sel.value = "scramjet";
  sel.dispatchEvent(new Event("change", { bubbles: true }));
  return true;
});
ok("engine switched to scramjet in settings", switched);
await wait(200);
await page.evaluate(() => document.getElementById("settings-done").click());
await wait(200);

// CRITICAL: unregister any existing UV service worker so we don't get a false
// pass from UV intercepting. Then let engine.js register Scramjet's SW.
const unreg = await page.evaluate(async () => {
  const all = await navigator.serviceWorker.getRegistrations();
  for (const r of all) await r.unregister();
  return all.length;
});
console.log("  (unregistered " + unreg + " prior SW(s))");
await wait(1000);

// Navigate to example.com. This triggers engine.mount() which for Scramjet
// lazy-loads the bundle, registers the SJ SW, and creates a SJ frame.
await page.fill("#search-input", "https://example.com");
await page.press("#search-input", "Enter");

// Wait for the Scramjet frame to appear. Scramjet creates its own iframe.
let proxiedFrame = null;
for (let i = 0; i < 20; i++) {
  // Scramjet frames carry a proxied URL; check for any frame that isn't the main page.
  proxiedFrame = page.frames().find((f) => {
    const u = f.url();
    return f !== page.mainFrame() && u && u !== "about:blank";
  });
  if (proxiedFrame) break;
  await wait(1000);
}

let frameUrl = proxiedFrame ? proxiedFrame.url() : "(no frame)";
let frameText = "";
console.log("  (frame url: " + frameUrl.slice(0, 100) + ")");
if (proxiedFrame) {
  await proxiedFrame.waitForLoadState("domcontentloaded", { timeout: 20000 }).catch(() => {});
  await wait(2000);
  frameText = await proxiedFrame.evaluate(() => document.body ? document.body.innerText.slice(0, 300) : "").catch(() => "");
  console.log("  (frame text: " + frameText.slice(0, 200).replace(/\n/g, " ") + ")");
}

ok("scramjet created a proxied frame", !!proxiedFrame);
ok("scramjet loaded real example.com content", frameText.includes("Example Domain"),
  "got: " + frameText.slice(0, 150));

console.log("\n--------------------------------------");
console.log("  Result: " + passed + " passed, " + failed + " failed");
console.log("--------------------------------------\n");
await browser.close();
process.exit(failed ? 1 : 0);
