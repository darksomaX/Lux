// Transport setup. Both UV and Scramjet tunnel through a wisp WebSocket using
// a transport (Epoxy for UV, libcurl for Scramjet). bare-mux exposes
// BareMuxConnection as a named ESM export; we attach it to window.BareMux so
// any code expecting the global (both engines' reference docs use it) works.

import { BareMuxConnection } from "/baremux/index.mjs";

// Expose the global that bare-mux-using code expects.
if (!window.BareMux) {
  window.BareMux = { BareMuxConnection };
}

let connection = null;
let ready = null;

export function getConnection() {
  if (!connection) {
    connection = new BareMuxConnection("/baremux/worker.js");
  }
  return connection;
}

// Configure the transport once. UV uses epoxy; the engine module requests the
// transport it needs via setTransportFor(engine).
export function setTransport(transportPath, options) {
  const conn = getConnection();
  ready = conn.setTransport(transportPath, options);
  return ready;
}

// Both engines use Epoxy over wisp. We previously routed Scramjet through
// libcurl, but @mercuryworkshop/libcurl-transport does not ship its wasm in the
// npm package (it must be built from source via emscripten), so the transport
// loaded but failed at wasm instantiation with a 500. Epoxy's wasm IS shipped,
// and bare-mux makes the transport swappable, so both engines use Epoxy.
export async function setTransportFor(_engineName) {
  const proto = location.protocol === "https:" ? "wss" : "ws";
  const wispUrl = `${proto}://${location.host}/wisp/`;
  return setTransport("/epoxy/index.mjs", [{ wisp: wispUrl }]);
}

export function transportReady() {
  return ready;
}
