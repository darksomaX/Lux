// Censorship evasion sandbox test.
//
// Proves the evasion primitives that defeat a denylist firewall, in pure Node
// (no browser required):
//
//   TEST 1 - UV XOR codec round-trips the target URL. Confirms the
//            obfuscation is lossless and that the cleartext hostname is gone
//            from the encoded form.
//   TEST 2 - The censor blocks the cleartext URL (direct access) -> 403.
//   TEST 3 - The encoded URL evades the same censor -> 200. The string
//            "wikipedia" no longer appears anywhere the firewall inspects.
//   TEST 4 - The real Wisp tunnel endpoint accepts a WebSocket upgrade.
//
// What this does NOT test (needs a real browser): the end-to-end
// browser -> service worker -> wisp -> target -> back flow, because the
// service worker only runs in a browser. That is verified manually by opening
// the app and loading a site. This sandbox tests the evasion logic that makes
// that flow unblockable.

import { createServer } from "node:http";
import net from "node:net";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { readFile } from "node:fs/promises";
import express from "express";
import { server as wisp } from "@mercuryworkshop/wisp-js/server";
import { makeCensor } from "./censor.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = dirname(dirname(__dirname));

let passed = 0;
let failed = 0;

function ok(name, cond, detail) {
  if (cond) {
    console.log("  PASS  " + name);
    passed++;
  } else {
    console.log("  FAIL  " + name + (detail ? "  " + detail : ""));
    failed++;
  }
}

// Load the REAL Ultraviolet codec from the built bundle by running it in a vm
// sandbox with minimal browser-ish globals, then reading Ultraviolet.codec.xor
// off the global. Uses the actual code users run, not a reimplementation.
async function loadRealCodec() {
  const bundle = await readFile(join(root, "public/uv/uv.bundle.js"), "utf8");

  const sandbox = {
    self: {},
    console: { debug() {}, log() {}, warn() {}, error() {} },
    BroadcastChannel: class {
      postMessage() {}
      addEventListener() {}
    },
    MessageChannel: class {
      constructor() {
        this.port1 = { postMessage() {}, onmessage: null };
        this.port2 = {};
      }
    },
    MessagePort: class {
      postMessage() {}
    },
    EventTarget: class {},
    Event: class {},
    MessageEvent: class {},
    CloseEvent: class {},
    WebSocket: class {},
    URLSearchParams: globalThis.URLSearchParams,
  };
  sandbox.window = sandbox.self;
  sandbox.globalThis = sandbox.self;
  sandbox.self.navigator = {};
  sandbox.self.clients = undefined;
  sandbox.self.localStorage = { getItem() {}, setItem() {} };
  sandbox.self.SharedWorker = undefined;
  sandbox.self.fetch = () => Promise.reject(new Error("no fetch in sandbox"));

  vm.createContext(sandbox);
  vm.runInContext(bundle, sandbox);

  const U = sandbox.Ultraviolet || sandbox.self.Ultraviolet;
  if (!U || !U.codec || !U.codec.xor) {
    throw new Error("Could not extract Ultraviolet codec from bundle");
  }
  return U.codec;
}

// Send a raw HTTP request with full control over the Host header. Node's
// fetch() forbids overriding Host, but a real censor inspects the literal Host
// header on the wire — so we must craft the request ourselves to faithfully
// model what the firewall sees.
function rawHttp({ port, method = "GET", path = "/", hostHeader, body = null }) {
  return new Promise((resolve, reject) => {
    const sock = net.connect(port, "127.0.0.1", () => {
      let req = method + " " + path + " HTTP/1.1\r\nHost: " + hostHeader + "\r\nConnection: close\r\n";
      if (body) {
        req += "Content-Length: " + Buffer.byteLength(body) + "\r\n\r\n" + body;
      } else {
        req += "\r\n";
      }
      sock.write(req);
    });
    const chunks = [];
    sock.on("data", (d) => chunks.push(d));
    sock.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      const headEnd = raw.indexOf("\r\n\r\n");
      const head = raw.slice(0, headEnd);
      const respBody = raw.slice(headEnd + 4);
      const status = parseInt(head.split(" ")[1], 10);
      resolve({ status, body: respBody, raw });
    });
    sock.on("error", reject);
    setTimeout(() => {
      sock.destroy();
      reject(new Error("rawHttp timeout"));
    }, 5000);
  });
}


