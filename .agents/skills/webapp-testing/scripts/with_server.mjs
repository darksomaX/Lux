#!/usr/bin/env node
// with_server.mjs — boot a server, wait for its port, run a test command,
// then tear the server down. Modeled on the Anthropic webapp-testing helper
// but Node-native so it fits a Node/Express project with no Python dep.
//
// Usage:
//   node with_server.mjs --server "npm start" --port 8080 -- <test command>
//
// Multiple servers:
//   node with_server.mjs \
//     --server "npm run backend" --port 3000 \
//     --server "npm run frontend" --port 5173 \
//     -- node test.mjs
//
// The test command's exit code is propagated. Servers are killed on exit.

import { spawn } from "node:child_process";
import net from "node:net";

function parseArgs(argv) {
  const servers = [];
  let port = 8080;
  const cmd = [];
  let i = 0;
  while (i < argv.length) {
    const a = argv[i];
    if (a === "--server") { servers.push({ cmd: argv[++i] }); }
    else if (a === "--port") { port = Number(argv[++i]); servers[servers.length - 1].port = port; }
    else if (a === "--") { cmd.push(...argv.slice(i + 1)); break; }
    else if (a === "--help" || a === "-h") { printHelp(); process.exit(0); }
    else { i++; continue; }
    i++;
  }
  // Assign ports to servers that didn't get an explicit one following --port.
  return { servers, cmd };
}

function printHelp() {
  console.log(`with_server.mjs — run a test command against a booted server.

Usage:
  node with_server.mjs --server "<start cmd>" [--port N] -- <test cmd>

Multiple servers: repeat --server / --port pairs.

The helper waits until each declared port accepts a TCP connection before
running the test command, then kills the servers when the test exits.`);
}

function waitForPort(port, host = "127.0.0.1", timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const tryConnect = () => {
      const sock = net.connect(port, host);
      sock.once("connect", () => { sock.destroy(); resolve(); });
      sock.once("error", () => {
        if (Date.now() - start > timeoutMs) reject(new Error("timeout waiting for port " + port));
        else setTimeout(tryConnect, 250);
      });
    };
    tryConnect();
  });
}

const procs = [];
function cleanup(code) {
  for (const p of procs) {
    try { p.kill("SIGTERM"); } catch {}
    setTimeout(() => { try { p.kill("SIGKILL"); } catch {} }, 2000);
  }
  process.exit(code);
}
process.on("exit", () => procs.forEach((p) => { try { p.kill(); } catch {} }));
process.on("SIGINT", () => cleanup(130));
process.on("SIGTERM", () => cleanup(143));

async function main() {
  const { servers, cmd } = parseArgs(process.argv.slice(2));
  if (!servers.length) { console.error("No --server given."); printHelp(); process.exit(2); }
  if (!cmd.length) { console.error("No test command after --"); printHelp(); process.exit(2); }

  for (const s of servers) {
    const sh = process.platform === "win32";
    const child = spawn(sh ? process.env.ComSpec || "cmd.exe" : "/bin/sh", sh ? ["/c", s.cmd] : ["-c", s.cmd], {
      stdio: ["ignore", "inherit", "inherit"],
      shell: false,
    });
    procs.push(child);
    if (s.port) {
      console.log(`with_server: waiting for port ${s.port} (${s.cmd})...`);
      await waitForPort(s.port);
      console.log(`with_server: port ${s.port} is up.`);
    }
  }

  const [testBin, ...testArgs] = cmd;
  const test = spawn(testBin, testArgs, { stdio: "inherit", shell: false });
  test.on("exit", (code) => cleanup(code ?? 1));
}

main().catch((e) => { console.error("with_server fatal:", e); cleanup(1); });
