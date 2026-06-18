# Lux

Lux is a self-hostable web proxy for reaching the open internet from behind a restrictive network. It runs on your own machine or your own domain, opens sites in a service-worker tunnel that hides the destination, and ships with a lock, a cloak, an encrypted vault, and an engine switch.

It is meant for journalists, researchers, students, and anyone whose network blocks sites they need. It is not anonymous like Tor: the person running the server can see connection metadata. For source protection, run Lux through Tor or a VPN. Use it lawfully.

Built on [Ultraviolet](https://github.com/titaniumnetwork-dev/Ultraviolet) and [Scramjet](https://github.com/MercuryWorkshop/scramjet) over the [wisp](https://github.com/MercuryWorkshop/wisp-js) protocol, with [Epoxy](https://github.com/MercuryWorkshop/epoxy-tls) and [libcurl](https://github.com/MercuryWorkshop/libcurl-transport) transports.

## Quick start

### One-line install (macOS / Linux / Git Bash)

```sh
curl -fsSL https://raw.githubusercontent.com/darksomaX/Lux/main/install.sh | sh
```

### One-line install (Windows PowerShell)

```powershell
irm https://raw.githubusercontent.com/darksomaX/Lux/main/install.ps1 | iex
```

Each script checks for git and Node 18+, clones Lux, installs dependencies, builds the client bundles, and prints the start command.

### Manual

```sh
git clone https://github.com/darksomaX/Lux
cd Lux
npm install
npm run build     # copies the engine + transport bundles into public/
npm start         # http://localhost:8080
```

Open http://localhost:8080 in Chromium. Type a URL and press enter.

The first time you open Lux it asks for an unlock phrase. The default is the single letter `a`. Change it in Settings before you rely on it.

### Requirements

- Node 18 or newer. Developed on Node 24.
- A browser with service worker support. Chromium is the easiest target. Firefox requires a trusted certificate even on the service worker, so test locally in Chromium first.
- A secure context for the service worker. `http://localhost` counts. From another device you need HTTPS. See Deploy.

## How it works

There is a longer explanation at `/how-it-works.html` once Lux is running. The short version:

1. Lux installs a service worker. Every request the page makes goes through it.
2. The worker rewrites the destination into an encoded path. `wikipedia.org` becomes `/service/hvtrs8%2F-...`. The address bar and the network logs do not show the real destination.
3. The rewritten request rides a single encrypted WebSocket to `/wisp/` on your server. A transport (Epoxy for Ultraviolet, libcurl for Scramjet) then talks to the real site over TLS. The censor sees one ordinary secure connection to your domain.
4. The cloak opens the session in an `about:blank` popup so the address bar and history are blank. Tab disguise swaps the title and favicon. The panic key jumps to a decoy site.

### What Lux gets past, and what it does not

| Censorship | Result |
|---|---|
| IP and hostname blocklists | Beaten. The browser only contacts your server. |
| URL and SNI string filters | Beaten. The destination is encoded. The only cleartext hostname is yours. |
| DPI hunting proxy traffic | Harder. The tunnel looks like a normal secure connection. Rotate the encoder and the domain to make fingerprinting harder. |
| Active probing of your server | Not beaten. A censor that probes your server to see if it proxies can detect it. |
| Blocking your domain | Not beaten. Lux is built to redeploy to a fresh domain quickly. |

Logins work because all traffic is same-origin to your domain, so cookie and OAuth redirect flows resolve. The transports handle the TLS handshake that a bare relay cannot.

## Features

**Engines.** Choose Ultraviolet (the default, well documented) or Scramjet (the newer successor). Both use the same wisp backend. The switch is a setting, not a reinstall.

**URL scheme.** How the destination shows in the address bar.
- `encoded` (default): `/service/<xor>`. Obfuscated.
- `math`: `/math/<base64>`. Reads like a math drill page.
- `plain`: `/service/<url>`. For debugging.
- `none`: no proxy path. The destination is held in an iframe chain instead. Stealthy but fragile.

**Lock.** Lux starts cold. The session is locked until you type a phrase. You can set it to re-lock after idle time, or when the last tab closes. While locked, Lux applies a best-effort disruption of devtools so a quick inspect glance does not read the page. Nothing client-side is a real barrier, but it raises the bar.

**Cloak.** `about:blank` popup launch, tab disguise (Google Classroom, Google Docs, Gmail, Khan Academy, and others), panic key (backtick by default), and an optional close warning.

**Smart iframes.** Lux refuses to proxy itself. If it detects it is running inside another Lux instance, it hands the URL to the top frame and closes the nested tab.

**Extensions.** All run inside proxied pages and are toggleable.
- ClearURLs-style tracking param stripping (utm, gclid, fbclid, and the rest).
- A lightweight ad and element blocker with a hostname denylist.
- An event handling toggle that freezes nuisance events like `beforeunload` overlay traps.
- The Google ad personalization opt-out cookie.

**Kill switch.** Halts traffic if the network changes (online, offline, or a connectivity handoff) or if the apparent egress IP changes. The session stays paused until you confirm the new network. This stops a proxy session from continuing silently onto a hostile Wi-Fi.

**Apparent IP badge.** Shows the IP your traffic appears to come from. If you host in Germany and browse from the US, this confirms the detour is working.

**Vault.** A Phase 2 tool. Files and notes are stored in this browser only, compressed with fflate and sealed with AES-GCM-256. The key derives from your lock phrase via PBKDF2. The server never sees plaintext. See the crypto test below.

**Tools dock.** A small macOS-style dock at the bottom. Browse, Notes, Vault, and Cloak. Items grow on hover.

**Themes.** Light (default, with a dotted field) or dark. A night sky canvas appears behind the home when you go idle.

## Tests

```sh
npm test
```

Two suites.

The censorship sandbox spins up a denylist firewall and proves the encoded request sails through where the cleartext one is blocked, then confirms the wisp endpoint accepts a WebSocket upgrade.

```
TEST 1 - UV XOR codec round-trips the target URL
TEST 2 - Censor blocks the cleartext URL (direct access)   [CENSOR] BLOCKED
TEST 3 - Encoded URL evades the same censor
TEST 4 - Wisp tunnel endpoint accepts WebSocket upgrade
  Result: 10 passed, 0 failed
```

The vault crypto suite seals and opens payloads of several sizes, checks that a wrong passphrase is rejected, and checks that a tampered ciphertext is rejected.

```
  Result: 8 passed, 0 failed
```

These suites cover the evasion logic and the cryptography. They do not cover the full browser to service worker to wisp to target loop, which needs a real browser. Open the app and load a site to confirm that part.

## Deploy

Lux needs a host that can hold a persistent WebSocket. That rules out pure serverless.

| Target | Works | Notes |
|---|---|---|
| Your PC | yes | `npm start` |
| VPS (Hetzner, DigitalOcean) | yes | Behind nginx or Caddy with TLS |
| Render, Railway, Fly.io | yes | Persistent process. Uses the included `Dockerfile` |
| Vercel | no | Serverless functions cannot hold a WebSocket |

Run behind TLS. The service worker requires a secure context. Use Caddy for automatic TLS, or nginx with Let's Encrypt.

### Build step for every deploy

```sh
npm install
npm run build
```

`public/uv`, `public/baremux`, `public/epoxy`, `public/scramjet`, `public/libcurl`, and `public/fflate` are generated by the build and are gitignored. Build before you deploy.

### Environment

- `PORT`: listen port. Default `8080`.
- `HOST`: bind host. Default `0.0.0.0`.
- `NODE_ENV=production`: quiets the wisp logs.

### Fly.io

The `Dockerfile` is included.

```sh
fly launch
fly deploy
```

### Render and Railway

- Build command: `npm install && npm run build`
- Start command: `npm start`

The platform sets `PORT`.

### nginx with TLS and WebSocket passthrough

```nginx
server {
    listen 443 ssl http2;
    server_name your.domain;
    ssl_certificate     /etc/letsencrypt/live/your.domain/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/your.domain/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_read_timeout 86400;
    }
}
```

The `Upgrade` and `Connection` lines are required for the `/wisp/` WebSocket.

## Status endpoints

- `GET /health` returns `{"ok":true}`. Use this for uptime probes.
- `GET /ip` returns `{"ip":"..."}`, the client's apparent egress IP. Honors `X-Forwarded-For`.
- `GET /stats/json` returns uptime, concurrent users, per-hostname counts, and a rolling history.
- `GET /stats/stream` is the same as a server-sent events feed.

The counter tracks concurrent connections per hostname. It stores no user IDs and no PII.

## Project layout

```
server/
  index.js     Express, wisp upgrade handler, SW routes, /ip
  stats.js     concurrent-user counter and SSE
public/
  index.html   home, dock, settings, lock, kill switch, vault panels
  how-it-works.html
  js/          ESM modules: engine, transport, settings, lock, vault, etc.
  cloak/       cloak module and disguise presets
  assets/      Lora woff2 subsets (no external font calls)
  uv/ baremux/ epoxy/ scramjet/ libcurl/ fflate/   built bundles
scripts/
  build-uv.mjs copies and patches the client bundles into public/
tests/
  block-sim/   denylist middleware and evasion test
  vault/       crypto round-trip test
```

## Notes on choices

A few decisions worth flagging.

**Engine scope fix.** Ultraviolet's service worker must intercept the `/service/` prefix. By default a worker only controls the directory its script lives in, so Lux serves the worker at `/uv.sw.js` with a `Service-Worker-Allowed: /` response header and registers it at scope `/`. Without this the page loads but nothing is ever rewritten, which is the most common reason a UV deploy silently fails.

**wisp-js over wisp-server-node.** The original `wisp-server-node` is archived and has known security and stability problems. Lux uses `@mercuryworkshop/wisp-js`, the maintained replacement. It is a drop-in for the server API.

**AGPL license.** wisp-js is AGPL-3.0, so Lux is too. If you modify Lux and let users interact with it over a network, you must offer them your modified source under the same terms.

**Client-side font.** Lora is vendored as woff2 subsets in `public/assets/`. Lux makes no calls to Google Fonts at runtime.

## License

AGPL-3.0-or-later. Ultraviolet and Scramjet are MIT. See their repositories for those terms.
