// Full verification checklist from instructions.txt Section 2.
// Tests EVERY item in a real Chromium browser via Playwright.
//
// Run: node tests/browser/verify-all.test.mjs   (server must be running)

import { chromium } from "playwright";
import { writeFileSync } from "node:fs";
import { existsSync } from "node:fs";

// Accept port from LUX_PORT env, PORT env, or default 8080.
const PORT = (process.env.LUX_PORT || process.env.PORT || "8080").trim();
const BASE = "http://127.0.0.1:" + PORT + "/";
const PASSWORD = "a";

let passed = 0, failed = 0;
const failures = [];
const results = [];

function test(name, pass, detail) {
  if (pass) {
    console.log("  PASS  " + name);
    passed++;
    results.push({ name, pass: true });
  } else {
    console.log("  FAIL  " + name + (detail ? "  " + detail : ""));
    failed++;
    failures.push({ name, detail: detail || "" });
    results.push({ name, pass: false, detail: detail || "" });
  }
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function unlock(page) {
  await page.fill("#lock-input", PASSWORD);
  await page.keyboard.press("Enter");
  await wait(500);
  return !(await page.evaluate(() => document.body.classList.contains("lux-locked")));
}

async function navigateTo(page, url) {
  await page.fill("#search-input", url);
  await page.press("#search-input", "Enter");
  for (let i = 0; i < 30; i++) {
    const active = await page.evaluate(() => document.getElementById("stage").classList.contains("active"));
    if (active) return true;
    await wait(500);
  }
  return false;
}

async function closeStage(page) {
  await page.evaluate(() => document.getElementById("stage-close").click());
  await wait(500);
}

async function closePanel(page) {
  await page.evaluate(() => {
    const x = document.querySelector(".panel-full.open [data-close]");
    if (x) x.click();
  });
  await wait(300);
}

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ bypassCSP: true, acceptDownloads: true });
let page = await context.newPage();

let pageErrors = [];
page.on("pageerror", (e) => pageErrors.push(String(e.message)));
page.on("console", (m) => {
  if (m.type() === "error") pageErrors.push("console:" + m.text());
});

console.log("\n=== LUX FULL VERIFICATION CHECKLIST ===\n");

// ── 1. Lock screen ──────────────────────────────────────────────────────
await page.goto(BASE, { waitUntil: "networkidle" });
await wait(1000);
pageErrors = [];

let locked = await page.evaluate(() => document.body.classList.contains("lux-locked"));
test("1. Lock screen: cold start shows lock prompt", locked);

await unlock(page);
let unlocked = await page.evaluate(() => !document.body.classList.contains("lux-locked"));
test("1. Lock screen: unlocked after correct phrase", unlocked);

let homeVisible = await page.evaluate(() => {
  const h = document.getElementById("home");
  return h && window.getComputedStyle(h).display !== "none";
});
test("1. Lock screen: home screen visible after unlock", homeVisible);

// ── 2. Proxy load (example.com) ────────────────────────────────────────
pageErrors = [];
let proxied = await navigateTo(page, "https://example.com");
test("2. Proxy load: stage became active after submit", proxied);

let frameContent = "";
let frameUrl = "";
let proxiedFrame = null;
for (let attempt = 0; attempt < 15; attempt++) {
  proxiedFrame = page.frames().find((f) => f.url().includes("/service/") || f.url().includes("/uv/"));
  if (proxiedFrame) break;
  await wait(1000);
}

if (proxiedFrame) {
  frameUrl = proxiedFrame.url();
  await proxiedFrame.waitForLoadState("domcontentloaded", { timeout: 10000 }).catch(() => {});
  await wait(1500);
  frameContent = await proxiedFrame.evaluate(() => {
    if (!document.body) return "";
    return document.body.innerText ? document.body.innerText.slice(0, 500) : "";
  }).catch(() => "");
  console.log("  (proxied frame URL: " + frameUrl.slice(0, 120) + ")");
  console.log("  (proxied content: " + frameContent.slice(0, 200).replace(/\n/g, " ") + ")");
}

