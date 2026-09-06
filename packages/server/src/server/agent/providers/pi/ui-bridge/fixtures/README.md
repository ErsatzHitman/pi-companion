# Pi UI payload-compatibility fixtures

Task: T07C (Phase 0, `docs/issues-from-plan.md`). Source requirement: `plan.md`
§4.2 step 7 ("add fixtures for old helper → old client, old helper → new
client, new helper → old client, and new helper → new client").

## Scope

`payload-compat/` has one fixture per combination of Pi UI helper version
(`old`: v1 top-level fields only; `new`: canonical typed `payload`) and client
capability (`old`: has not negotiated `piUiPayloadV2`; `new`: has). Each
fixture carries two exemplar kinds — `log` (a simple top-level array field)
and `diff` (exercises the v1 `diff` → `unifiedDiff` rename) — so the fixtures
prove both plain field lifting and per-kind aliasing survive every direction
of the compatibility matrix, alongside the exhaustive all-ten-kind coverage in
`@picompanion/protocol`'s `pi-ui-bridge/payload.test.ts` and the
`packages/protocol/src/fixtures/pi-ui-bridge/` per-kind fixtures (T06B/T07A).

These fixtures live in this package, not `@picompanion/protocol`, because they
are proven against the actual daemon-boundary code
(`PiUiDecoder`, `normalizePiUiElementInput`, `projectPiUiElementForClient` in
`../payload-compat.ts`) rather than replayed as opaque wire data — see
`../payload-compat.fixtures.test.ts`.

## Format

Each fixture is a JSON object matching `PayloadCompatFixture` (`types.ts`):

- `scenario`, `description`, `planRef`: identification and provenance.
- `helperVersion`: `"old"` or `"new"` — which helper shape authored the
  elements.
- `clientCapability`: `"old"` or `"new"` — whether the receiving client
  negotiated `CLIENT_CAPS.piUiPayloadV2`.
- `elements`: one entry per exemplar kind, each with:
  - `helperInput`: the literal `el` a helper of `helperVersion` would put in a
    v1 PIUI `set` line (`{ v: 1, op: "set", el }`);
  - `expectedNormalizedElement`: `helperInput` after `PiUiDecoder` ingests it
    (plan.md §4.2 step 4 — decoder normalization always attaches a canonical
    `payload`, regardless of which shape the helper sent);
  - `expectedClientElement`: the element as `projectPiUiElementForClient`
    (step 6) sends it to a client of `clientCapability` — i.e., what actually
    reaches the wire.

## Loading fixtures

Use the loader in `index.ts`:

```ts
import {
  listPayloadCompatScenarios,
  loadPayloadCompatFixture,
  loadAllPayloadCompatFixtures,
} from "./fixtures/index.js";

const oldToOld = loadPayloadCompatFixture("old-helper-old-client");
```

## What is intentionally out of scope

Per-kind wire-schema coverage for all ten frozen v1 kinds is
`@picompanion/protocol`'s `pi-ui-bridge/payload.test.ts` and
`packages/protocol/src/fixtures/pi-ui-bridge/` (T07A/T06B). Bridge state
rules (patch/append/TTL/revision handling) are T08's scope. This directory
only covers the helper/client payload-shape compatibility matrix.
