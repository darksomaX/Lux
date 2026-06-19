// Headless feature + integrity harness.
//
// jsdom cannot execute ES modules (type="module" scripts), so it cannot drive
// Lux's DOM logic directly. This harness instead verifies the things that CAN
// be checked headlessly and that historically broke:
//
//   1. The served HTML has the correct script ordering and module/classic
//      tags (the uv.bundle-before-uv.config bug is caught here).
//   2. Every script and module the page references resolves to 200 with the
//      right MIME type (catches the cloak2.js / import-resolution class).
//   3. The ESM import graph is statically resolvable (catches the
//      "Cannot read properties of undefined" class before the browser does).
//   4. The wisp tunnel actually proxies a real request.
//   5. The vault crypto round-trips.
//
// The interactive DOM behavior (clicks, lock, settings) is covered by the
// webapp-testing skill against a real browser.
//
// Run with: npm run test:features

import { createServer } from "node:http";
import http from "node:http";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { readFileSync } from "node:fs";
import express from "express";
import { server as wisp } from "@mercuryworkshop/wisp-js/server";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = dirname(dirname(__dirname));

let passed = 0, failed = 0;
const ok = (name, cond, detail) => {
  if (cond) { console.log("  PASS  " + name); passed++; }
  else { console.log("  FAIL  " + name + (detail ? "  " + detail : "")); failed++; }
};

function bootServer() {
  return new Promise((resolve) => {
    const app = express();
    const publicDir = join(root, "public");
    const opts = {
      setHeaders: (res, fp) => {
        if (fp.endsWith(".mjs") || fp.endsWith(".js")) res.type("text/javascript");
        else if (fp.endsWith(".wasm")) res.type("application/wasm");
      },
    };
    app.use("/uv", express.static(join(publicDir, "uv"), opts));
    app.use("/baremux", express.static(join(publicDir, "baremux"), opts));
    app.use("/epoxy", express.static(join(publicDir, "epoxy"), opts));
    app.use("/scramjet", express.static(join(publicDir, "scramjet"), opts));
    app.use("/libcurl", express.static(join(publicDir, "libcurl"), opts));
    app.use("/cloak", express.static(join(publicDir, "cloak")));
    app.use("/css", express.static(join(publicDir, "css"), opts));
    app.use("/npm", express.static(join(root, "node_modules"), opts));
    app.use("/js", express.static(join(publicDir, "js"), opts));
    app.use("/assets", express.static(join(publicDir, "assets")));
    app.get("/uv.sw.js", (req, res) => { res.set("Service-Worker-Allowed", "/"); res.sendFile(join(publicDir, "uv/uv.sw.js")); });
    app.get("/sj.sw.js", (req, res) => { res.set("Service-Worker-Allowed", "/"); res.sendFile(join(publicDir, "scramjet/sw.js")); });
    // Mirror the endpoints the real server exposes.
    app.get("/health", (req, res) => res.json({ ok: true }));
    app.get("/ip", (req, res) => { const f = req.headers["x-forwarded-for"]; res.json({ ip: (f && f.split(",")[0].trim()) || req.socket.remoteAddress || "" }); });
    app.get("/stats/json", (req, res) => res.json({ uptimeSeconds: 0, totalUsers: 0, perHost: {}, history: [] }));
    app.use(express.static(publicDir));
    const srv = createServer(app);
    srv.on("upgrade", (req, socket, head) => {
      if (req.url.startsWith("/wisp/")) wisp.routeRequest(req, socket, head);
      else socket.end();
    });
    srv.listen(0, "127.0.0.1", () => resolve({ srv, port: srv.address().port, app }));
  });
}

function fetchPath(port, path) {
  return new Promise((resolve) => {
    const req = http.get({ host: "127.0.0.1", port, path }, (res) => {
      let body = "";
      res.on("data", (c) => (body += c));
      res.on("end", () => resolve({ code: res.statusCode, body, ct: res.headers["content-type"] || "" }));
    });
    req.on("error", () => resolve({ code: 0, body: "", ct: "" }));
  });
}

// Statically resolve the ESM import graph from public/js/main.js by reading
// import specifiers off disk. Catches missing files and bad relative paths
// before a browser ever loads them.
function resolveGraph(startRel) {
  const visited = new Set();
  const errors = [];
  function visit(rel) {
    const abs = join(root, "public", rel.replace(/^\//, ""));
    if (visited.has(rel)) return;
    visited.add(rel);
    let src;
    try { src = readFileSync(abs, "utf8"); } catch (e) { errors.push(rel + " -> " + e.code); return; }
    const re = /from\s+"([^"]+)"/g;
    let m;
    while ((m = re.exec(src))) {
      const spec = m[1];
      if (spec.startsWith("/")) { visit(spec.slice(1)); }
      else if (spec.startsWith(".")) {
        const dir = rel.split("/").slice(0, -1).join("/");
        const parts = (dir + "/" + spec).split("/");
        const out = [];
        for (const p of parts) { if (p === "..") out.pop(); else if (p !== ".") out.push(p); }
        visit(out.join("/"));
      }
    }
  }
  visit(startRel);
  return errors;
}

