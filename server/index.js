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
import { config } from "./config.js";
import { createSession, verifySession, sessionExists } from "./sessions.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = dirname(__dirname);
const publicDir = join(root, "public");

const PORT = Number(process.env.PORT) || 8080;
const HOST = process.env.HOST || "0.0.0.0";

// Minimal login page for shared mode. No external dependencies.
const LOGIN_HTML = `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Lux</title>
<style>body{margin:0;height:100dvh;display:flex;align-items:center;justify-content:center;background:#fbfbfa;font-family:Georgia,serif}form{display:flex;flex-direction:column;gap:14px;align-items:center}input{width:240px;height:44px;border:1px solid #e8e8e6;border-radius:999px;text-align:center;font-size:16px;outline:none;background:transparent;color:#1a1a1a}input:focus{border-color:#6b6b6b}button{height:44px;padding:0 24px;border:0;border-radius:999px;background:#1a1a1a;color:#fbfbfa;font-size:14px;cursor:pointer}</style>
</head><body><form id="f"><input id="p" type="password" placeholder=" " maxlength="64" autofocus><button type="submit">Enter</button></form>
<script>document.getElementById("f").onsubmit=async(e)=>{e.preventDefault();const p=document.getElementById("p").value;const r=await fetch("/api/session",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({password:p})});if(r.ok){location.href="/";}else{document.getElementById("p").value="";document.getElementById("p").placeholder="try again";}};</script>
</body></html>`;

// Quieter wisp logs in production; keep INFO for debugging locally.
if (process.env.NODE_ENV === "production") {
  wispLogging.set_level(wispLogging.WARN);
}

const app = express();

// In shared mode, gate every request behind a session cookie. The login page
// and the session-create endpoint are exempt. In single mode, no auth.
const MODE = config.mode || "single";
if (MODE === "shared") {
  app.use((req, res, next) => {
    // Exempt the login page and the API endpoints.
    if (req.path === "/login" || req.path === "/api/session" || req.path === "/health") {
      return next();
    }
    // Check the session cookie.
    const sid = parseCookie(req.headers.cookie || "", "lux_sid");
    if (sid && sessionExists(sid)) return next();
    // No valid session: redirect to login.
    if (req.path.startsWith("/api/") || req.headers.accept?.includes("application/json")) {
      return res.status(401).json({ error: "no session" });
    }
    return res.redirect("/login");
  });
  console.log("  Mode: shared (session auth required)");
}

function parseCookie(header, name) {
  for (const part of header.split(";")) {
    const [k, v] = part.trim().split("=");
    if (k === name) return v;
  }
  return null;
}

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

// Session creation (shared mode). POST { password } -> { sessionId, expires }.
// The session cookie is set; subsequent requests are authenticated.
app.use("/api/session", (req, res, next) => {
  if (req.method === "POST") {
    express.json({ limit: "64kb" })(req, res, (err) => {
      if (err) return res.status(400).json({ error: "invalid body" });
      const password = typeof req.body.password === "string" ? req.body.password.slice(0, 64) : "";
      const { id, expires } = createSession(password);
      res.cookie("lux_sid", id, {
        httpOnly: true,
        sameSite: "lax",
        maxAge: expires - Date.now(),
      });
      res.json({ sessionId: id, expires });
    });
  } else if (req.method === "GET") {
    res.json({ mode: MODE });
  } else {
    next();
  }
});

// Login page (shared mode). A minimal form that POSTs to /api/session.
app.get("/login", (req, res) => {
  res.type("html").send(LOGIN_HTML);
});

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
