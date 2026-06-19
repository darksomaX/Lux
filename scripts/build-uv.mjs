// Copies the Ultraviolet + Scramjet + bare-mux + epoxy transport client bundles
// out of node_modules into public/ so Express can serve them as static assets.
// The proxy client (service worker / shared worker), rewriter, and config must
// all be same-origin with the page that registers them.
//
// Run with: npm run build:uv

import { cp, mkdir, rm, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { existsSync } from "node:fs";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const nm = join(root, "node_modules");

const targets = [
  { name: "Ultraviolet bundle", from: "@titaniumnetwork-dev/ultraviolet/dist", to: "public/uv", required: true },
  { name: "bare-mux client", from: "@mercuryworkshop/bare-mux/dist", to: "public/baremux", required: true },
  { name: "epoxy transport", from: "@mercuryworkshop/epoxy-transport/dist", to: "public/epoxy", required: true },
  { name: "Scramjet bundle", from: "@mercuryworkshop/scramjet/dist", to: "public/scramjet", required: false },
  { name: "libcurl transport", from: "@mercuryworkshop/libcurl-transport/dist", to: "public/libcurl", required: false },
];

let failed = false;

for (const t of targets) {
  const fromPath = join(nm, t.from);
  const toPath = join(root, t.to);
  if (!existsSync(fromPath)) {
    if (t.required) {
      console.error(`X ${t.name}: source not found at ${fromPath}`);
      failed = true;
    } else {
      console.log(`· ${t.name}: skipped (not installed; engine toggle will offer UV only)`);
    }
    continue;
  }
  await rm(toPath, { recursive: true, force: true });
  await mkdir(toPath, { recursive: true });
  await cp(fromPath, toPath, { recursive: true });
  console.log(`OK ${t.name}: ${t.from} -> ${t.to}`);
}

// epoxy-tls wasm + glue lives in a sibling package. Copy its "full" build
// (includes a bundled TLS impl) into public/epoxy/.
const epoxyTlsFull = join(nm, "@mercuryworkshop/epoxy-tls/full");
if (existsSync(epoxyTlsFull)) {
  const dest = join(root, "public/epoxy");
  for (const f of ["epoxy-bundled.js", "epoxy.wasm"]) {
    await cp(join(epoxyTlsFull, f), join(dest, f), { recursive: true });
  }
  console.log("OK epoxy-tls (full): wasm + bundled glue -> public/epoxy/");
} else {
  console.warn("! epoxy-tls not found — proxied HTTPS sites will fail. Install @mercuryworkshop/epoxy-tls.");
}

// Rewrite uv.config.js so handler/client/bundle/config/sw paths point at /uv/.
const uvConfigPath = join(root, "public/uv/uv.config.js");
if (existsSync(uvConfigPath)) {
  let cfg = await readFile(uvConfigPath, "utf8");
  cfg = cfg
    .replace("'/uv.handler.js'", "'/uv/uv.handler.js'")
    .replace("'/uv.client.js'", "'/uv/uv.client.js'")
    .replace("'/uv.bundle.js'", "'/uv/uv.bundle.js'")
    .replace("'/uv.config.js'", "'/uv/uv.config.js'")
    .replace("'/uv.sw.js'", "'/uv/uv.sw.js'")
    // Change the proxy prefix from /service/ to /s/ (shorter, cleaner).
    // Handle both quote styles the upstream may emit.
    .replace(/prefix:\s*["']\/service\/["']/, "prefix: \"/s/\"");
  await writeFile(uvConfigPath, cfg);
  console.log("OK rewrote uv.config.js paths -> /uv/*, prefix -> /s/");
}

// Make uv.sw.js self-contained AND wire its fetch handler. The npm package's
// uv.sw.js (a) opens with `var h = self.Ultraviolet`, which is undefined in the
// isolated SW scope unless we importScripts the bundle, and (b) defines
// self.UVServiceWorker as a class but never instantiates it or attaches a
// fetch listener. The canonical Ultraviolet-App has a separate sw.js that does
// both. We prepend importScripts and append the instantiation + listener.
const uvSwPath = join(root, "public/uv/uv.sw.js");
if (existsSync(uvSwPath)) {
  let swSrc = await readFile(uvSwPath, "utf8");
  if (!swSrc.startsWith("importScripts")) {
    // Read the filter data and inline it into the SW (can't importScripts an
    // ESM file — filters.js uses export). We strip the export keywords and
    // embed the arrays + functions directly.
    const filtersSrc = await readFile(join(root, "public/data/filters.js"), "utf8");
    const filtersInlined = filtersSrc
      .replace(/^export\s+/gm, "")
      .replace(/^\/\/.*$/gm, ""); // strip comments for compactness

    const wiring =
      'importScripts("/uv/uv.bundle.js", "/uv/uv.config.js");\n' +
      "// === Ad-block filter data (inlined from data/filters.js) ===\n" +
      filtersInlined +
      "// === End filter data ===\n\n" +
      swSrc +
      '\n// Wire the fetch handler (appended by build-uv.mjs).\n' +
      '// Includes ad-blocking: drops requests to known ad hosts and injects\n' +
      '// cosmetic CSS into proxied HTML responses.\n' +
      'const uvSW = new self.UVServiceWorker();\n' +
      'self.addEventListener("fetch", (event) => {\n' +
      '  const req = event.request;\n' +
      '  // Ad-blocking: check if the destination hostname is a known ad host.\n' +
      '  try {\n' +
      '    const url = new URL(req.url);\n' +
      '    const dest = req.destination;\n' +
      '    if (dest !== "document" && dest !== "" && isAdHost(url.hostname)) {\n' +
      '      event.respondWith(new Response("", { status: 204 }));\n' +
      '      return;\n' +
      '    }\n' +
      '  } catch {}\n' +
      '  if (uvSW.route({ request: req })) {\n' +
      '    event.respondWith(reportRequest(uvSW.fetch({ request: req }), req));\n' +
      '  }\n' +
      '});\n' +
      '// Report proxied request info for the DevTools panel.\n' +
      'async function reportRequest(promise, req) {\n' +
      '  const resp = await promise;\n' +
      '  const ct = resp.headers.get("content-type") || "";\n' +
      '  const size = resp.headers.get("content-length") || "?";\n' +
      '  // Post request info to all clients for the devtools panel.\n' +
      '  const clients = await self.clients.matchAll({ type: "window" });\n' +
      '  for (const client of clients) {\n' +
      '    client.postMessage({\n' +
      '      luxDevtools: true,\n' +
      '      method: req.method,\n' +
      '      url: req.url,\n' +
      '      status: resp.status,\n' +
      '      size: size,\n' +
      '    });\n' +
      '  }\n' +
      '  // 204 No Content or other null-body statuses: return as-is.\n' +
      '  if (resp.status === 204 || resp.status === 304 || !resp.body) return resp;\n' +
      '  // Apply cosmetic CSS for HTML responses.\n' +
      '  if (!ct.includes("text/html")) return resp;\n' +
      '  const css = "<style>" + cosmeticCss() + "</style>";\n' +
      '  try {\n' +
      '    const body = await resp.text();\n' +
      '    const injected = body.replace("<head>", "<head>" + css) || (css + body);\n' +
      '    return new Response(injected, {\n' +
      '      status: resp.status, statusText: resp.statusText,\n' +
      '      headers: resp.headers,\n' +
      '    });\n' +
      '  } catch { return resp; }\n' +
      '}\n';
    await writeFile(uvSwPath, wiring);
    console.log("OK made uv.sw.js self-contained + wired fetch handler");
  }
}

if (failed) {
  console.error("\nBuild failed. Run `npm install` first.");
  process.exit(1);
}

// Copy Scramjet v2 controller files into public/scramjet/.
// The controller package provides: controller.api.js (page-side IIFE),
// controller.inject.js (injected into proxied pages), and
// controller.sw.js (service worker with RPC support).
const scramjetControllerDist = join(nm, "@mercuryworkshop/scramjet-controller/dist");
const scramjetPublic = join(root, "public/scramjet");

if (existsSync(scramjetControllerDist)) {
  // Copy controller.api.js (IIFE that sets globalThis.$scramjetController)
  for (const f of ["controller.api.js", "controller.inject.js", "controller.sw.js"]) {
    const src = join(scramjetControllerDist, f);
    if (existsSync(src)) {
      await cp(src, join(scramjetPublic, f));
    }
  }
  
  // Copy controller.sw.js as sw.js (the main Scramjet service worker)
  const swSrc = join(scramjetControllerDist, "controller.sw.js");
  if (existsSync(swSrc)) {
    await cp(swSrc, join(scramjetPublic, "sw.js"));
  }
  
  console.log("OK Scramjet v2: sw.js + controller bundle + inject");
} else {
  console.warn("! Scramjet v2 controller not found — engine will be marked unavailable");
}

console.log("\nClient bundles ready. Start the server: npm start");
