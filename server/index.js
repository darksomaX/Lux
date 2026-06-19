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
// Count active users per session, not per request. A session is identified by
// the lux_sid cookie (shared mode) or a temporary one set on first visit
// (single mode). This prevents the counter from inflating by ~50 on every
// page load (one increment per asset request).
const countedSessions = new Set();
app.use((req, res, next) => {
  const host = req.headers.host || "unknown";
  // Only count page navigations (HTML), not assets.
  const accept = req.headers.accept || "";
  const isPageNav = accept.includes("text/html") && req.method === "GET";
  if (isPageNav) {
    let sid = parseCookie(req.headers.cookie || "", "lux_sid") ||
              parseCookie(req.headers.cookie || "", "lux_guest");
    if (!sid) {
      sid = "g_" + Math.random().toString(36).slice(2, 10);
      res.cookie("lux_guest", sid, { maxAge: 86400000, httpOnly: true, sameSite: "lax" });
    }
    const key = sid + "@" + host;
    if (!countedSessions.has(key)) {
      countedSessions.add(key);
      userConnected(host);
    }
    res.on("close", () => {
      // Delay disconnect so rapid navigations within a session don't flap.
      setTimeout(() => {
        if (countedSessions.has(key)) {
          countedSessions.delete(key);
          userDisconnected(host);
        }
      }, 5000);
    });
  }
  next();
});

// (parseCookie is defined above in the session-auth section — reuse it.)

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
// Tinf0il-style Scramjet paths: /scram/ (scramjet runtime), /controller/
// (controller API + SW), /clients/ (libcurl transport with embedded wasm).
app.use("/scram", express.static(join(publicDir, "scramjet"), transportStaticOptions));
app.use("/controller", express.static(join(publicDir, "controller"), transportStaticOptions));
app.use("/clients", express.static(join(publicDir, "libcurl"), transportStaticOptions));
app.use("/libcurl", express.static(join(publicDir, "libcurl"), transportStaticOptions));
app.use("/cloak", express.static(join(publicDir, "cloak"), transportStaticOptions));
// webretro emulator (static, ~95MB — cloned by the operator or build script).
// Served with correct MIME for .wasm/.js cores.
app.use("/webretro", express.static(join(publicDir, "webretro"), transportStaticOptions));
app.use("/css", express.static(join(publicDir, "css"), transportStaticOptions));
// TipTap and other npm packages for the rich text editor.
const npmDir = join(root, "node_modules");
app.use("/npm", express.static(npmDir, {
  setHeaders: (res, filePath) => {
    if (filePath.endsWith(".mjs") || filePath.endsWith(".js")) res.type("text/javascript");
    else if (filePath.endsWith(".wasm")) res.type("application/wasm");
    else if (filePath.endsWith(".css")) res.type("text/css");
  },
  fallthrough: false,
}));
app.use("/js", express.static(join(publicDir, "js"), transportStaticOptions));
app.use("/data", express.static(join(publicDir, "data"), transportStaticOptions));
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
  res.set("Cache-Control", "no-cache, no-store, must-revalidate");
  res.type("text/javascript");
  // The raw controller.sw.js defines $scramjetController.{shouldRoute, route}
  // but does NOT wire a fetch event listener. Tinf0il generates a wrapper SW
  // that importScripts the controller SW and adds the fetch handler. We do
  // the same here.
  res.send(`// Generated SJ SW wrapper (Tinf0il pattern) + devtools reporting.
importScripts("/controller/controller.sw.js");
self.addEventListener("fetch", (event) => {
  try {
    if ($scramjetController.shouldRoute(event)) {
      event.respondWith(sjReport($scramjetController.route(event), event.request));
    }
  } catch (e) {
    console.error("[sj.sw] fetch handler error:", e);
  }
});
// Report proxied request info to the DevTools panel (same pattern as UV SW).
async function sjReport(promise, req) {
  try {
    const resp = await promise;
    const size = resp.headers.get("content-length") || "?";
    const clients = await self.clients.matchAll({ type: "window" });
    for (const client of clients) {
      client.postMessage({
        luxDevtools: true,
        method: req.method,
        url: req.url,
        status: resp.status,
        size: size,
      });
    }
    return resp;
  } catch (e) {
    return new Response("SJ fetch error: " + e.message, { status: 502 });
  }
}
`);
});

app.use(express.static(publicDir));

