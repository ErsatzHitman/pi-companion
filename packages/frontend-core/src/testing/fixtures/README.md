# Shared fixture/contract builders (T24)

Fixtures and builders this directory exports are consumed by three things:

- `../recorded-session.test.ts` in this package — the plan.md §13 Phase 2
  exit test: "node tests can drive a complete recorded session from hello
  through reconnect, gap recovery, extension action, and final correction
  without React."
- `apps/web`'s test suites (e.g. the T27A connect/pairing flow, the T25A
  component lab).
- `apps/android`'s test suites (e.g. the T32A onboarding flow, the T26A
  component lab).

## Layout

- `types.ts` — `FixtureFrame`/`RecordedSessionChapter`, mirroring
  `packages/protocol/src/fixtures/types.ts` and
  `../../timeline/fixtures/types.ts`'s shape so every fixture set in this
  repository reads the same way.
- `recorded-session.ts` — `loadRecordedSessionFixture`,
  `loadRecordedSessionChapter`, `listRecordedSessionChapters`: the five
  chapters (`hello`, `reconnect`, `gapRecovery`, `extensionAction`,
  `correction`) that make up the Phase 2 exit fixture. Three chapters are
  new TS-literal frames that mirror already-recorded
  `@picompanion/protocol` fixtures (`fixtures/daemon-ws/hello-capability-negotiation.json`,
  `fixtures/daemon-ws/reconnect-with-gap.json`'s hello pair,
  `fixtures/pi-ui-bridge/composer.json`); two chapters (`gapRecovery`,
  `correction`) reuse `../../timeline/fixtures`'s existing `gap-backfill`
  and `assistant-message-correction` scenarios directly rather than
  duplicating them.
- `host-profiles.ts` — `buildDirectHostProfileFixture`,
  `buildRelayHostProfileFixture`, `buildDualConnectionHostProfileFixture`:
  synthetic `HostProfile` values for connect/pairing/onboarding suites.
- `primitive-lab.ts` — plain-data cases for every plan.md §10.3 primitive
  (Button, Chip, StatusIndicator, ...) plus `primitiveLabManifest`, the
  list both platforms' component labs assert "every primitive renders"
  against (T25A/T26A).
- `recipe-lab.ts` — the same shape one layer up: plain-data cases for
  every plan.md §10.4 product recipe (ThinkingSection, ApprovalForm,
  CommandSearch, ...) plus `recipeLabManifest` (T25B/T26B).

As with `../../timeline/fixtures`, everything here is a typed TS module, not
a JSON file read at runtime: this package's purity guard
(`../../import-guard.test.ts`, `../../.oxlintrc.json`) disallows Node
ambient globals (`node:fs`, etc.) under `src/`, and a static import keeps
these fixtures loadable from any bundler (web/Android), not only from a
Node test runner.

All ids, hostnames, endpoints, and timestamps are synthetic; none of this
was captured from a real daemon, relay, or Pi session, and nothing here was
copied from `D:\paseo`'s frontend (plan.md §5) — behavior this mirrors was
observed there and re-expressed as a new fixture/test, never as copied
code.

## Usage

```ts
import { loadRecordedSessionFixture } from "./recorded-session.js";

const chapters = loadRecordedSessionFixture();
const hello = chapters.find((chapter) => chapter.chapter === "hello")!;
```
