# @picompanion/bridge

Thin Pi-side helper for the Pi UI Bridge (`docs/pi-ui-bridge.md`).

One call site renders in both TUI and RPC:

```ts
import { ui, publish, install } from "@picompanion/bridge";

export default function loopExtension(pi) {
  install(pi); // binds pi/ctx and registers `pi_ui_event` command once

  const panel = ui.panel("loop", {
    title: "loop 01",
    placement: "sheet",
    sections: [{ kind: "progress", id: "round", value: 3, max: 8, label: "round 3 of 8" }],
    actions: [{ id: "stop", label: "Stop", variant: "danger" }],
  });
  panel.patch("round", { value: 4 });
  panel.append("history", "check: 2 failures");
  panel.on("stop", () => loop.abort());
  panel.close(); // or panel.close({ durable: true })
}

// publish in-process channel + PIUI marker in RPC mode
publish("subagents:fleet", fleetPayload);
publish("workflow:progress", progressPayload);
publish("pi-goal:status", goalPayload);

// raw elements
ui.widget("todo", { title: "todo", lines: ["3 items"] });
ui.status("plan-mode", "!mode");
ui.progress("wf", { value: 2, max: 5 });
ui.roster("subagents", { rows: [] });
ui.log("history", { lines: [] });
ui.markdown("preview", "# hello");
ui.diff("review", "@@ -1 +1 @@");
ui.form("ask", [{ id: "q", kind: "text", label: "Q" }]);
ui.composer("rewrite your prompt here");
```

## Dual rendering

- `ctx.hasUI === false` or `mode === "print"|"json"` → no-op.
- `mode === "tui"` → uses `ctx.ui.custom` / `setWidget` / `setStatus` / `setEditorText`.
- `mode === "rpc"` → emits `PIUI ` marker via `ctx.ui.notify("PIUI " + JSON.stringify({...}))` — same framing as Paseo's `PASEO_ENTRY_CAPTURE` marker. The daemon's `PiUiDecoder` reassembles chunks and updates `PiUiState`.

## Rate limiting & chunking

- `patch` ops are coalesced per element on a 100 ms timer (§2.3).
- Payloads >32 KiB are split into `PIUI {"v":1,"op":"chunk",id,i,n,data}` frames, reassembled by the daemon (1 MiB cap).

## Action routing

`install(pi)` registers `pi_ui_event` once:

```
/pi_ui_event <base64url of {v:1, elementId, actionId, value}>
→ pi.events.emit(`piui:${ns}`, payload)
→ panel.on(actionId, cb)
```

## Daemon-injected fallback

Extensions that import this package work **without** daemon injection. As a fallback for older extensions the daemon may also pass the standalone extension:

```
pi --mode rpc --extension /path/to/packages/pi-bridge/pi-companion-bridge.mjs
```

That file is the same `pi_ui_event` registration in a self-contained mjs.