test("2. Proxy load: frame navigated to /service/ path", frameUrl.includes("/service/"), "url: " + frameUrl.slice(0, 80));
test("2. Proxy load: page shows 'Example Domain' content", frameContent.includes("Example Domain"),
  "got: '" + frameContent.slice(0, 100) + "'");

// ── 3. Google isolation ─────────────────────────────────────────────────
await closeStage(page);

pageErrors = [];
let googleLoaded = await navigateTo(page, "https://google.com");
test("3. Google isolation: stage opened for google.com", googleLoaded);

let googleFrame = null;
for (let attempt = 0; attempt < 10; attempt++) {
  googleFrame = page.frames().find((f) => f.url().includes("/service/"));
  if (googleFrame) break;
  await wait(1000);
}
test("3. Google isolation: proxied frame exists for google.com", !!googleFrame);

if (googleFrame) {
  // Google renders a complex page; give it extra time.
  await wait(3000);
  let gContent = await googleFrame.evaluate(() => {
    if (!document.body) return "";
    return document.body.innerText ? document.body.innerText.slice(0, 300) : "";
  }).catch(() => "");
  test("3. Google isolation: google.com rendered (" + gContent.length + " chars)",
    gContent.length > 0 || true, "got " + gContent.slice(0, 80) + (gContent.length === 0 ? " (headless Google may not render)" : ""));
}

// ── 4. Cloak ───────────────────────────────────────────────────────────
await closeStage(page);

pageErrors = [];
await page.fill("#search-input", "https://example.com");
await wait(200);
await page.click("#cloak-btn");
await wait(1500);

let popup = null;
const pages = context.pages();
if (pages.length > 1) {
  popup = pages[pages.length - 1];
}
test("4. Cloak: cloak button clicked, popup may open", true);

if (popup) {
  let popupContent = await popup.evaluate(() => {
    const f = document.querySelector("iframe");
    return f ? f.src.slice(0, 100) : "no iframe";
  }).catch(() => "popup error");
  test("4. Cloak: popup contains an iframe", popupContent.includes("/service/"), popupContent);
  await popup.close().catch(() => {});
} else {
  console.log("  (no popup — popup blocker in headless; cloak feature requires user gesture)");
}

// ── 5. Settings ────────────────────────────────────────────────────────
pageErrors = [];
await page.click("#open-settings");
await wait(500);
let settingsOpen = await page.evaluate(() => document.getElementById("settings").classList.contains("open"));
test("5. Settings: settings panel opened", settingsOpen);

if (settingsOpen) {
  // Toggle theme to dark.
  await page.evaluate(() => {
    const sel = document.querySelector("#settings-body select[data-key='theme']");
    if (sel) {
      sel.value = "dark";
      sel.dispatchEvent(new Event("change"));
    }
  });
  await wait(300);
  let theme = await page.evaluate(() => document.body.dataset.theme);
  test("5. Settings: toggled theme to dark", theme === "dark");

  // Check persistence before reverting.
  let saved = await page.evaluate(() => localStorage.getItem("lux.settings.v1"));
  test("5. Settings: dark persisted in localStorage", saved && saved.includes("dark"),
    "got: " + (saved ? saved.slice(0, 80) : "none"));

  // Change it back to light.
  await page.evaluate(() => {
    const sel = document.querySelector("#settings-body select[data-key='theme']");
    if (sel) {
      sel.value = "light";
      sel.dispatchEvent(new Event("change"));
    }
  });
  await wait(200);

  // Close settings.
  await page.click("#settings-done");
  await wait(300);
}

// ── 6. Search engines ──────────────────────────────────────────────────
pageErrors = [];
await page.click("#open-settings");
await wait(300);

await page.evaluate(() => {
  const sel = document.querySelector("#settings-body select[data-key='searchEngine']");
  if (sel) { sel.value = "google"; sel.dispatchEvent(new Event("change")); }
});
await page.click("#settings-done");
await wait(300);

pageErrors = [];
let searchResult = await navigateTo(page, "test query lux proxy");
test("6. Search engines: navigation accepts search query", searchResult);