// Clean 404 page for invalid URLs.
const PAGE_NOT_FOUND = `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>404 — Lux</title>
<style>
body{margin:0;height:100dvh;display:flex;align-items:center;justify-content:center;
  font-family:system-ui,-apple-system,sans-serif;background:#faf9f6;color:#1a1a1a}
.wrap{text-align:center;max-width:420px;padding:24px}
h1{font-size:64px;margin:0 0 8px;font-weight:300;letter-spacing:-2px}
p{font-size:15px;line-height:1.6;color:#666;margin:0 0 16px}
.detail{font-size:12px;color:#999;word-break:break-all;padding:8px;
  background:#f0efec;border-radius:6px;margin:12px 0}
a{color:#1a1a1a;text-decoration:underline}
a:hover{color:#666}</style></head><body><div class="wrap">
<h1>404</h1>
<p>The page you requested could not be loaded.<br>
If you believe this is an error, please contact the site owner.</p>
<a href="/">Return to Lux</a>
</div></body></html>`;

// Scramjet proxy endpoint: fetches a URL on the server side and returns
// the response. The iframe is pointed directly at this endpoint, so the
// HTML is rendered with a <base> tag to fix relative URL resolution.
app.get("/sj-proxy", async (req, res) => {
  const target = req.query.url;
  if (!target || typeof target !== "string") {
    return res.status(400).type("html").send(PAGE_NOT_FOUND);
  }
  if (!target.startsWith("http://") && !target.startsWith("https://")) {
    return res.status(400).type("html").send(PAGE_NOT_FOUND);
  }
  try {
    const resp = await fetch(target, {
      headers: { "User-Agent": req.headers["user-agent"] || "" },
      redirect: "follow",
    });
    res.status(resp.status);
    for (const [k, v] of resp.headers) {
      const lk = k.toLowerCase();
      if (["transfer-encoding", "connection", "keep-alive", "content-security-policy",
           "content-encoding", "content-length"].includes(lk)) continue;
      res.setHeader(k, v);
    }
    const ct = resp.headers.get("content-type") || "";
    const buf = Buffer.from(await resp.arrayBuffer());
    if (ct.includes("text/html")) {
      let html = buf.toString("utf8");
      html = html.replace("<head>", `<head><base href="${target}">`);
      res.setHeader("content-length", Buffer.byteLength(html));
      return res.send(html);
    }
    res.send(buf);
  } catch (e) {
    // Return clean 404 page with error detail for debugging
    const withError = PAGE_NOT_FOUND.replace(
      "</p>",
      `</p><div class="detail">${e.message.replace(/</g,"&lt;")}</div>`
    );
    res.status(502).type("html").send(withError);
  }
});

// TV proxy endpoint: mirrors /sj-proxy pattern. Fetches a URL on the server
// side, strips dangerous headers, injects <base> tag, returns the response.
// Supports header mapping: x-cookie -> cookie, x-referer -> referer.
app.get("/api/tv-proxy", async (req, res) => {
  const target = req.query.url;
  if (!target || typeof target !== "string") {
    return res.status(400).type("html").send(PAGE_NOT_FOUND);
  }
  if (!target.startsWith("http://") && !target.startsWith("https://")) {
    return res.status(400).type("html").send(PAGE_NOT_FOUND);
  }
  try {
    const fetchHeaders = { "User-Agent": req.headers["user-agent"] || "" };
    // Map x-* headers to their real equivalents
    if (req.headers["x-cookie"]) fetchHeaders.cookie = req.headers["x-cookie"];
    if (req.headers["x-referer"]) fetchHeaders.referer = req.headers["x-referer"];

    const resp = await fetch(target, {
      headers: fetchHeaders,
      redirect: "follow",
    });
    res.status(resp.status);
    for (const [k, v] of resp.headers) {
      const lk = k.toLowerCase();
      if (["transfer-encoding", "connection", "keep-alive", "content-security-policy",
           "content-encoding", "content-length"].includes(lk)) continue;
      res.setHeader(k, v);
    }
    const ct = resp.headers.get("content-type") || "";
    const buf = Buffer.from(await resp.arrayBuffer());
    if (ct.includes("text/html")) {
      let html = buf.toString("utf8");
      html = html.replace("<head>", `<head><base href="${target}">`);
      res.setHeader("content-length", Buffer.byteLength(html));
      return res.send(html);
    }
    res.send(buf);
  } catch (e) {
    const withError = PAGE_NOT_FOUND.replace(
      "</p>",
      `</p><div class="detail">${e.message.replace(/</g,"&lt;")}</div>`
    );
    res.status(502).type("html").send(withError);
  }
});

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

