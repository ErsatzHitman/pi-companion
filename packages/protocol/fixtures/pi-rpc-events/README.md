# Pi RPC event fixtures

Shared, synthetic fixtures for the Pi RPC event stream that
`packages/server/src/server/agent/providers/pi/*` consumes from a running Pi CLI
process (see `rpc-types.ts` in that package for the canonical `PiRuntimeEvent`
shapes these fixtures mirror).

This directory is the "shared fixtures directory" called for by plan.md's
protocol/bridge fixture requirements (§14.2) for the Pi-RPC-level bullets. It is
scoped to task T06A (capture the fixtures); the daemon-side transcript-protection
tests that consume the `hidden-custom-message` and `corrected-message-end`
scenarios against the real daemon projection are a separate follow-on task.

## Why synthetic, not recorded

No live Pi session/API credentials were available while authoring this fixture
set. Every event, path, secret, and identifier below is fabricated to match the
real shapes exactly (verified against `rpc-types.ts`) but contains no data from
an actual session. Paths use `/synthetic/...`, tokens use `sk-synthetic-...`,
and session/tool-call ids are prefixed `synthetic-`/`call-synthetic-`. Anyone
recording a real fixture later must scrub paths/secrets to the same convention
before committing it here.

## Layout

- `scenarios/*.json` — one ordered event sequence per scenario. Each file has:
  - `scenario`: short slug (matches the file name)
  - `description`: what the sequence demonstrates
  - `planBullets`: which plan.md §14.2 bullet(s) this scenario proves, if any
  - `notes` (optional): caveats, e.g. where the real Pi RPC surface is
    ambiguous or not yet reflected in the ported types
  - `sessionId` (optional): a synthetic session id for context
  - `events`: the ordered `PiRuntimeEvent`-shaped objects
- `index.ts` — loads scenarios at runtime (`loadPiRpcFixtureScenarios`,
  `loadAllPiRpcFixtureEvents`) and exports `PI_RPC_EVENT_TYPES`, the canonical
  list of the 21 required Pi RPC event types from plan.md.
- `coverage.test.ts` — asserts every scenario is well-formed, that the 21
  required event types all appear at least once across the fixture set, that
  every Pi-RPC-level §14.2 bullet this task owns has a covering scenario, and
  that no fixture contains a real-looking home directory path.

## Scenario -> event type coverage

| Scenario file                           | plan §14.2 bullet(s)             | Event types introduced                                                                                                                                                           |
| --------------------------------------- | -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `agent-lifecycle.json`                  | (full-coverage support)          | `agent_start`, `turn_start`, `turn_end`, `agent_end`, `agent_settled`                                                                                                            |
| `streaming-text-and-thinking.json`      | streaming text and thinking      | `message_start`, `message_update`, `message_end`                                                                                                                                 |
| `tool-calls-single-and-multi-edit.json` | single and multi-edit tool calls | `tool_execution_start`, `tool_execution_end`, `tool_execution_update`                                                                                                            |
| `partial-tool-output-and-failure.json`  | partial tool output and failure  | (reuses tool*execution*\*)                                                                                                                                                       |
| `steer-and-follow-up-queue.json`        | steer and follow-up queue        | `queue_update`                                                                                                                                                                   |
| `compaction-and-retries.json`           | compaction and retries           | `compaction_start`, `compaction_end`, `auto_retry_start`, `auto_retry_end`, `summarization_retry_scheduled`, `summarization_retry_attempt_start`, `summarization_retry_finished` |
| `hidden-custom-message.json`            | hidden custom message            | (reuses message_start/message_end with `role: "custom", display: false`)                                                                                                         |
| `corrected-message-end.json`            | corrected message_end            | (reuses message_start/message_update/message_end; two `message_end`s share one `responseId` with different final content)                                                        |
| `unknown-tool-call.json`                | unknown tool                     | (reuses tool_execution_start/end with an unrecognized `toolName`)                                                                                                                |
| `bash-execution.json`                   | (full-coverage support)          | `bash_execution_update`                                                                                                                                                          |
| `extension-error.json`                  | (full-coverage support)          | `extension_error`                                                                                                                                                                |

That is all 21 types named in plan.md's Pi RPC event list.

## `bash_execution_update` note

`bash_execution_update` is named explicitly in plan.md's 21-type list, but the
ported `packages/server/.../pi/rpc-types.ts` `PiAgentSessionEvent` union does
not currently declare it as a literal — it only models the _settled_ result as
a `message_start`/`message_end` pair with `role: "bashExecution"`. The
`bash-execution.json` fixture captures a plausible streaming-update shape
(mirroring the settled message's `command`/`output`/`exitCode`/`cancelled`/
`timestamp` fields) so downstream consumers have real data to code against.
Widening `rpc-types.ts` to declare this literal is out of this task's scope
and left for whoever implements the corresponding runtime handling.

## Out of scope for this fixture set

The following plan §14.2 bullets are daemon/bridge-level, not Pi-RPC-event-level,
and are intentionally not captured here (they belong with the daemon WebSocket /
bridge contract fixtures instead):

- hello and server capability negotiation
- new session, imported terminal session, resume, and archive
- permission and timed extension dialog
- every Pi UI kind
- action success, rejection, timeout, and stale revision
- reconnect with timeline gap and Pi UI full replay
- unknown bridge kind

## Usage

```ts
import {
  loadPiRpcFixtureScenarios,
  loadAllPiRpcFixtureEvents,
  PI_RPC_EVENT_TYPES,
} from "../../fixtures/pi-rpc-events/index.js";
```

Run just this fixture set's tests:

```bash
npx vitest run packages/protocol/fixtures/pi-rpc-events/coverage.test.ts
```