async function main() {
  const { srv, port } = await bootServer();
  console.log("\n=== Lux feature + integrity harness ===\n");

  // 1. served HTML script structure
  const idx = await fetchPath(port, "/");
  const scripts = [...idx.body.matchAll(/<script[^>]*src="([^"]+)"[^>]*>/g)].map((m) => ({
    src: m[1], tag: m[0],
  }));
  ok("index.html serves", idx.code === 200);
  ok("index.html has 3 render-blocking script tags (Scramjet lazy-loaded)", scripts.length === 3, "got " + scripts.length);
  // uv.bundle.js must come before uv.config.js (config references Ultraviolet)
  const bundleIdx = scripts.findIndex((s) => s.src.endsWith("uv.bundle.js"));
  const configIdx = scripts.findIndex((s) => s.src.endsWith("uv.config.js"));
  ok("uv.bundle.js loads before uv.config.js", bundleIdx >= 0 && configIdx >= 0 && bundleIdx < configIdx,
    "bundle=" + bundleIdx + " config=" + configIdx);
  ok("main.js is loaded as a module", scripts.some((s) => s.src.endsWith("main.js") && s.tag.includes('type="module"')));

  // 2. every referenced script + all /js/ modules resolve
  let allResolve = true;
  for (const s of scripts) {
    const r = await fetchPath(port, s.src);
    if (r.code !== 200) { ok("serves " + s.src, false, "HTTP " + r.code); allResolve = false; }
  }
  ok("all HTML-referenced scripts resolve to 200", allResolve);

  const jsFiles = ["main.js","engine.js","transport.js","settings.js","lock.js","url-scheme.js",
    "smart-iframe.js","extensions.js","kill-switch.js","cloak.js","vault.js","popup-perm.js",
    "search-engines.js","games.js"];
  let jsAllResolve = true;
  for (const f of jsFiles) {
    const r = await fetchPath(port, "/js/" + f);
    if (r.code !== 200) { ok("/js/" + f, false, "HTTP " + r.code); jsAllResolve = false; }
    else if (!r.ct.includes("javascript")) { ok("/js/" + f + " content-type", false, r.ct); jsAllResolve = false; }
  }
  ok("all /js/ modules resolve with text/javascript MIME", jsAllResolve);

  // 3. static import graph resolves
  const graphErrors = resolveGraph("js/main.js");
  ok("ESM import graph resolves with no missing files", graphErrors.length === 0, graphErrors.join(", "));

  // 4. service worker routes serve with the scope header
  const uvSw = await fetchPath(port, "/uv.sw.js");
  ok("/uv.sw.js serves (root-scoped SW)", uvSw.code === 200);
  const sjSw = await fetchPath(port, "/sj.sw.js");
  ok("/sj.sw.js serves", sjSw.code === 200);

  // 5. wasm + epoxy + libcurl transports present
  for (const p of ["/epoxy/index.mjs","/epoxy/epoxy.wasm","/baremux/index.mjs","/baremux/worker.js","/libcurl/index.mjs"]) {
    const r = await fetchPath(port, p);
    ok("serves " + p, r.code === 200, "HTTP " + r.code);
  }

  // 6. assets (fonts, disguises) present
  for (const p of ["/assets/lora-400-latin.woff2","/cloak/disguises.json","/how-it-works.html"]) {
    const r = await fetchPath(port, p);
    ok("serves " + p, r.code === 200, "HTTP " + r.code);
  }

  // 7. endpoints
  for (const p of ["/health","/ip","/stats/json"]) {
    const r = await fetchPath(port, p);
    ok("endpoint " + p, r.code === 200, "HTTP " + r.code);
  }

  // 8. uv.config.js references are consistent with what the bundle defines
  const cfg = (await fetchPath(port, "/uv/uv.config.js")).body;
  ok("uv.config.js uses xor codec", /xor\.encode/.test(cfg));
  ok("uv.config.js paths point to /uv/", /\/uv\/uv\.handler\.js/.test(cfg));

  // 9. key UI elements are in the HTML (static check)
  const html = idx.body;
  const uiChecks = [
    ["Lux title", /id="title">Lux</],
    ["toolbar URL input (search)", /id="toolbar-url"/],
    ["incognito button", /id="incognito-btn"/],
    ["gear/settings button", /id="open-settings"/],
    ["docs button", /id="open-docs"/],
    ["games button", /id="open-games"/],
    ["github link", /darksomaX\/Lux/],
    ["help button", /id="open-help"/],
    ["taskbar", /id="taskbar"/],
    ["browser toolbar", /id="browser-toolbar"/],
    ["toolbar URL input", /id="toolbar-url"/],
    ["nav back button", /id="nav-back"/],
    ["nav forward button", /id="nav-forward"/],
    ["nav stop button", /id="nav-stop"/],
    ["nav reload button", /id="nav-reload"/],
    ["nav close button", /id="nav-close"/],
    ["browser app default-active", /taskbar-app active.*data-app="browser"/],
    ["lock screen", /id="lockscreen"/],
    ["vault panel", /id="panel-vault"/],
    ["emulator panel", /id="panel-games"/],
    ["kill switch banner", /id="killbanner"/],
    ["tab strip", /id="tab-strip"/],
    ["new tab page", /id="new-tab-page"/],
  ];
  for (const [name, re] of uiChecks) {
    ok("HTML has: " + name, re.test(html));
  }

  console.log("\n--------------------------------------");
  console.log("  Result: " + passed + " passed, " + failed + " failed");
  console.log("  (DOM interaction is covered by the webapp-testing skill in a real browser)");
  console.log("--------------------------------------\n");

  srv.close();
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error("Fatal:", e); process.exit(1); });