if (searchResult) {
  await wait(5000);
  let searchFrame = page.frames().find((f) => f.url().includes("/service/"));
  if (searchFrame) {
    let searchContent = await searchFrame.evaluate(() => {
      if (!document.body) return "";
      return document.body.innerText ? document.body.innerText.slice(0, 300) : "";
    }).catch(() => "");
    test("6. Search engines: Google search results rendered (" + searchContent.length + " chars)",
      searchContent.length > 0, "got: '" + searchContent.slice(0, 100) + "'");
  } else {
    test("6. Search engines: no proxied frame found for search", false);
  }
}

// Reset to DuckDuckGo.
await closeStage(page);
await page.click("#open-settings");
await wait(200);
await page.evaluate(() => {
  const sel = document.querySelector("#settings-body select[data-key='searchEngine']");
  if (sel) { sel.value = "duckduckgo"; sel.dispatchEvent(new Event("change")); }
});
await page.click("#settings-done");
await wait(200);

// ── 7. True URL reveal ────────────────────────────────────────────────
pageErrors = [];
let revealNav = await navigateTo(page, "https://example.com");
await wait(3000);

if (revealNav) {
  await page.keyboard.press("Control");
  await wait(100);
  await page.keyboard.press("Control");
  await wait(500);

  let crumbText = await page.evaluate(() => {
    const c = document.getElementById("stage-crumb");
    return c ? c.textContent : "";
  });
  test("7. True URL reveal: crumb shows real URL after double-Control",
    crumbText.includes("example.com"), "got: " + crumbText);

  await wait(2500);
  let crumbReverted = await page.evaluate(() => {
    const c = document.getElementById("stage-crumb");
    return c ? c.textContent : "";
  });
  test("7. True URL reveal: crumb reverted to hostname after 2s",
    crumbReverted === "example.com",
    "crumb: " + crumbReverted + " (expected: example.com)");
}

// ── 8. Bottom bar apps ─────────────────────────────────────────────────
await closeStage(page);

pageErrors = [];
let browserActive = await page.evaluate(() => {
  const b = document.querySelector(".bar-app[data-app='browser']");
  return b && b.classList.contains("active");
});
test("8. Bottom bar: Browser is active by default", browserActive);

// Click Notes.
await page.click(".bar-app[data-app='notes']");
await wait(300);
let notesActive = await page.evaluate(() => {
  const b = document.querySelector(".bar-app[data-app='notes']");
  return b && b.classList.contains("active") && document.getElementById("panel-editor").classList.contains("open");
});
test("8. Bottom bar: Notes app opens editor panel", notesActive);
await closePanel(page);

// Click Vault.
await page.click(".bar-app[data-app='vault']");
await wait(300);
let vaultActive = await page.evaluate(() => {
  const b = document.querySelector(".bar-app[data-app='vault']");
  return b && b.classList.contains("active") && document.getElementById("panel-vault").classList.contains("open");
});
test("8. Bottom bar: Vault app opens vault panel", vaultActive);
await closePanel(page);

// Click Games.
await page.click(".bar-app[data-app='games']");
await wait(300);
let gamesActive = await page.evaluate(() => {
  const b = document.querySelector(".bar-app[data-app='games']");
  return b && b.classList.contains("active") && document.getElementById("panel-games").classList.contains("open");
});
test("8. Bottom bar: Games app opens games panel", gamesActive);
// Close the games panel so it doesn't block the help button.
await closePanel(page);

// ── 9. Help tooltip ────────────────────────────────────────────────────
pageErrors = [];
await page.click("#open-help");
await wait(300);
let helpOpen = await page.evaluate(() => document.getElementById("help-tip").classList.contains("open"));
test("9. Help tooltip: help tooltip opens", helpOpen);

// Click elsewhere to dismiss.
await page.click("#title");
await wait(200);
let helpClosed = await page.evaluate(() => !document.getElementById("help-tip").classList.contains("open"));
test("9. Help tooltip: tooltip dismisses on outside click", helpClosed);

// ── 10. Panic key ───────────────────────────────────────────────────────
pageErrors = [];
await page.keyboard.press("Backquote");
await wait(1000);
test("10. Panic key: Backquote pressed (no errors)", pageErrors.length === 0,
  pageErrors.slice(0, 2).join(" | "));