// ---- Chat WebSocket ----
// Simple in-memory chat. Minimal WebSocket implementation using Node's
// built-in crypto for the handshake, and raw TCP frames for messaging.
import crypto from "node:crypto";

const CHAT_HISTORY = [];
const CHAT_MAX = 100;
const chatClients = new Set();

function broadcast(msg) {
  const payload = JSON.stringify(msg);
  for (const send of chatClients) {
    try { send(payload); } catch { chatClients.delete(send); }
  }
}

function handleChat(req, socket) {
  if (req.headers["upgrade"]?.toLowerCase() !== "websocket") {
    return socket.end();
  }

  const key = req.headers["sec-websocket-key"];
  const accept = crypto.createHash("sha1")
    .update(key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11")
    .digest("base64");

  socket.write(
    "HTTP/1.1 101 Switching Protocols\r\n" +
    "Upgrade: websocket\r\n" +
    "Connection: Upgrade\r\n" +
    "Sec-WebSocket-Accept: " + accept + "\r\n\r\n"
  );

  let buffer = Buffer.alloc(0);

  function sendWS(data) {
    const payload = Buffer.from(data, "utf8");
    const len = payload.length;
    let frame;
    if (len < 126) {
      frame = Buffer.alloc(2 + len);
      frame[0] = 0x81;
      frame[1] = len;
      payload.copy(frame, 2);
    } else if (len < 65536) {
      frame = Buffer.alloc(4 + len);
      frame[0] = 0x81;
      frame[1] = 126;
      frame.writeUInt16BE(len, 2);
      payload.copy(frame, 4);
    } else {
      frame = Buffer.alloc(10 + len);
      frame[0] = 0x81;
      frame[1] = 127;
      frame.writeBigUInt64BE(BigInt(len), 2);
      payload.copy(frame, 10);
    }
    socket.write(frame);
  }

  chatClients.add(sendWS);
  if (CHAT_HISTORY.length) {
    sendWS(JSON.stringify({ type: "history", messages: CHAT_HISTORY }));
  }
  broadcast({ type: "system", text: "A user joined the chat." });

  socket.on("data", (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    while (buffer.length >= 2) {
      const opcode = buffer[0] & 0x0f;
      const masked = buffer[1] & 0x80;
      let payloadLen = buffer[1] & 0x7f;
      let offset = 2;

      if (payloadLen === 126) {
        if (buffer.length < 4) return;
        payloadLen = buffer.readUInt16BE(2);
        offset = 4;
      } else if (payloadLen === 127) {
        if (buffer.length < 10) return;
        payloadLen = Number(buffer.readBigUInt64BE(2));
        offset = 10;
      }

      let maskKey = null;
      if (masked) {
        if (buffer.length < offset + 4) return;
        maskKey = buffer.slice(offset, offset + 4);
        offset += 4;
      }

      if (buffer.length < offset + payloadLen) return;
      let payload = Buffer.from(buffer.slice(offset, offset + payloadLen));
      if (maskKey) {
        for (let i = 0; i < payload.length; i++) payload[i] ^= maskKey[i % 4];
      }
      buffer = buffer.slice(offset + payloadLen);

      if (opcode === 0x08) {
        chatClients.delete(sendWS);
        broadcast({ type: "system", text: "A user left the chat." });
        return;
      }
      if (opcode === 0x01) {
        const raw = payload.toString("utf8");
        let name = "Anonymous", text = raw;
        try {
          const parsed = JSON.parse(raw);
          if (parsed.text) text = parsed.text;
          if (parsed.name) name = parsed.name;
        } catch {}
        const msg = { type: "message", name, text, time: Date.now() };
        CHAT_HISTORY.push(msg);
        if (CHAT_HISTORY.length > CHAT_MAX) CHAT_HISTORY.shift();
        broadcast(msg);
      }
    }
  });

  socket.on("close", () => {
    chatClients.delete(sendWS);
    broadcast({ type: "system", text: "A user left the chat." });
  });
}

// Create the HTTP server and attach wisp to the upgrade event. UV's service
// worker connects to /wisp/ over WebSocket; wisp.routeRequest multiplexes
// each connection into per-stream TCP/UDP tunnels to the real destinations.
const httpServer = createServer(app);
httpServer.on("upgrade", (req, socket, head) => {
  if (req.url.startsWith("/wisp/")) {
    wisp.routeRequest(req, socket, head);
  } else if (req.url === "/chat/") {
    handleChat(req, socket);
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
