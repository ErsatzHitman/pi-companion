# Daemon WebSocket and Pi UI Bridge fixtures

Task: T06B (Phase 0, `docs/issues-from-plan.md`). Source requirement: `plan.md` §14.2
("Required contract fixtures") and §11.3 ("Frozen bridge vocabulary").

## Scope

This directory records, as plain synthetic-data JSON, the daemon-side WebSocket
sequences plan.md §14.2 calls out for T06B:

- `daemon-ws/hello-capability-negotiation.json` — hello and server capability
  negotiation.
- `daemon-ws/session-new.json`, `session-import-terminal.json`,
  `session-resume.json`, `session-archive.json` — the four session lifecycle
  scenarios (new session, imported terminal session, resume, archive).
- `daemon-ws/permission-dialog.json` — a tool permission request, response, and
  resolution.
- `daemon-ws/reconnect-with-gap.json` — a resumed hello followed by a timeline
  fetch whose cursor references an epoch the daemon no longer has (`gap: true`,
  `reset: true`), including a `pi_ui_snapshot` timeline entry so Pi UI Bridge
  state is fully replayed rather than incrementally patched.

`pi-ui-bridge/` has one fixture per Pi UI Bridge kind, covering all ten v1
kinds from plan.md §11.3: `status`, `widget`, `panel`, `progress`, `roster`,
`log`, `markdown`, `diff`, `form`, `composer`. Kinds that carry actions (panel,
roster, form, composer) include the full `pi.ui.action.request` →
`pi.ui.action.response` → `pi_ui_action_result` round trip from plan.md §12.3.

Every fixture uses synthetic ids, paths (`/synthetic/workspace/...`), and
timestamps. None of it was captured from a real daemon, real Pi session, or
this machine; `fixtures.test.ts` asserts none of the real-path/secret patterns
appear.

## Format

Each fixture is a JSON object with a `frames` array. Every frame has:

- `direction`: `"client_to_daemon"` or `"daemon_to_client"`;
- `wireType`: a human-readable label (not validated);
- `message`: the literal WebSocket JSON envelope, i.e. exactly what
  `WSInboundMessageSchema` (client → daemon) or `WSOutboundMessageSchema`
  (daemon → client) from `@picompanion/protocol` accepts.

`fixtures.test.ts` parses every frame's `message` through the real wire schema
for its direction, so a fixture that drifts from the protocol fails the suite.

## Loading fixtures

Use the loader in `index.ts` rather than reading the JSON files directly:

```ts
import {
  listDaemonWsScenarios,
  loadDaemonWsFixture,
  listPiUiBridgeKinds,
  loadPiUiBridgeFixture,
} from "@picompanion/protocol/fixtures/index";

const hello = loadDaemonWsFixture("hello-capability-negotiation");
const roster = loadPiUiBridgeFixture("roster");
```

No live daemon or Pi agent is required to load or replay any fixture here.

## What is intentionally out of scope

The current `PiUiElementSchema` (see `../pi-ui-bridge/schema.ts`) only carries
the common envelope fields (`id`, `ns`, `kind`, `placement`, `title`,
`actions`, `ttl`, `durable`). It does not yet have a canonical, kind-specific
`payload` field, so these fixtures do not attempt to encode kind-specific
content (log lines, diff hunks, form fields, roster rows, etc.) beyond what the
real wire schema accepts today. Adding that typed payload schema and the
`piUiPayloadV2` capability gate is T07A's job (`docs/issues-from-plan.md`);
these fixtures are its starting point.

Pi RPC event fixtures (agent/turn/message lifecycle, tool execution, queues,
compaction, retries, extension errors) are T06A's scope, not this directory's.
Transcript-protection tests (hidden `display:false` content, corrected
`message_end`) are T06C's scope.
