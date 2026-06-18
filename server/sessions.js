// Session manager for shared mode. Generates UUID session IDs, stores a
// salted hash of the password (never the plaintext), and enforces a TTL.
// Sessions live in memory (cleared on restart) — for a proxy this is fine,
// since the user can re-create a session quickly.

import { randomUUID, createHash, timingSafeEqual } from "node:crypto";

const sessions = new Map(); // uuid -> { salt, hash, expires, created }

export function createSession(password) {
  const id = randomUUID();
  const salt = randomUUID();
  const hash = hashPassword(password, salt);
  const created = Date.now();
  const expires = created + SESSION_TTL_MS;
  sessions.set(id, { salt, hash, expires, created });
  return { id, expires };
}

export function verifySession(id, password) {
  const s = sessions.get(id);
  if (!s) return false;
  if (Date.now() > s.expires) {
    sessions.delete(id);
    return false;
  }
  const candidate = hashPassword(password, s.salt);
  // Timing-safe comparison.
  const a = Buffer.from(candidate, "hex");
  const b = Buffer.from(s.hash, "hex");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function sessionExists(id) {
  const s = sessions.get(id);
  if (!s) return false;
  if (Date.now() > s.expires) { sessions.delete(id); return false; }
  return true;
}

export function listSessions() {
  const now = Date.now();
  return [...sessions.entries()]
    .filter(([_, s]) => now <= s.expires)
    .map(([id, s]) => ({ id, created: s.created, expires: s.expires }));
}

function hashPassword(password, salt) {
  return createHash("sha256").update(salt + ":" + (password || "")).digest("hex");
}

// TTL from env or default 1 week. Read once at startup.
const SESSION_TTL_MS = (Number(process.env.LUX_SESSION_TTL_HOURS) || 168) * 3600 * 1000;
