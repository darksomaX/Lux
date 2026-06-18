// Encrypted vault. Stores user files and notes entirely client-side:
// IndexedDB (raw bytes) holding gzip-compressed + AES-GCM-256 ciphertext.
//
// Key derivation: the passphrase (same one as lock, or separate) is run
// through PBKDF2 (250k iterations) to produce an AES-GCM CryptoKey. The salt
// and a per-record IV are stored alongside the ciphertext. The server never
// sees plaintext — only this browser can decrypt.
//
// Compression uses the native CompressionStream/DecompressionStream APIs
// (gzip), available in all evergreen browsers since 2022. This drops the fflate
// dependency, which is lighter and avoids fflate's Node-flavored ESM build that
// calls createRequire() and breaks in a browser.
//
// If the lock phrase is empty/unset, the vault is sealed with a fixed device
// key derived from a random salt persisted in localStorage (convenience mode:
// not as strong as a passphrase, but still encrypts at rest so IndexedDB
// dumps are useless without the salt).

// ---- native gzip helpers (async, streaming) ----
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
    out.push(value);
  }
  return new Uint8Array(out.reduce((acc, b) => acc + b.length, 0) ? out.flatMap((b) => [...b]) : []);
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
  for (const c of chunks) {
    merged.set(c, off);
    off += c.length;
  }
  return merged;
}

const DB_NAME = "lux-vault";
const STORE = "items";
const SALT_KEY = "lux.vault.salt";

let dbPromise = null;
let cryptoKey = null;

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE, { keyPath: "id" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function getSalt() {
  let salt = localStorage.getItem(SALT_KEY);
  if (!salt) {
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    salt = btoa(String.fromCharCode(...bytes));
    localStorage.setItem(SALT_KEY, salt);
  }
  return new Uint8Array(atob(salt).split("").map((c) => c.charCodeAt(0)));
}

async function deriveKey(passphrase) {
  const enc = new TextEncoder();
  const base = passphrase || "lux-device-key";
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    enc.encode(base),
    { name: "PBKDF2" },
    false,
    ["deriveKey"]
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: getSalt(), iterations: 250000, hash: "SHA-256" },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

async function ensureKey() {
  if (cryptoKey) return cryptoKey;
  // Use the lock phrase if set, else fall back to the device key.
  const phrase = localStorage.getItem("lux.settings.v1")
    ? JSON.parse(localStorage.getItem("lux.settings.v1")).lockPhrase
    : "";
  cryptoKey = await deriveKey(phrase || "");
  return cryptoKey;
}

async function encrypt(bytes) {
  const key = await ensureKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const compressed = await gzip(new Uint8Array(bytes));
  const cipher = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, compressed);
  return { cipher: new Uint8Array(cipher), iv };
}

async function decrypt(cipher, iv) {
  const key = await ensureKey();
  const compressed = new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, cipher));
  return gunzip(compressed);
}

async function dbPut(item) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(item);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}

async function dbGetAll() {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function dbDelete(id) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).delete(id);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}

// ---- public API ----

export async function initVault() {
  await openDb();
  await ensureKey();
}

export async function saveNote(id, text) {
  const bytes = new TextEncoder().encode(text);
  const { cipher, iv } = await encrypt(bytes);
  await dbPut({
    id,
    name: id + ".txt",
    size: bytes.length,
    type: "text/plain",
    cipher: cipher.buffer,
    iv: iv.buffer,
    updated: Date.now(),
  });
}

export async function importFile(file) {
  const buf = await file.arrayBuffer();
  const { cipher, iv } = await encrypt(new Uint8Array(buf));
  const id = "f_" + Date.now().toString(36);
  await dbPut({
    id,
    name: file.name,
    size: file.size,
    type: file.type || "application/octet-stream",
    cipher: cipher.buffer,
    iv: iv.buffer,
    updated: Date.now(),
  });
  return id;
}

export async function listVault() {
  const all = await dbGetAll();
  return all
    .map((x) => ({ id: x.id, name: x.name, size: x.size, type: x.type, updated: x.updated }))
    .sort((a, b) => b.updated - a.updated);
}

export async function openVaultItem(id) {
  const all = await dbGetAll();
  const item = all.find((x) => x.id === id);
  if (!item) throw new Error("Item not found.");
  const bytes = await decrypt(new Uint8Array(item.cipher), new Uint8Array(item.iv));
  return new Blob([bytes], { type: item.type });
}

export async function deleteVaultItem(id) {
  await dbDelete(id);
}
