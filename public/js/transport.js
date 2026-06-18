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

// UV -> Epoxy over wisp. Scramjet -> libcurl over wisp.
export async function setTransportFor(engineName) {
  const proto = location.protocol === "https:" ? "wss" : "ws";
  const wispUrl = `${proto}://${location.host}/wisp/`;

  if (engineName === "scramjet") {
    return setTransport("/libcurl/index.mjs", [{ websocket: wispUrl }]);
  }
  return setTransport("/epoxy/index.mjs", [{ wisp: wispUrl }]);
}

export function transportReady() {
  return ready;
}
