// REAL proxy verification: load example.com through Lux in a real browser and
// capture what actually renders inside the proxied iframe.
//
// This is the test that has been missing. It does NOT stop at "page loads with
// no errors". It types a URL, submits, waits for the proxied frame to render,
// and reads the frame's document text. If we see "Example Domain", the proxy
// genuinely works end to end: browser -> service worker -> wisp -> example.com.
//
// Run: node tests/browser/proxy-real.test.mjs   (server must be running)

import { chromium } from "playwright";

const BASE = process.env.LUX_URL || "http://localhost:8080/";
const TARGET = process.env.PROXY_TARGET || "https://example.com";
const EXPECTED = "Example Domain";

let passed = 0, failed = 0;
const ok = (n, c, d) => { if (c) { console.log("  PASS  " + n); passed++; } else { console.log("  FAIL  " + n + (d ? "  " + d : "")); failed++; } };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext();
const page = await context.newPage();

const errors = [];
page.on("pageerror", (e) => { if (!/Unexpected token 'export'/.test(e.message)) errors.push(String(e.message)); });
page.on("console", (m) => { if (m.type() === "error" && !/Unexpected token 'export'/.test(m.text())) errors.push("console:" + m.text()); });

console.log("\n=== REAL proxy test: " + TARGET + " through Lux ===\n");

// 1. Load + unlock.
await page.goto(BASE, { waitUntil: "domcontentloaded" });
await wait(2500);
ok("page loads", errors.length === 0, errors.slice(0, 3).join(" | "));

await page.fill("#lock-input", "a");
await page.keyboard.press("Enter");
await wait(300);
ok("unlocked", !(await page.evaluate(() => document.body.classList.contains("lux-locked"))));

// 2. Confirm the service worker registered and is active. Register explicitly
//    and await navigator.serviceWorker.ready, because getRegistration() right
//    after submit can miss an in-flight install.
const swReady = await page.evaluate(async () => {
  if (!navigator.serviceWorker) return "no SW API";
  try {
    await navigator.serviceWorker.register("/uv.sw.js", { scope: "/" });
    await navigator.serviceWorker.ready;
    const all = await navigator.serviceWorker.getRegistrations();
    const active = all.filter((r) => r.active).map((r) => r.scope);
    return active.length ? "active:" + active.join(",") : "registered-but-not-active";
  } catch (e) { return "err:" + e.message; }
});
console.log("  (service worker: " + swReady + ")");
ok("service worker is active", swReady.startsWith("active"), "got " + swReady);

// 3. Type the URL and submit.
await page.fill("#search-input", TARGET);
await page.press("#search-input", "Enter");

// 4. Wait for the stage/iframe to appear and for navigation to begin. The
//    proxied load can take several seconds (SW install + wisp + TLS).
await wait(8000);

// 5. Inspect the iframe. It is same-origin (Lux serves it), so we can read its
//    contentDocument once UV has navigated it.
const stageActive = await page.evaluate(() => document.getElementById("stage").classList.contains("active"));
ok("stage became active after submit", stageActive);

let frameContent = "";
let frameUrl = "";
try {
  // The proxied iframe has id="frame". Wait for the SW to navigate it, then
  // read its content via Playwright's frame API (handles same-origin SW scope).
  await wait(5000);
  // Find the child frame whose URL contains /service/ (the proxied path).
  let proxiedFrame = null;
  for (let attempt = 0; attempt < 10; attempt++) {
    proxiedFrame = page.frames().find((f) => f.url().includes("/service/") || f.url().includes("/uv/"));
    if (proxiedFrame) break;
    await wait(1000);
  }
  if (proxiedFrame) {
    frameUrl = proxiedFrame.url();
    // Wait for the body text to populate.
    await proxiedFrame.waitForLoadState("domcontentloaded", { timeout: 10000 }).catch(() => {});
    await wait(1000);
    frameContent = await proxiedFrame.evaluate(() => document.body ? document.body.innerText.slice(0, 500) : "").catch(() => "");
  } else {
    // Fall back to reading the iframe element's src.
    frameUrl = await page.evaluate(() => { const f = document.getElementById("frame"); return f ? f.src : ""; });
  }
  console.log("  (frame url: " + frameUrl.slice(0, 100) + ")");
  console.log("  (frame text first 200: " + frameContent.slice(0, 200).replace(/\n/g, " ") + ")");
} catch (e) {
  console.log("  (frame inspect error: " + e.message + ")");
}

ok("proxied frame navigated to a /service/ path", frameUrl.includes("/service/"), "url: " + frameUrl.slice(0, 100));
ok("proxied page contains expected content '" + EXPECTED + "'", frameContent.includes(EXPECTED),
  "got: " + frameContent.slice(0, 200));

await page.screenshot({ path: "/tmp/lux-proxy-result.png", fullPage: true });

console.log("\n--------------------------------------");
console.log("  Result: " + passed + " passed, " + failed + " failed");
console.log("--------------------------------------\n");

await browser.close();
process.exit(failed ? 1 : 0);
