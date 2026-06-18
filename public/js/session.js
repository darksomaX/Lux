// Session export/import. Packages the user's Lux state into a single file that
// can be moved via USB to another machine and restored.
//
// What's included:
//   - Lux settings (localStorage lux.settings.v1)
//   - The lock salt (so the same passphrase decrypts the vault on the new machine)
//   - UV's proxied cookies (IndexedDB "__uv$cookies" -> "cookies" store), so
//     Google/other logins persist across the transfer
//   - The encrypted vault items (IndexedDB "lux-vault" -> "items")
//
// What is NOT included and cannot be:
//   - Service worker registrations (re-created on the new machine)
//   - The lock phrase itself (the user re-enters it; the salt lets the same
//     phrase derive the same key)
//
// Format: a versioned JSON envelope. Forward/backward compatible: unknown
// fields are ignored on import, missing fields fall back to defaults.
//
//   { "format": "lux-session", "version": 1, "exportedAt": <epoch>, "data": { ... } }

const FORMAT = "lux-session";
const VERSION = 1;

async function idbGetAll(dbName, storeName) {
  return new Promise((resolve) => {
    let result = [];
    const req = indexedDB.open(dbName);
    req.onsuccess = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(storeName)) { resolve([]); return; }
      try {
        const tx = db.transaction(storeName, "readonly");
        const r = tx.objectStore(storeName).getAll();
        r.onsuccess = () => { result = r.result || []; resolve(result); };
        r.onerror = () => resolve([]);
      } catch { resolve([]); }
    };
    req.onerror = () => resolve([]);
  });
}

async function idbClear(dbName, storeName) {
  return new Promise((resolve) => {
    const req = indexedDB.open(dbName);
    req.onsuccess = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(storeName)) { resolve(); return; }
      try {
        const tx = db.transaction(storeName, "readwrite");
        tx.objectStore(storeName).clear();
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
      } catch { resolve(); }
    };
    req.onerror = () => resolve();
  });
}

async function idbPutMany(dbName, storeName, items) {
  // We need to open with the right version + create the store if missing.
  return new Promise((resolve) => {
    let version = 1;
    // Probe existing version.
    const probe = indexedDB.open(dbName);
    probe.onsuccess = () => {
      version = probe.result.version + 1;
      const req = indexedDB.open(dbName, version);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(storeName)) {
          req.result.createObjectStore(storeName, { keyPath: "id" });
        }
      };
      req.onsuccess = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(storeName)) { resolve(); return; }
        try {
          const tx = db.transaction(storeName, "readwrite");
          const store = tx.objectStore(storeName);
          for (const it of items) store.put(it);
          tx.oncomplete = () => resolve();
          tx.onerror = () => resolve();
        } catch { resolve(); }
      };
      req.onerror = () => resolve();
    };
    probe.onerror = () => resolve();
  });
}

export async function exportSession() {
  const settings = localStorage.getItem("lux.settings.v1") || null;
  const vaultSalt = localStorage.getItem("lux.vault.salt") || null;
  const uvCookies = await idbGetAll("__uv$cookies", "cookies").catch(() => []);
  const vaultItems = await idbGetAll("lux-vault", "items").catch(() => []);

  const envelope = {
    format: FORMAT,
    version: VERSION,
    exportedAt: Date.now(),
    data: {
      settings,
      vaultSalt,
      uvCookies,
      vaultItems,
    },
  };
  return JSON.stringify(envelope, null, 2);
}

export async function importSession(jsonText) {
  let env;
  try {
    env = JSON.parse(jsonText);
  } catch {
    throw new Error("File is not valid JSON.");
  }
  if (env.format !== FORMAT) {
    throw new Error("Not a Lux session file (missing format marker).");
  }
  // Version check: we support v1. Future versions add fields; we ignore unknowns.
  const d = env.data || {};

  if (d.settings) {
    localStorage.setItem("lux.settings.v1", d.settings);
  }
  if (d.vaultSalt) {
    localStorage.setItem("lux.vault.salt", d.vaultSalt);
  }
  if (Array.isArray(d.uvCookies) && d.uvCookies.length) {
    await idbClear("__uv$cookies", "cookies").catch(() => {});
    await idbPutMany("__uv$cookies", "cookies", d.uvCookies);
  }
  if (Array.isArray(d.vaultItems) && d.vaultItems.length) {
    await idbClear("lux-vault", "items").catch(() => {});
    await idbPutMany("lux-vault", "items", d.vaultItems);
  }
  return {
    settings: !!d.settings,
    vaultSalt: !!d.vaultSalt,
    uvCookies: (d.uvCookies || []).length,
    vaultItems: (d.vaultItems || []).length,
  };
}

// Trigger a browser download of the session file.
export async function downloadSession() {
  const json = await exportSession();
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "lux-session-" + new Date().toISOString().slice(0, 10) + ".json";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// Read a file the user picked and import it.
export function pickAndImportSession() {
  return new Promise((resolve, reject) => {
    const inp = document.createElement("input");
    inp.type = "file";
    inp.accept = ".json,application/json";
    inp.onchange = async () => {
      const f = inp.files[0];
      if (!f) { resolve(null); return; }
      try {
        const text = await f.text();
        const result = await importSession(text);
        resolve(result);
      } catch (e) {
        reject(e);
      }
    };
    inp.click();
  });
}
