// ProxyForge server.
//
// Architecture:
//   1. Express serves the static front-end from public/.
//   2. The Ultraviolet (UV) client bundle is served from /uv/ (built by
//      `npm run build:uv`), bare-mux from /baremux/, epoxy transport from
//      /epoxy/.
//   3. The same Node http.Server handles WebSocket upgrades on /wisp/ via
//      wisp-js. The browser's UV service worker tunnels all proxied traffic
//      through this WSS endpoint using the Epoxy transport.
//   4. /stats/json and /stats/stream expose the active-user counter.
//
// Env:
//   PORT      listen port (default 8080)
//   HOST      listen host (default 0.0.0.0)

import express from "express";
import compression from "compression";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createServer } from "node:http";
import { server as wisp, logging as wispLogging } from "@mercuryworkshop/wisp-js/server";
import { statsJson, statsSse, userConnected, userDisconnected } from "./stats.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = dirname(__dirname);
const publicDir = join(root, "public");

const PORT = Number(process.env.PORT) || 8080;
const HOST = process.env.HOST || "0.0.0.0";

// Quieter wisp logs in production; keep INFO for debugging locally.
if (process.env.NODE_ENV === "production") {
  wispLogging.set_level(wispLogging.WARN);
}

const app = express();

// Count each unique connection toward the active-user stat, keyed by Host so
// multi-domain deployments can see per-hostname load.
// gzip all responses — uv.bundle alone drops from 379KB to 110KB on the wire.
app.use(compression());
app.use((req, res, next) => {
  const host = req.headers.host || "unknown";
  userConnected(host);
  res.on("close", () => userDisconnected(host));
  next();
});

// Static mounts. Order matters: the SW scope root must be able to fetch these.
// The bare-mux worker is fetched with strict same-origin expectations, so each
// engine + transport gets its own mount.
// transportStaticOptions sets correct MIME types for .mjs/.js/.wasm. Browsers
// refuse to execute modules served as text/plain, and WASM needs the wasm MIME
// to compile. Interstellar does the same; without it some strict browsers
// silently fail to load the transport.
const transportStaticOptions = {
  setHeaders: (res, filePath) => {
    if (filePath.endsWith(".mjs") || filePath.endsWith(".js")) {
      res.type("text/javascript");
    } else if (filePath.endsWith(".wasm")) {
      res.type("application/wasm");
    }
  },
  fallthrough: false,
};
app.use("/uv", express.static(join(publicDir, "uv"), transportStaticOptions));
app.use("/baremux", express.static(join(publicDir, "baremux"), transportStaticOptions));
app.use("/epoxy", express.static(join(publicDir, "epoxy"), transportStaticOptions));
app.use("/scramjet", express.static(join(publicDir, "scramjet"), transportStaticOptions));
app.use("/libcurl", express.static(join(publicDir, "libcurl"), transportStaticOptions));
app.use("/cloak", express.static(join(publicDir, "cloak"), transportStaticOptions));
app.use("/js", express.static(join(publicDir, "js"), transportStaticOptions));
app.use("/assets", express.static(join(publicDir, "assets"), { fallthrough: false }));

// The proxy service workers must control the proxy path (/service/ for UV,
// /scramjet/ routes for Scramjet). A service worker can only intercept URLs
// within its scope, and by default its scope is the directory of its script.
// We serve the SW scripts at root and set Service-Worker-Allowed: / so the
// registration can claim scope "/" and intercept /service/*. Without this the
// proxy loads the page but never rewrites anything.
app.get("/uv.sw.js", (req, res) => {
  res.set("Service-Worker-Allowed", "/");
  res.sendFile(join(publicDir, "uv/uv.sw.js"));
});
app.get("/sj.sw.js", (req, res) => {
  res.set("Service-Worker-Allowed", "/");
  res.sendFile(join(publicDir, "scramjet/sw.js"));
});

app.use(express.static(publicDir));

// Stats endpoints (Phase 3 status page consumes these; harmless now).
app.get("/stats/json", statsJson);
app.get("/stats/stream", statsSse);

// Health check for deploy platforms (Render/Railway/Fly uptime probes).
app.get("/health", (req, res) => res.json({ ok: true }));

// Egress IP echo. Used by the kill switch and the IP badge. Returns the
// client's apparent IP (as the server sees it). Behind a reverse proxy, we
// honor X-Forwarded-For so the real client IP is shown.
app.get("/ip", (req, res) => {
  const fwd = req.headers["x-forwarded-for"];
  const ip = (fwd && fwd.split(",")[0].trim()) || req.socket.remoteAddress || "";
  res.set("Cache-Control", "no-store").json({ ip });
});

// Create the HTTP server and attach wisp to the upgrade event. UV's service
// worker connects to /wisp/ over WebSocket; wisp.routeRequest multiplexes
// each connection into per-stream TCP/UDP tunnels to the real destinations.
const httpServer = createServer(app);
httpServer.on("upgrade", (req, socket, head) => {
  if (req.url.startsWith("/wisp/")) {
    wisp.routeRequest(req, socket, head);
  } else {
    socket.end();
  }
});

httpServer.listen(PORT, HOST, () => {
  const addr = `http://${HOST === "0.0.0.0" ? "localhost" : HOST}:${PORT}`;
  console.log(`\n  Lux running   -> ${addr}`);
  console.log(`  Wisp endpoint -> ws://${HOST === "0.0.0.0" ? "localhost" : HOST}:${PORT}/wisp/`);
  console.log(`  Stats         -> ${addr}/stats/json\n`);
});