// Protocols response means wisp-js is live and ready to carry tunneled traffic.
function testWispEndpoint() {
  return new Promise((resolve) => {
    const probe = express();
    const httpServer = createServer(probe);
    httpServer.on("upgrade", (req, socket, head) => {
      if (req.url.startsWith("/wisp/")) {
        wisp.routeRequest(req, socket, head);
      } else {
        socket.end();
      }
    });
    httpServer.listen(0, () => {
      const port = httpServer.address().port;
      const sock = net.connect(port, "127.0.0.1", () => {
        sock.write(
          "GET /wisp/ HTTP/1.1\r\n" +
            "Host: localhost\r\n" +
            "Upgrade: websocket\r\n" +
            "Connection: Upgrade\r\n" +
            "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n" +
            "Sec-WebSocket-Version: 13\r\n\r\n"
        );
      });
      let buf = "";
      sock.on("data", (d) => {
        buf += d.toString();
        if (buf.includes("\r\n\r\n")) {
          const is101 = buf.startsWith("HTTP/1.1 101");
          sock.destroy();
          httpServer.close();
          resolve(is101);
        }
      });
      sock.on("error", () => resolve(false));
      setTimeout(() => {
        sock.destroy();
        httpServer.close();
        resolve(false);
      }, 5000);
    });
  });
}

async function main() {
  const TARGET = "https://wikipedia.org/wiki/Freedom_of_speech";

  console.log("\n=== Censorship Evasion Sandbox ===");
  console.log("Simulating a denylist firewall\n");

  console.log("TEST 1 - UV XOR codec round-trips the target URL");
  const codec = await loadRealCodec();
  const encoded = codec.xor.encode(TARGET);
  const decoded = codec.xor.decode(encoded);
  ok("encode produces a non-empty string", typeof encoded === "string" && encoded.length > 0);
  ok("encode is deterministic", codec.xor.encode(TARGET) === encoded);
  ok(
    "encoded form does NOT contain the cleartext hostname",
    !encoded.toLowerCase().includes("wikipedia"),
    "got: " + encoded.slice(0, 80)
  );
  ok("encoded form does NOT contain 'freedom'", !encoded.toLowerCase().includes("freedom"));
  ok("decode(encode(x)) === x exactly", decoded === TARGET);
  console.log("    cleartext: " + TARGET);
  console.log("    encoded  : " + encoded.slice(0, 80) + "...\n");

  console.log("TEST 2 - Censor blocks the cleartext URL (direct access)");
  const app = express();
  app.use(makeCensor(["wikipedia.org", "youtube.com"]));
  app.get("/", (req, res) => res.send("welcome to the open internet"));
  // Catch-all = "the open internet" responding to any path that survives the
  // censor. In the real proxy this path is /service/<encoded> and the service
  // worker resolves it; here we just confirm the request was NOT blocked.
  app.use((req, res) => res.send("welcome to the open internet (proxied)"));

  await new Promise((resolve) => {
    const srv = app.listen(0, async () => {
      const port = srv.address().port;

      try {
        // TEST 2: a direct request that carries the blocked hostname in the
        // Host header — exactly what a censor sees on the wire when a browser
        // tries to reach wikipedia.org.
        const direct = await rawHttp({
          port,
          path: "/",
          hostHeader: "wikipedia.org",
        });
        ok(
          "direct request to wikipedia.org is BLOCKED (403)",
          direct.status === 403,
          "expected 403, got " + direct.status
        );
        ok("block body names the denied host", direct.body.includes("wikipedia.org"));

        console.log("\nTEST 3 - Encoded URL evades the same censor");
        // The proxy path carries the encoded URL. The censor inspects Host
        // and path; neither contains "wikipedia" anymore.
        const proxied = await rawHttp({
          port,
          path: "/service/" + encoded.split("?")[0],
          hostHeader: "localhost:" + port,
        });
        ok(
          "proxied (encoded) request passes the censor (200)",
          proxied.status === 200,
          "expected 200, got " + proxied.status
        );
        ok(
          "proxied request reaches the open internet",
          proxied.body.includes("open internet")
        );

        console.log("\nTEST 4 - Wisp tunnel endpoint accepts WebSocket upgrade");
        const wispOk = await testWispEndpoint();
        ok("wisp server upgrades /wisp/ to a WebSocket", wispOk);
      } catch (err) {
        ok("no errors during request sequence", false, err.message);
      } finally {
        srv.close(resolve);
      }
    });
  });

  console.log("\n--------------------------------------");
  console.log("  Result: " + passed + " passed, " + failed + " failed");
  console.log("--------------------------------------\n");
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
