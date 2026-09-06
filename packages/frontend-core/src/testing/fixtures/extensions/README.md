# §11.7 extension fixtures (T40A1 / T40A2)

Canonical Pi UI Bridge payload fixtures for plan.md §11.7's "First-class UI
through bridge elements" table — the twelve extensions that need a custom
renderer, as opposed to the headless (§11.7 "no custom renderer required")
or backend-transcript-protection extensions.

## Split

Twelve extensions, split across two tasks that both own this directory
(serialized: T40A2 `depends-on` T40A1, so they never edited concurrently).
Both halves are now covered:

- **T40A1** (P6-W1): `loop`, `subagents`, `todo`, `advisor`,
  `minimal-status`, `plan-mode`, `pi-goal`, `prompt-arbitrage`.
- **T40A2** (P6-W2): `btw`, `switchboard`, `workflows`, and rich `ask-user`
  — the four T40A2's own brief names explicitly.

`index.ts`'s `EXTENSION_FIXTURES` list is the single source of truth for
which extensions are covered; `listExtensionFixtures()` reflects it exactly,
and `extensions.test.ts`'s coverage suite asserts the list equals all
twelve §11.7 bridge-elements table entries.

## Layout

Mirrors `../../timeline/fixtures/` and `../recorded-session.ts`'s own
layout so every fixture set in this repository reads the same way:

- `types.ts` — `ExtensionFixtureScenario`, reusing `../types.ts`'s
  `FixtureFrame` shape.
- `wire.ts` — `agentStreamEventFromFrame`, `agentStreamMessageFromFrame`,
  `sessionInboundMessageFromFrame`, `sessionOutboundMessageFromFrame`,
  `frameById`: validates a fixture frame through the real wire schemas
  (`@picompanion/protocol/messages`'s `WSOutboundMessageSchema` /
  `WSInboundMessageSchema`) rather than an invented shape. Extends
  `../../timeline/fixtures/wire.ts`'s pattern with the inbound-direction
  helper that pattern never needed (a `pi.ui.action.request` frame travels
  `client_to_daemon`).
- `scenarios/<extension>.ts` — one `ExtensionFixtureScenario` per covered
  extension: an ordered list of literal wire frames — the element
  `pi_ui_delta` upsert(s) the daemon actually sends, and, where the
  extension exposes an action, the matching `pi.ui.action.request` /
  `pi.ui.action.response` / `pi_ui_action_result` triple.
- `index.ts` — `loadExtensionFixture`, `listExtensionFixtures`,
  `loadAllExtensionFixtures`.
- `extensions.test.ts` — the round-trip proof (see below).

## Provenance

Every fixture's required-UI shape is grounded in one of two places, cited
in that scenario file's own doc comment:

1. **The wire schema itself**
   (`packages/protocol/src/pi-ui-bridge/{schema,payload,primitives}.ts`) —
   every element and payload here is built to satisfy the real
   `PiUiElementSchema` / `piUiPayloadSchemaForKind`, not an approximation of
   it.
2. **This repository's own Phase 0 re-audit**
   (`docs/pi-extension-compatibility.md` §3.3), which records the actual
   installed extensions' helper calls, bridge kinds, actions, and channel
   routing as of 2026-08-31/2026-09-04. That document is reference material
   (per `CLAUDE.md`'s reference-only list) describing this product's
   _current_ extension ecosystem, not a specification — plan.md §11.7 is the
   spec. Where the two disagree (`plan-mode`, see `scenarios/plan-mode.ts`'s
   doc comment), the fixture follows the spec's required shape and
   discloses the gap rather than silently picking one.
3. For the channel-routed extensions (`subagents`, `pi-goal`, and
   `workflows`' progress element), the fixture is the shape the client
   actually receives _after_ daemon synthesis, verified directly against
   `packages/server/src/server/agent/providers/pi/ui-bridge/state.ts`'s
   `applyChannel` (production code, not a doc claim) — the extension-internal
   channel payload never reaches the client and is not fixtured here.
   `workflows` also disclosed a real gap this way (see `scenarios/
workflows.ts`'s doc comment): `applyChannel`'s `"workflow:progress"` case
   used to never lift `step`/`total` into the typed `progress` payload's
   `value`/`max`, so a renderer reading only the typed payload saw no
   numeric progress. **T40A3 closed this** by teaching that `applyChannel`
   case to alias `step`/`total` to `value`/`max` before normalization runs
   (mutation-proven in `state.test.ts`); this fixture's synthesized progress
   element now carries the fixed, real shape.

All ids, paths, and secrets are synthetic (plan.md §14.2:
`/tmp/synthetic-*`); nothing here was captured from a real daemon or Pi
session, and nothing here was copied from `D:\paseo`'s frontend (plan.md
§5) — behavior this mirrors was read there or in the Phase 0 audit and
re-expressed as a new fixture, never as copied code.

## Round-trip proof

`extensions.test.ts` proves each fixture round-trips through the _real_
production path, not that it merely parses:

1. Every frame's `message` parses through `WSOutboundMessageSchema` /
   `WSInboundMessageSchema` (the real wire schema).
2. Every `pi_ui_delta` frame's event is fed to a real
   `PiUiElementStore.ingestEvent` (`../../../extensions/state.ts`, T21B),
   exactly as `frontend-core`'s event parser would; the outcome must be
   `{ action: "applied" }`.
3. The element the store actually stored (`store.getElements(agentId)`) is
   read back, and its `payload` is re-parsed through
   `piUiPayloadSchemaForKind(kind)` (`@picompanion/protocol/pi-ui-bridge/payload`)
   to confirm the canonical payload survived normalization+storage intact —
   not just that the raw fixture object happened to satisfy a schema in
   isolation.
4. Every `pi.ui.action.request`/`pi.ui.action.response`/
   `pi_ui_action_result` triple parses through the same real schemas.

## Usage

From inside this package (e.g. `extensions.test.ts`, a colocated sibling
under `src/`), import the loader directly:

```ts
import { loadExtensionFixture } from "./index.js";

const loop = loadExtensionFixture("loop");
const upsert = loop.frames[0];
```

From `apps/web` or `apps/android` (T98): `frontend-core`'s `package.json`
`exports` map has a single `"."` entry, so there is no subpath import for
this directory — go through the package's `testing.extensions` namespace
instead, exported by `../../index.ts` (T98):

```ts
import { testing } from "@picompanion/frontend-core";

const loop = testing.extensions.loadExtensionFixture("loop");
const upsert = loop.frames[0];
```
