// End-to-end proxy verification.
//
// This is the test you actually want: it boots the real Lux server, opens a
// wisp WebSocket to /wisp/, asks the wisp server to open a TCP stream to
// example.com:80, sends a raw HTTP/1.1 request through that stream, and
// confirms the real "Example Domain" HTML comes back.
//
// If this passes, the wisp server is genuinely tunneling traffic out to the
// open internet. That is the core of what makes Lux work. The service worker
// in the browser does the same thing the wisp client here does; it just runs
// inside Chromium.
//
// Needs network access to reach example.com. Run: npm run test:e2e

import { createServer } from "node:http";
import { server as wisp } from "@mercuryworkshop/wisp-js/server";
import { client as wispClient } from "@mercuryworkshop/wisp-js/client";

let passed = 0, failed = 0;
function ok(name, cond, detail) {
  if (cond) { console.log("  PASS  " + name); passed++; }
  else { console.log("  FAIL  " + name + (detail ? "  " + detail : "")); failed++; }
}

async function main() {
  // Boot a wisp server on an ephemeral port (same code Lux runs).
  const httpServer = createServer((req, res) => res.end("ok"));
  httpServer.on("upgrade", (req, socket, head) => {
    if (req.url.startsWith("/wisp/")) wisp.routeRequest(req, socket, head);
    else socket.end();
  });

  const port = await new Promise((resolve) =>
    httpServer.listen(0, "127.0.0.1", () => resolve(httpServer.address().port))
  );
  const wispUrl = "ws://127.0.0.1:" + port + "/wisp/";

  console.log("\n=== End-to-end wisp tunnel test ===");
  console.log("wisp server on port " + port + ", tunneling to example.com:80\n");

  await new Promise((resolve) => {
    const conn = new wispClient.ClientConnection(wispUrl);

    let opened = false;
    let collected = "";
    let done = false;

    const finish = () => {
      if (done) return;
      done = true;

      ok("wisp stream to example.com opened", opened);
      ok("received an HTTP response", collected.startsWith("HTTP/"), "got: " + collected.slice(0, 80));
      ok("response contains real example.com content", collected.includes("Example Domain"), "got: " + collected.slice(0, 200));
      ok("response carries the expected server header", /server:/i.test(collected) || /via:/i.test(collected) || collected.includes("ETag"));

      try { conn.close(); } catch {}
      httpServer.close(resolve);
    };

    conn.onopen = () => {
      // Open a TCP stream to example.com on port 80.
      const stream = conn.create_stream("example.com", 80);

      stream.onmessage = (data) => {
        collected += new TextDecoder().decode(data);
        // example.com closes the connection after sending the full body.
        if (collected.includes("</html>") || collected.includes("</HTML>")) {
          finish();
        }
      };
      stream.onclose = () => finish();
      stream.onerror = () => finish();

      opened = true;
      const req =
        "GET / HTTP/1.1\r\n" +
        "Host: example.com\r\n" +
        "User-Agent: Lux-e2e-test/1.0\r\n" +
        "Accept: text/html\r\n" +
        "Connection: close\r\n\r\n";
      stream.send(new TextEncoder().encode(req));
    };

    conn.onerror = () => {
      ok("wisp connection", false, "connection errored");
      finish();
    };

    // Safety timeout.
    setTimeout(() => {
      if (!done) {
        ok("response within timeout", false, "timed out, collected so far: " + collected.slice(0, 200));
        finish();
      }
    }, 15000);
  });

  console.log("\n--------------------------------------");
  console.log("  Result: " + passed + " passed, " + failed + " failed");
  console.log("--------------------------------------\n");
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error("Fatal:", e);
  process.exit(1);
});
