---
name: webapp-testing
description: Use when you need to interact with, verify, or debug a local web application's frontend behavior in a real browser. Covers driving a Node/Express app with Playwright (Node), capturing screenshots, reading browser console logs, and asserting on rendered DOM. Use whenever the user asks to "test", "verify", "try", "check if it works", or "see if X loads" for any web UI — even if they don't say Playwright.
---

# Web application testing

To test a local web application's actual browser behavior, write a Node
Playwright script and run it against the running server. This is the only
reliable way to verify ES-module front-ends, service workers, and interactive
DOM behavior — jsdom cannot execute `<script type="module">` or run service
workers, so headless DOM testing there gives false failures.

## When to use this

Use it whenever a question is really about what a browser does:

- "Does the page load without console errors?"
- "Does clicking the gear open settings?"
- "Does typing a URL and pressing enter navigate the iframe?"
- "Take a screenshot of the home page."
- "The buttons do nothing — what's wrong?"

Do NOT use it for pure logic that has a unit test (the encoder, crypto, URL
normalization). Run the existing `npm test` suites for those.

## Helper script

`scripts/with_server.mjs` (in this skill's directory) manages server lifecycle.
Run it with `--help` first; do not read its source unless a custom need arises.

```
node scripts/with_server.mjs --server "npm start" --port 8080 -- node your-test.mjs
```

It boots the server, waits for the port to answer, runs your test script, then
tears the server down regardless of pass/fail.

## Writing a test script

A test script is just a Node program that imports Playwright and drives the
page. Keep it focused: navigate, wait for `networkidle`, then act and assert.

```js
import { chromium } from "playwright";

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();

const errors = [];
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
page.on("pageerror", (e) => errors.push(String(e)));

await page.goto("http://localhost:8080/");
await page.waitForLoadState("networkidle");

// The lock screen shows on cold start.
await page.fill("#lock-input", "a");
await page.keyboard.press("Enter");
await page.waitForTimeout(100);

// Click the gear, assert settings opened.
await page.click("#open-settings");
const open = await page.evaluate(() => document.getElementById("settings").classList.contains("open"));
console.log(open ? "PASS settings open" : "FAIL settings open");

await browser.close();
process.exit(errors.length ? 1 : 0);
```

## Reconnaissance before action

On a page you have not tested before, inspect before asserting:

1. Navigate and wait for `networkidle`. Service-worker registration is async;
   without the wait, elements may not exist yet.
2. Capture state: `page.screenshot({ path: "/tmp/shot.png", full_page: true })`
   and `page.content()`.
3. List candidate selectors: `page.locator("button").all()`.
4. Then act.

## Capturing browser-side failures

The most common "nothing works" cause is an uncaught error in the module
graph (a bad import path, a missing global). Always wire both handlers:

```js
page.on("pageerror", (e) => errors.push("pageerror: " + e));
page.on("console", (m) => { if (m.type() === "error") errors.push("console: " + m.text()); });
```

If `errors` is non-empty after `networkidle`, read them — they name the exact
file and line. This is how you find the "Cannot read properties of undefined"
class of bug in seconds.

## Service-worker caveats

Playwright's Chromium supports service workers. But a SW registered at scope
`/` persists across navigations within the test context; if a test misbehaves
on a second run, use a fresh `browserContext` (`browser.newContext()`) per test
to get a clean SW state.

A SW will not install over `http://localhost` unless the context allows it —
Chromium does allow SW on localhost, so this is fine. For non-localhost test
URLs you need HTTPS.

## Pitfalls

- Waiting for `domcontentloaded` is not enough for module scripts. Wait for
  `networkidle`.
- A proxied page may never reach `networkidle` (long-lived WebSocket to wisp).
  For those, `waitForSelector` or `waitForFunction` on a specific element is
  more reliable.
- Screenshots of `headless: true` omit the OS cursor; that's expected.
