// In-memory active-user counter. No PII is stored — only an integer per
// hostname and a rolling time series of concurrent users. This powers the
// Phase 3 status page; Phase 1 only exposes /stats/json so operators can
// check load.

const startTime = Date.now();

// current concurrent users, keyed by hostname (the Host header)
const current = new Map(); // hostname -> count

// rolling history: array of { t: epochMs, users: total } sampled every 60s
// capped at 1440 entries (24h) to bound memory
const history = [];
const HISTORY_MAX = 1440;
const SAMPLE_INTERVAL_MS = 60_000;

export function userConnected(hostname = "unknown") {
  current.set(hostname, (current.get(hostname) || 0) + 1);
}

export function userDisconnected(hostname = "unknown") {
  const n = (current.get(hostname) || 0) - 1;
  if (n <= 0) current.delete(hostname);
  else current.set(hostname, n);
}

function totalUsers() {
  let t = 0;
  for (const v of current.values()) t += v;
  return t;
}

// Sample loop — runs forever in the background, harmless if the server exits.
setInterval(() => {
  history.push({ t: Date.now(), users: totalUsers() });
  if (history.length > HISTORY_MAX) history.shift();
}, SAMPLE_INTERVAL_MS).unref();

export function snapshot() {
  const perHost = Object.fromEntries(
    [...current.entries()].sort((a, b) => b[1] - a[1])
  );
  return {
    uptimeSeconds: Math.floor((Date.now() - startTime) / 1000),
    totalUsers: totalUsers(),
    perHost,
    history,
  };
}

// Express handlers: JSON snapshot + SSE stream of live updates.
export function statsJson(req, res) {
  res.set("Cache-Control", "no-store");
  res.json(snapshot());
}

export function statsSse(req, res) {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-store",
    Connection: "keep-alive",
  });
  res.write(`data: ${JSON.stringify(snapshot())}\n\n`);

  // Send a fresh snapshot every 5s while the client is connected.
  const timer = setInterval(() => {
    res.write(`data: ${JSON.stringify(snapshot())}\n\n`);
  }, 5000);

  // Track this connection as an active user so the count reflects viewers.
  const host = req.headers.host || "unknown";
  userConnected(host);
  req.on("close", () => {
    clearInterval(timer);
    userDisconnected(host);
  });
}
