// pi-companion-bridge.mjs — optional daemon-injected Pi extension
// Provides the pi_ui_event command so taps on Pi UI elements round-trip to the
// owning extension via pi.events. Extensions that import @picompanion/bridge
// already install this command themselves; this file is only needed for older
// extensions or as the daemon's --extension fallback.
// Usage (daemon): pi --mode rpc --extension /path/to/pi-companion-bridge.mjs

function decodePayload(b64) {
  // base64url -> utf8
  const pad = b64.length % 4 === 0 ? "" : "=".repeat(4 - (b64.length % 4));
  const b64std = b64.replace(/-/g, "+").replace(/_/g, "/") + pad;
  return JSON.parse(Buffer.from(b64std, "base64").toString("utf8"));
}

export default function piCompanionBridge(pi) {
  // Capture ctx when available (session_start carries it)
  let lastCtx = null;
  try {
    pi.on("session_start", (_e, ctx) => {
      lastCtx = ctx;
    });
  } catch {}

  pi.registerCommand("pi_ui_event", {
    description: "Internal Pi Companion UI bridge",
    handler: async (args, ctx) => {
      if (ctx) lastCtx = ctx;
      const raw = (args ?? "").trim();
      if (!raw) return;
      let dec;
      try {
        dec = decodePayload(raw);
      } catch {
        return;
      }
      const elId = dec.elementId;
      const act = dec.actionId;
      const ns = elId ? String(elId).split(":")[0] : dec.ns;
      const value = dec.value ?? dec.payload;
      const payload = { elementId: elId, actionId: act, value, raw: dec };
      if (ns)
        try {
          pi.events.emit(`piui:${ns}`, payload);
        } catch {}
      if (elId && act) {
        try {
          pi.events.emit(`piui:${elId}:${act}`, payload);
        } catch {}
      }
      // resync support: daemon may send {op:"resync"} -> re-emit current bridge state request
      if (dec.op === "resync") {
        try {
          pi.events.emit("piui:resync", dec);
        } catch {}
      }
    },
  });
}