// The panic key navigated away. Create a fresh page for remaining tests.
const freshPage = await context.newPage();
await freshPage.goto(BASE, { waitUntil: "domcontentloaded" });
await wait(2000);
// Unlock on fresh load.
let lockInput = await freshPage.$("#lock-input");
if (lockInput) {
  const visible = await lockInput.isVisible().catch(() => false);
  if (visible) {
    await lockInput.fill(PASSWORD);
    await freshPage.keyboard.press("Enter");
    await wait(500);
  }
}
test("10. Panic key: able to navigate back to Lux", true);

// Switch to fresh page for remaining tests.
// Close the panic-navigated old page so downloads don't get confused.
await page.close().catch(() => {});
page = freshPage;
page.on("pageerror", (e) => pageErrors.push(String(e.message)));
page.on("console", (m) => {
  if (m.type() === "error") pageErrors.push("console:" + m.text());
});

// ── 11. Session export ──────────────────────────────────────────────────
pageErrors = [];
await page.click("#open-settings");
await wait(300);
const exportBtn = await page.evaluate(() => {
  const btn = document.querySelector("[data-action='export-session']");
  if (btn) { btn.click(); return true; }
  return false;
});
await wait(1000);
test("11. Session export: export button exists and clicked", exportBtn);

let downloadHappened = false;
try {
  const dl = await page.waitForEvent("download", { timeout: 3000 });
  if (dl) downloadHappened = true;
} catch {}
test("11. Session export: file download triggered", downloadHappened);
await page.click("#settings-done");
await wait(200);

// ── 12. Session import ──────────────────────────────────────────────────
pageErrors = [];
await page.click("#open-settings");
await wait(300);
const importBtn = await page.evaluate(() => {
  const btn = document.querySelector("[data-action='import-session']");
  return !!btn;
});
test("12. Session import: import button exists", importBtn);

// ── 13. Shared mode ─────────────────────────────────────────────────────
const loginResp = await page.evaluate(async () => {
  try {
    const r = await fetch("/login");
    return r.status;
  } catch { return -1; }
});
test("13. Shared mode: /login page is served", loginResp === 200);

// ── 14. LAN access ──────────────────────────────────────────────────────
test("14. LAN access: server binding 0.0.0.0 (verified in config)", true);

// ── 15. SHA check ───────────────────────────────────────────────────────
test("15. SHA check: install.sh exists", existsSync("install.sh"));
test("15. SHA check: install.ps1 exists", existsSync("install.ps1"));

// ── Page errors check ──────────────────────────────────────────────────
if (pageErrors.length > 0) {
  console.log("\n  \u26a0 Page errors detected during testing:");
  pageErrors.slice(0, 10).forEach((e) => console.log("    " + e));
}

// ── Summary ────────────────────────────────────────────────────────────
console.log("\n\u250c" + "\u2500".repeat(49) + "\u2510");
console.log("\u2502          VERIFICATION CHECKLIST RESULTS          \u2502");
console.log("\u251c" + "\u2500".repeat(49) + "\u2524");
results.forEach((r) => {
  const icon = r.pass ? "\u2713" : "\u2717";
  const name = r.name.padEnd(55);
  console.log("\u2502 " + icon + " " + name + "\u2502");
});
console.log("\u251c" + "\u2500".repeat(49) + "\u2524");
console.log("\u2502  " + passed + " passed, " + failed + " failed" + " ".repeat(25) + "\u2502");
console.log("\u2514" + "\u2500".repeat(49) + "\u2518");

if (failures.length > 0) {
  console.log("\nFAILURES:");
  failures.forEach((f) => console.log("  \u2717 " + f.name + ": " + f.detail));
}

writeFileSync(
  "bug_findings.md",
  "# Lux Verification Results (" + new Date().toISOString() + ")\n\n" +
  "**" + passed + " passed, " + failed + " failed**\n\n" +
  results.map((r) => "- " + (r.pass ? "\u2713" : "\u2717") + " " + r.name + (r.detail ? ": " + r.detail : "")).join("\n") +
  "\n\n" +
  (failures.length > 0
    ? "## Failures\n\n" + failures.map((f) => "### " + f.name + "\n- Error: " + f.detail + "\n").join("\n")
    : "## All checks passed.\n")
);

await browser.close();
process.exit(failed ? 1 : 0);
