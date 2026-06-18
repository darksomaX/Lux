// Censor middleware: simulates a school/work/ISP firewall that blocks a
// denylist of hostnames by inspecting the Host header and URL path. This is a
// faithful model of the most common real-world censorship: URL/host string
// filtering at the network edge.
//
// Usage:
//   import { makeCensor, DEFAULT_BLOCKED } from "./censor.js";
//   app.use(makeCensor(DEFAULT_BLOCKED));
//
// It 403s any request whose Host header or path contains a blocked hostname,
// and logs the block so you can see it in the test output.

export const DEFAULT_BLOCKED = [
  "wikipedia.org",
  "youtube.com",
  "twitter.com",
  "x.com",
  "instagram.com",
];

export function makeCensor(blocked = DEFAULT_BLOCKED, { log = true } = {}) {
  const patterns = blocked.map((b) => b.toLowerCase());
  return function censor(req, res, next) {
    const host = (req.headers.host || "").toLowerCase();
    const path = (req.url || "").toLowerCase();
    const hit = patterns.find(
      (p) => host.includes(p) || path.includes("/" + p) || path.includes(p)
    );
    if (hit) {
      if (log) console.log(`  [CENSOR] BLOCKED ${req.method} ${host}${req.url}  (matched "${hit}")`);
      res.status(403).set("Content-Type", "text/plain").end(`Access denied: ${hit} is blocked by the network.`);
      return;
    }
    next();
  };
}
