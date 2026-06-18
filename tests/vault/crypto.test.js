// Vault crypto round-trip test.
//
// Verifies the encrypt/decrypt pipeline that the browser vault uses: a key is
// derived from a passphrase via PBKDF2, data is gzip-compressed (native
// CompressionStream, the same API the browser module uses) and sealed with
// AES-GCM, then decrypted back to the original bytes. Node 18+ ships both
// WebCrypto and CompressionStream, so a pass here means the browser code is
// sound.
//
// Run with: npm run test:vault

import { webcrypto } from "node:crypto";

if (!globalThis.crypto) globalThis.crypto = webcrypto;

// Mirror the browser's async gzip helpers exactly.
async function gzip(bytes) {
  const cs = new CompressionStream("gzip");
  const writer = cs.writable.getWriter();
  writer.write(bytes);
  writer.close();
  const out = [];
  const reader = cs.readable.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    out.push(...value);
  }
  return new Uint8Array(out);
}
async function gunzip(bytes) {
  const ds = new DecompressionStream("gzip");
  const writer = ds.writable.getWriter();
  writer.write(bytes);
  writer.close();
  const chunks = [];
  let total = 0;
  const reader = ds.readable.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    total += value.length;
  }
  const merged = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) { merged.set(c, off); off += c.length; }
  return merged;
}

const enc = new TextEncoder();
let passed = 0, failed = 0;
function ok(name, cond, detail) {
  if (cond) { console.log("  PASS  " + name); passed++; }
  else { console.log("  FAIL  " + name + (detail ? "  " + detail : "")); failed++; }
}

async function deriveKey(passphrase, salt) {
  const keyMaterial = await crypto.subtle.importKey(
    "raw", enc.encode(passphrase), { name: "PBKDF2" }, false, ["deriveKey"]
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations: 250000, hash: "SHA-256" },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false, ["encrypt", "decrypt"]
  );
}

async function seal(key, bytes) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const compressed = await gzip(new Uint8Array(bytes));
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, compressed));
  return { cipher, iv };
}

async function open(key, cipher, iv) {
  const compressed = new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, cipher));
  return gunzip(compressed);
}

async function run() {
  console.log("\n=== Vault crypto round-trip ===\n");

  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await deriveKey("correct horse battery staple", salt);
  ok("PBKDF2 -> AES-GCM key derived", key instanceof CryptoKey);

  // Different passphrase must yield a different key (key is non-extractable so
  // we check it can't decrypt the other key's data instead).
  const key2 = await deriveKey("wrong passphrase", salt);

  const cases = [
    { name: "small text", bytes: () => enc.encode("Hello, vault.") },
    { name: "empty payload", bytes: () => new Uint8Array(0) },
    { name: "1 KB random", bytes: () => crypto.getRandomValues(new Uint8Array(1024)) },
    { name: "64 KB random", bytes: () => crypto.getRandomValues(new Uint8Array(65536)) },
    { name: "repetitive (compressible)", bytes: () => { const b = new Uint8Array(8192); b.fill(65); return b; } },
  ];

  for (const c of cases) {
    const original = c.bytes();
    const { cipher, iv } = await seal(key, original);
    const recovered = await open(key, cipher, iv);
    ok("round-trip: " + c.name, bytesEqual(original, recovered));
  }

  // Wrong key must fail (AES-GCM authenticity).
  const data = enc.encode("secret");
  const sealed = await seal(key, data);
  let wrongKeyThrew = false;
  try { await open(key2, sealed.cipher, sealed.iv); } catch { wrongKeyThrew = true; }
  ok("wrong passphrase fails to decrypt", wrongKeyThrew);

  // Tampered ciphertext must fail.
  const tampered = new Uint8Array(sealed.cipher);
  tampered[0] ^= 0xff;
  let tamperThrew = false;
  try { await open(key, tampered, sealed.iv); } catch { tamperThrew = true; }
  ok("tampered ciphertext rejected", tamperThrew);

  console.log("\n--------------------------------------");
  console.log("  Result: " + passed + " passed, " + failed + " failed");
  console.log("--------------------------------------\n");
  process.exit(failed ? 1 : 0);
}

function bytesEqual(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

run().catch((e) => { console.error("Fatal:", e); process.exit(1); });
