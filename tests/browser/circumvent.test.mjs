// Censorship circumvention test.
//
// Simulates a hostile network censor using Playwright's request interception
// (fully in-process, fully reversible — never touches your real DNS, hosts
// file, or network). The censor blocks any request whose URL contains the
// target host, returning a "blocked" page instead.
//
// Then we prove Lux circumvents it: the SAME target, loaded through the Lux
// proxy, returns the real content because the request the browser makes is to
// /service/<encoded> on Lux's own origin, which does not match the censor's
// host rule.
//
// We test against two hosts:
//   - example.com  (a benign host the censor blocks)
//   - example.org  (a second host, to show it's not a one-off)
//
// Run: node tests/browser/circumvent.test.mjs  (server must be running)

import { chromium } from "playwright";

const BASE = process.env.LUX_URL || "http://localhost:8080/";
const TARGETS = ["https://example.com", "https://example.org"];
const BLOCK_PAGE = "<html><body>BLOCKED BY CENSOR</body></html>";

let passed = 0, failed = 0;
const ok = (n, c, d) => { if (c) { console.log("  PASS  " + n); passed++; } else { console.log("  FAIL  " + n + (d ? "  " + d : "")); failed++; } };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch({ headless: true });

// The censor: a Playwright route handler. It matches requests by host keyword
// and returns the block page. This models a network-layer censor that drops
// or redirects traffic to specific domains.
function installCensor(context, blockedHosts) {
  return context.route("**/*", (route) => {
    const url = route.request().url();
    const matched = blockedHosts.some((h) => url.includes(h));
    if (matched) {
      // Simulate the censor: fulfill with a block page.
      route.fulfill({ status: 451, contentType: "text/html", body: BLOCK_PAGE });
    } else {
      route.continue();
    }
  });
}

console.log("\n=== Censorship circumvention test ===\n");

for (const target of TARGETS) {
  const host = new URL(target).hostname;
  console.log("-- target: " + target + " --");

  // 1. Direct load (censor ON) — should be BLOCKED.
  {
    const ctx = await browser.newContext();
    const censor = installCensor(ctx, [host]);
    const page = await ctx.newPage();
    const resp = await page.goto(target, { waitUntil: "domcontentloaded", timeout: 15000 }).catch(() => null);
    const status = resp ? resp.status() : 0;
    const body = await page.evaluate(() => document.body ? document.body.innerText.slice(0, 100) : "").catch(() => "");
    ok("[" + host + "] direct load is BLOCKED by censor", status === 451 || body.includes("BLOCKED BY CENSOR"),
      "status=" + status + " body=" + body.slice(0, 60));
    await censor;
    await ctx.close();
  }

  // 2. Proxied load through Lux (censor ON for the real host) — should get the
  //    real content, because the browser only talks to Lux's origin.
  {
    const ctx = await browser.newContext();
    const censor = installCensor(ctx, [host]);
    const page = await ctx.newPage();
    page.on("pageerror", () => {}); // swallow benign export noise

    await page.goto(BASE, { waitUntil: "domcontentloaded" });
    await wait(2500);

    // Unlock.
    await page.fill("#lock-input", "a");
    await page.keyboard.press("Enter");
    await wait(300);

    // Register the SW and wait for active.
    await page.evaluate(async () => {
      await navigator.serviceWorker.register("/uv.sw.js", { scope: "/" });
      await navigator.serviceWorker.ready;
    });
    await wait(500);

    // Navigate via the proxy.
    await page.fill("#search-input", target);
    await page.press("#search-input", "Enter");

    // Wait for the proxied frame.
    let proxiedFrame = null;
    for (let i = 0; i < 15; i++) {
      proxiedFrame = page.frames().find((f) => f.url().includes("/service/"));
      if (proxiedFrame) break;
      await wait(1000);
    }
    let frameText = "";
    let frameUrl = "";
    if (proxiedFrame) {
      frameUrl = proxiedFrame.url();
      await proxiedFrame.waitForLoadState("domcontentloaded", { timeout: 15000 }).catch(() => {});
      await wait(1500);
      frameText = await proxiedFrame.evaluate(() => document.body ? document.body.innerText.slice(0, 300) : "").catch(() => "");
    }

    const expected = host === "example.com" ? "Example Domain" : "Example Domain";
    ok("[" + host + "] proxied frame reached /service/", !!proxiedFrame && frameUrl.includes("/service/"),
      "url=" + frameUrl.slice(0, 80));
    ok("[" + host + "] proxied content is REAL (not blocked)", frameText.includes(expected) && !frameText.includes("BLOCKED"),
      "text=" + frameText.slice(0, 120));

    await ctx.close();
  }
  console.log("");
}

console.log("--------------------------------------");
console.log("  Result: " + passed + " passed, " + failed + " failed");
console.log("--------------------------------------\n");

await browser.close();
process.exit(failed ? 1 : 0);
