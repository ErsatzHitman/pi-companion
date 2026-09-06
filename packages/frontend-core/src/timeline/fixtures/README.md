# Timeline reducer fixtures (T20A, T20B)

Synthetic fixtures for `frontend-core`'s timeline reducer (`../reducer.ts`), scoped to
tasks T20A and T20B (`docs/issues-from-plan.md`) and plan.md §7.4.

## Why fixtures live here instead of only reusing `packages/protocol`'s

`packages/protocol/src/fixtures/daemon-ws` (T06B) and
`packages/protocol/fixtures/pi-rpc-events` (T06A) do not contain scenarios that
exercise assistant-message correction (`replaceMessageId`) or tool-call
lifecycle merging at the wire (`agent_stream`/`fetch_agent_timeline_response`)
level — T06A's `corrected-message-end.json` records that behavior only at the
Pi-RPC level (`message_start`/`message_update`/`message_end`), one layer below
what `frontend-core` actually consumes. The two scenario files here translate
that same behavior into the actual wire shape the timeline reducer ingests,
using the real, already-validated `AgentStreamMessageSchema` /
`WSOutboundMessageSchema` from `@picompanion/protocol`, so `reducer.test.ts`
proves the invariants against wire-valid data rather than an invented shape.

For the epoch-reset invariant, `reducer.test.ts` reuses the already-recorded
`packages/protocol/src/fixtures/daemon-ws/reconnect-with-gap.json` fixture
directly (via `@picompanion/protocol/fixtures/index.js`) instead of
duplicating it here.

## Layout

Same `{ frames: [...] }` shape as `packages/protocol/src/fixtures`: each frame
has `id`, `direction`, `wireType`, an optional `note`, and `message` — the
literal `{ type: "session", message: <SessionOutboundMessage> }` WebSocket
envelope. Every frame's `message` is validated against
`WSOutboundMessageSchema` in `reducer.test.ts`.

Scenarios are typed TS modules exporting a `TimelineFixtureScenario` object,
not JSON files read at runtime: this package's purity guard
(`../../import-guard.test.ts`, `../../.oxlintrc.json`) disallows Node
ambient globals (`node:fs`, etc.) anywhere under `src/`, and a static import
also keeps these fixtures loadable from any bundler — a future web or
Android component lab (plan.md §13 Phase 3) can reuse them without a
filesystem.

- `scenarios/assistant-message-correction.ts` — an exact re-delivery
  (dedupe), followed by a `replaceMessageId` correction. (T20A)
- `scenarios/tool-call-lifecycle.ts` — two interleaved tool calls with
  start/update/end rows and an exact re-delivery. (T20A)
- `scenarios/gap-backfill.ts` — a live-stream seq jump opens a gap; two
  `fetch_agent_timeline_response` backfill pages close it in sequence.
  (T20B, plan.md §7.4 "detect gaps and page until complete".)
- `scenarios/optimistic-user-message.ts` — a confirmed `user_message` row
  reconciles a locally-added optimistic row via `clientMessageId`. (T20B,
  plan.md §7.4 "reconcile optimistic user rows with accepted daemon rows".)
- `scenarios/restart-recovery.ts` — a daemon restart mid-turn replays the
  client's own in-flight submission under a reset epoch. (T20B, plan.md
  §7.4 "recover after app restart during an active turn".)
- `scenarios/message-attachments.ts` — a `user_message` with one referenced
  image, a plain text-only `assistant_message`, and a `replaceMessageId`
  correction that itself carries an image. Exercises `transcript-view.ts`'s
  `images` passthrough on both message kinds, including the "no images key
  when there are none" case. (T52A2, plan.md §7.4, §11.1, §11.6.)
- `wire.ts` — `agentStreamMessageFromFrame`, `fetchAgentTimelineResponseFromFrame`,
  `frameById`: shared helpers that validate a frame's envelope through the
  real `WSOutboundMessageSchema` and extract the inner message. Used by both
  `../reducer.test.ts` (T20A) and T20B's additional test files.
- `index.ts` — `listTimelineFixtureScenarios`, `loadTimelineFixtureScenario`,
  `loadAllTimelineFixtureScenarios`.

All ids, paths (`/synthetic/workspace/...`), and timestamps are synthetic;
none of this was captured from a real daemon or Pi session.

## Usage

```ts
import { loadTimelineFixtureScenario } from "./index.js";

const scenario = loadTimelineFixtureScenario("assistant-message-correction");
```
