# Pi Companion Frontend Rebuild Plan

**Status:** approved architecture, implementation not started

**Prepared:** 2026-08-31

**Repository:** `D:\pi-companion` — a new repository built from scratch

**Reference codebase:** `D:\paseo` at Paseo `v0.3.0-beta.2` (read-only reference; never a git remote)
**Authoritative direction:** this `plan.md` is the sole plan for the new repository and supersedes every earlier plan, including all documents from the abandoned fork experiment. Earlier documents remain useful only as historical or backend references.

## Read this first

Pi Companion is a new repository built from scratch. It is not a git fork of Paseo: there is no fork history, no upstream remote, and no inherited working tree. `D:\paseo` is used strictly as a behavioral and code reference. Its daemon, wire protocol, client SDK, relay, connection/auth flow, CLI, Pi provider, and pi-bridge contain the difficult systems work; that logic is taken over — copied, vendored, or re-implemented under `@picompanion/*` with AGPL compliance — while its frontend is not.

No legacy frontend is carried over at all. Paseo's `packages/app` frontend — including the Pi UI renderers and Beautiful component work produced during the abandoned fork experiment — never enters this repository. Do not copy it, port it, or use it as the base of the new product. Build two new frontends from blank application scaffolds:

1. a DOM-first web application;
2. a native Android application built with Expo and React Native.

They will share one framework-neutral frontend core. The user explicitly selected this structure over a shared Expo UI or two fully independent applications.

The old frontend continues to exist only inside the read-only `D:\paseo` reference checkout. There is nothing to freeze, coexist with, or delete in this repository: the new applications start blank and the legacy code never arrives.

---

## 1. History and current context

### 1.1 Where the repository came from

`D:\pi-companion` is a new repository built from scratch, using `D:\paseo` (Paseo `v0.3.0-beta.2`, AGPL-3.0-or-later) as a behavioral and code reference. An earlier attempt ran as a hard fork of Paseo; that experiment is abandoned. No fork history is preserved, no upstream or Paseo remote exists, and nothing is inherited through git. The repository begins with a fresh `git init`, a clean root `package.json`, and an initial commit authored here. Public package names use `@picompanion/*`, the Android package is `sh.picompanion`, and the deep-link scheme is `picompanion://`.

What is taken from the reference, and how it arrives:

| Taken as reference from `D:\paseo`                                                                    | How it arrives in this repository                                                                              |
| ----------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| daemon (`packages/server`), wire protocol, client SDK, relay, connection/auth, Pi provider, pi-bridge | copied, vendored, or re-implemented under `@picompanion/*` with AGPL-3.0-or-later compliance; never git-forked |
| behavioral contracts: wire compatibility, timeline sync, RPC naming, bridge semantics                 | restated as documentation, tests, and fixtures in this repository                                              |
| the legacy frontend (`packages/app`) and its Beautiful components                                     | not carried over at all; read-only reference for behavior notes and screenshots only                           |

`PASEO_*` environment variables and `$PASEO_HOME` are adopted deliberately. They are operational compatibility names, not product branding: preserving them keeps existing daemon data, relay keys, and wire contracts working. Do not rename them.

Use this identity boundary:

| Rename or use for new work                                                                             | Keep for compatibility                                                                                                                                                                         |
| ------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@picompanion/frontend-core`, `@picompanion/design-tokens`, `@picompanion/web`, `@picompanion/android` | `$PASEO_HOME`, every `PASEO_*` environment variable, daemon file names, relay keys, existing wire namespaces, and the published CLI's `bin` command name, `paseo` (decided at T238; see below) |
| Pi Companion display strings, `sh.picompanion`, and `picompanion://`                                   | Paseo-era identifiers inside ported daemon internals; change only in a separately verified metadata cleanup                                                                                    |

**Decision (T238): the published `@picompanion/cli` package keeps its `bin` command named
`paseo`, not `picompanion` or any `pi-*` name.** This was inherited from the port and had
never been decided in writing until now; it is decided here, deliberately, rather than left
implicit in `packages/cli/package.json`. The binary name belongs in the "keep for
compatibility" column above, for the same reason `$PASEO_HOME` and every `PASEO_*`
environment variable do: it is the command a user types to reach the exact daemon data that
already lives under `$PASEO_HOME`, on the same default port, using the same environment
variable name. Renaming only the command while keeping the environment variable and the data
directory named `paseo` would leave one system under two names — `picompanion` on the command,
`paseo` in the environment variable and the data directory — where it has one today. (This
said "three names instead of one" while `docs/clean-install-and-rollback.md` §A.2 said two for
the identical scenario, one commit apart; corrected at the P9-B merge gate. Two is right —
three is the number of PLACES the name appears, not the number of names.)

The migration cost is the reason this is not a close call. Renaming the `bin` entry does not
move or touch `$PASEO_HOME` itself — that directory is kept either way, and this decision
makes no change to it. But every machine that has already run `npm install -g
@picompanion/cli` — including the project owner's own laptop, which runs a production daemon
against a real `$PASEO_HOME` today — has a working `paseo` command on `PATH`, and any
runbook, shell alias, script, or muscle memory that already types `paseo` would silently stop
resolving the day a renamed package installs, with no error beyond "command not found." That
cost buys nothing functional: the daemon, its port, and its data directory are not changing
either way, so the rename would be pure churn for every existing install in exchange for a
name that matches an already-abandoned command surface.

This is reconciled, not skipped, against CLAUDE.md's reference-only-documents rule, which
says a reference-only document's descriptions of "Paseo" must not bleed into new product
docs, UI copy, or package metadata. That rule targets the failure mode of a new document
quietly inheriting Paseo's own product narrative as though it described this product —
copy-pasted branding, not a load-bearing identifier. It does not reach an operational
compatibility name that this same table already keeps on the record for the identical
reason: `$PASEO_HOME` and `PASEO_*` are also, literally, the string "Paseo" in something a
user reads, and they are kept anyway because the rule is about avoiding accidental brand
bleed, not about erasing every occurrence of the string. The CLI's `bin` name is the same
kept identifier worn on a command line instead of in an environment variable, not a stray
Paseo description that leaked in. What would change this answer: the `bin` name appearing in
product-facing marketing or app-store copy, or in UI copy a user reads inside the product
(neither is true today — a `bin` entry is read by npm and a shell, not rendered in the app);
or `$PASEO_HOME` itself ever being migrated to a new default, which would remove the
consistency argument above and reopen this decision in the same commit.

The root `package.json` is authored clean from the first commit: Pi Companion metadata only, plus exactly the workspaces this plan defines. No inherited Paseo metadata exists to clean up.

The v1 daemon remains on the laptop. The web and Android clients are unavailable when that laptop is asleep or offline. This is an accepted product constraint. An always-on host is not part of this plan.

### 1.2 What already exists in the reference

The `D:\paseo` reference codebase has working implementations for:

- a Pi-only daemon and provider;
- Pi session import, automatic discovery, and live transcript tailing;
- Pi RPC event mapping, steering and follow-up queues, retry events, hidden-message filtering, and final-message correction;
- the Pi UI Bridge, including protocol events, daemon state, Pi-side helper, action routing, chunking, and three published extension channels;
- Android-oriented features such as notifications, outbox behavior, sharing, voice, uploads, and a native editor;
- a shared Expo web/mobile frontend (legacy; never ported);
- a large batch of Beautiful-inspired components (legacy; never ported).

None of this code exists in this repository until Phase 0 ports the backend items. The two frontend items are never ported. Wherever this plan says a backend system “remains” or is “kept”, it means the ported copy must preserve the reference behavior and contracts, not that the code is already present here.

### 1.3 Why no existing frontend is carried over

The reference frontend is Paseo’s product architecture with Pi features inserted into it. It has roughly 1,900 tracked files under `D:\paseo\packages\app`, including about 1,600 source files. Its navigation, state, panels, visual system, provider assumptions, and responsive behavior are inherited rather than designed around Pi.

The recent Beautiful work is not a safe foundation:

- the folder contains 19 distinct component concepts despite commits claiming 20;
- several components are speculative and unused;
- 15 files contain `@ts-nocheck`;
- several files contain cross-file style references that can resolve to undefined at runtime;
- component variants were hidden rather than structurally removed;
- raw colors, duplicated animations, and platform-specific workarounds are spread across the files.

Useful visual ideas may be reinterpreted from screenshots or behavior notes, but none of the code in the reference `packages/app/src/ui/beautiful/` tree will be copied.

### 1.4 What remains authoritative

The following are the reliable contracts for the rebuild. Paths name the `D:\paseo` reference tree; after the Phase 0 port, the same layout exists in this repository:

- `packages/protocol` — wire schemas and shared types;
- `packages/client` — WebSocket, reconnect, request correlation, relay, and binary transport;
- `packages/server` — daemon and Pi integration;
- `packages/pi-bridge` — Pi extension helper;
- `docs/protocol-compatibility.md` — append-only wire rules;
- `docs/protocol-validation.md` — generated validation rules;
- `docs/rpc-namespacing.md` — RPC naming;
- `docs/timeline-sync.md` — live stream versus authoritative history;
- `docs/pi-ui-bridge.md` — historical bridge intent, subject to the contract corrections in this plan.

Paseo’s `docs/architecture.md`, `docs/product.md`, `docs/design.md`, `docs/expo-router.md`, and similar documents — whether read in `D:\paseo` or copied here as reference — describe the old product in places. Treat them as reference material, not the new frontend specification.

---

## 2. Product scope

### 2.1 Primary goal

Create a clean Pi Agent control surface that feels purpose-built on both web and Android. The session transcript is the center of the product. Pi tools, approvals, extension state, subagents, workflows, and long-running actions must be visible and actionable without falling back to raw JSON or terminal-only overlays.

### 2.2 First-release capabilities

The first complete release must support:

- direct and relay host connection, authentication, reconnect, and capability negotiation;
- Pi session discovery, import, create, resume, archive, and delete;
- live and historical timelines with correct epoch and sequence reconciliation;
- text, thinking, tool calls, tool updates, tool results, images, attachments, compaction, branch summaries, retries, and errors;
- prompt submission, steer, follow-up, queue state, abort, slash commands, model selection, and thinking level;
- permissions and extension dialogs;
- all ten Pi UI Bridge kinds and action round trips;
- prominent subagent and workflow state;
- file browsing, reading, editing, upload, download, code, and diff views;
- terminal access;
- offline-readable cache, drafts, and a safe outbox;
- Android push notifications, approval actions, sharing, voice entry, and haptics;
- responsive web layouts and compact Android layouts;
- a safe fallback for unknown tools and future extension elements.

### 2.3 Non-goals

The rebuild will not include:

- iOS;
- Electron or a desktop wrapper;
- a marketing website;
- non-Pi agent providers;
- an always-on daemon host;
- one-for-one recreation of every Paseo screen;
- blind migration of old UI code;
- a generic component showcase with variant pickers;
- copying third-party Beautiful source without confirmed license rights.

Paseo backend services such as schedules, loops, chat rooms, git services, speech, and browser tooling remain available. They receive new UI only when they support the Pi-first experience or a later product requirement.

---

## 3. Architecture decision

### 3.1 Selected structure

Use a shared, framework-neutral core with separate renderers.

```text
                       ┌─────────────────────────┐
                       │ packages/frontend-core  │
                       │ connection, timeline,   │
                       │ cache, drafts, bridge,  │
                       │ actions, view models    │
                       └───────────┬─────────────┘
                                   │
                    ┌──────────────┴──────────────┐
                    │                             │
          ┌─────────▼─────────┐         ┌────────▼─────────┐
          │ apps/web          │         │ apps/android     │
          │ React + Vite      │         │ Expo + RN        │
          │ DOM-first UI      │         │ native UI        │
          └─────────┬─────────┘         └────────┬─────────┘
                    │                             │
                    └──────────────┬──────────────┘
                                   │
                       ┌───────────▼─────────────┐
                       │ @picompanion/client     │
                       │ @picompanion/protocol   │
                       └───────────┬─────────────┘
                                   │ WebSocket
                       ┌───────────▼─────────────┐
                       │ laptop daemon           │
                       │ packages/server         │
                       └───────────┬─────────────┘
                                   │ JSONL stdio
                       ┌───────────▼─────────────┐
                       │ pi --mode rpc           │
                       │ extensions + bridge     │
                       └─────────────────────────┘
```

### 3.2 Why this was selected

A single Expo application would be quicker initially but would keep React Native Web constraints, Metro-specific behavior, a large browser bundle, and a WebView-based terminal. Fully separate applications would duplicate connection, timeline, offline, and extension logic.

The selected structure keeps risky behavior in one place while allowing each platform to use its strengths:

- web uses the DOM, direct xterm and CodeMirror integrations, normal keyboard and pointer behavior, and route-level code splitting;
- Android uses native navigation, native gestures, bottom sheets, notifications, camera, sharing, haptics, and secure storage;
- both use the same protocol parser, connection state machine, timeline reducer, extension state, action logic, and fixtures.

### 3.3 Separation rules

`packages/frontend-core` must not import React, React Native, Expo, browser globals, DOM types, or platform storage libraries. It receives platform services through interfaces.

`apps/web` and `apps/android` must not parse daemon messages independently. Every message enters through `frontend-core`.

No legacy `packages/app` code exists in this repository, and none may be introduced. Add a CI rule that fails if a `packages/app` path or import ever appears.

Platform renderers may look different, but they must consume the same view models and pass the same interaction fixtures.

---

## 4. Backend adoption plan

The backend is not inherited through git. Every area below is copied, vendored, or re-implemented from the `D:\paseo` reference into this repository under `@picompanion/*`, preserving behavior, wire contracts, and on-disk formats, with AGPL-3.0-or-later attribution recorded. In this section, “keep” means “port faithfully and do not redesign”.

### 4.1 Keep without redesign

| Package or area  | Why it stays                                                                         | Important paths                                                                                   |
| ---------------- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------- |
| Protocol         | Shared wire contract and generated validators                                        | `packages/protocol/src/messages.ts`, `agent-types.ts`, `client-capabilities.ts`, `binary-frames/` |
| Client SDK       | Connection, reconnect, liveness, request correlation, relay wrapping, binary routing | `packages/client/src/daemon-client.ts`, `daemon-client-transport.ts`, `terminal-stream-router.ts` |
| Daemon lifecycle | Agent state, persistence, timeline, workspaces, subscriptions                        | `packages/server/src/server/agent/agent-manager.ts`, `agent-storage.ts`, `session.ts`             |
| Pi provider      | Pi RPC process, history, tools, session persistence                                  | `packages/server/src/server/agent/providers/pi/`                                                  |
| Authentication   | Password, bearer handling, host checks, pairing identity                             | `packages/server/src/server/auth.ts`, `hostnames.ts`, `daemon-keypair.ts`                         |
| Relay            | Encrypted remote access                                                              | `packages/relay/`, `packages/server/src/server/relay-runtime.ts`                                  |
| Files            | Scoped reads/writes, upload, download, subscriptions                                 | `packages/server/src/server/file-explorer/`, `file-upload/`, `file-download/`                     |
| Terminal         | PTY ownership, stream coalescing, binary frames, backpressure                        | `packages/server/src/terminal/`, `packages/protocol/src/binary-frames/`                           |
| Push and speech  | Daemon notifications and local/cloud speech services                                 | `packages/server/src/server/push/`, `speech/`                                                     |
| CLI              | Operational fallback and daemon debugging                                            | `packages/cli/`                                                                                   |
| Pi bridge helper | Dual TUI/RPC extension API                                                           | `packages/pi-bridge/`                                                                             |
| Highlight        | Shared syntax tokenization                                                           | `packages/highlight/`                                                                             |

Keep `$PASEO_HOME` data unchanged: agents, projects, workspaces, schedules, loops, chats, configuration, daemon identity, relay keys, and push tokens are daemon-owned and need no migration.

### 4.2 Keep, but harden before relying on it

The backend is valuable, but the new frontend must not assume every recent bridge addition is production-ready.

#### Pi UI element payload loss — blocking

`packages/protocol/src/pi-ui-bridge/schema.ts` currently validates only the common element envelope. Zod removes unlisted fields by default. Fields such as `text`, `lines`, `rows`, `sections`, `value`, and `fields` can therefore be discarded when `PiUiDecoder` parses a `set` or `sync` operation. The reference frontend compensates with untyped casts, but it cannot recover data already stripped by the daemon.

Before either new renderer is built:

1. define typed payload schemas for all ten kinds;
2. add an optional canonical `payload` field to the wire envelope;
3. add `CLIENT_CAPS.piUiPayloadV2` and `server_info.features.piUiPayloadV2` rather than overloading the existing `piUiBridge` gate;
4. normalize current top-level v1 fields into `payload` inside the daemon decoder before protocol validation;
5. accept both old helper messages and canonical payload messages;
6. emit canonical payloads to capable clients and preserve the legacy top-level projection for old clients during the compatibility window;
7. add fixtures for old helper → old client, old helper → new client, new helper → old client, and new helper → new client;
8. regenerate ahead-of-time validators and add wire-compatibility tests;
9. tag transition code `// COMPAT(piUiPayloadV2): added 2026-08-31, remove after 2027-02-28`.

Shared wire fields remain optional. Do not use a Zod transform in the shared wire schema. Normalization belongs at the daemon boundary. Durable snapshots default to false until old-daemon parsing of the new optional payload has a fixture.

#### Bridge state correctness

`packages/server/src/server/agent/providers/pi/ui-bridge/state.ts` currently has provisional behavior: a missing patch becomes a markdown element, append handling is described as “naive,” channel payloads are attached with casts, and TTL/durable behavior requires verification.

Replace provisional behavior with explicit rules:

- reject a patch for a missing element and request a full resync;
- append only to payload types that support append;
- enforce TTL only in the daemon; helper TTL is advisory;
- make durable snapshots bounded, optional, and persisted as backward-readable timeline items;
- preserve `ns:id` identity everywhere;
- use composite element identity for action routing;
- test reconnect replay, sequence gaps, stale revisions, close, and agent shutdown.

Revision handling is deterministic: discard a delta at or below the current revision; apply only `current + 1`; request a full state when a delta jumps ahead; accept a full state only when its revision is at least current. Ephemeral Pi UI state never enters the local durable cache. Durable snapshots arrive only through the normal timeline.

#### Pi RPC command mirror drift disclosure

`packages/server/src/server/agent/providers/pi/rpc-types.ts` hand-mirrors Pi's own RPC
command surface against the installed Pi CLI's own type declarations. The bullets below are
decisions, not accidents, first recorded during the Phase 0 re-audit
(`docs/pi-extension-compatibility.md` §9, "Pi RPC Mirror Audit — Findings (T51A)") and
restated here as their citable home — the first three by T253, the fourth by T267.

(CORRECTED at the P9-K merge gate. This read "**Three points** in that mirror" and
attributed the whole set to T253. T267 appended a fourth bullet in the very commit that
wrote "then repointed **this fourth one** the same way" into `CLAUDE.md`, so the two files
that commit touched disagreed with each other about the count. The count is dropped rather
than incremented, per this repository's T217/T224 precedent for a figure that goes stale on
the next edit.)

- **`get_tree` stays removed.** It was pulled (T142) once the audit found its entire runtime
  path — `PiCliRuntime.getTree()`, `session-descriptor.ts`'s `tryGetTreeViaRpc` — had zero
  production callers; the session tree that actually shipped is built client-side from a flat
  summary list instead. If a real need for a daemon-truth tree ever emerges, re-add the arm
  exactly as Pi's real one (`{ id?: string; type: "get_tree" }`, no `targetId`) and give it a
  real caller in the same commit. Do not restore it speculatively a second time.
- **`PiRpcSlashCommand.sourceInfo` stays optional.** It is required on Pi's real
  `RpcSlashCommand` but optional on ours — a pre-existing drift found while auditing the type
  (T51A), neither introduced nor fixed by that task, and left as disclosed rather than
  tightened.
- **`get_entries`'s `since` field was a disclosed drift and is now closed.** Pi's real arm is
  `{ id?, type: "get_entries", since?: string }`; ours once omitted `since` (a drift T51A
  disclosed but deferred to avoid colliding with a concurrent task's file). T99 closed it in
  the same wave by mirroring the field exactly, proven field-for-field by
  `rpc-types.pi-mirror.contract.test.ts`. `since` is not yet read or sent by any caller, so
  closing the type drift did not by itself add incremental-fetch behavior.
- **`get_commands` was mirrored explicitly rather than deferred, because it was already
  shipped and relied on (T267).** `PiCliRuntime.getCommands()` already sends this command in
  production today via a configurable `commandsRpcName: string` field (default
  `"get_commands"`, `cli-runtime.ts`); before this arm existed, `get_commands` was reachable
  only through `PiRpcCommand`'s trailing `{ id?: string; type: string }` catch-all, because
  `commandsRpcName`'s type is a plain `string`, not the literal `"get_commands"`. Of the
  twelve request types the Phase 0 re-audit found previously unmirrored, this is the one T51A
  chose to add as its own explicit, field-checked arm — matching Pi's real
  `{ id?: string; type: "get_commands" }` exactly and proven against it field-for-field by
  `rpc-types.pi-mirror.contract.test.ts` — rather than leave a shipped, production-relied-on
  command (T28B4's slash-command completion already depends on it) with no drift detection
  of its own. The other eleven were left for two different reasons, not one: §9.2 excludes
  four deliberately on product grounds — `bash` and `abort_bash` because this daemon owns
  its own terminal, `export_html` because session export is declined, and
  `get_last_assistant_text` as a redundant read path rather than a missing capability — and
  defers the remaining seven only because no planned task depends on them yet. All eleven
  are in fact uncalled today, but that is the deferral's reason, not the exclusions': those
  four would stay excluded even if a caller appeared.

  (CORRECTED at the P9-K merge gate. This read "the way the other eleven, uncalled request
  types were left", giving one cause for eleven cases. Each was checked against §9.2's
  verdict table one at a time: 1 mirrored, 4 excluded, 7 deferred.)

#### Session watcher and live tail

Keep `pi-session-watcher.ts` and `pi-live-tail.ts`, but add tests around duplicate import races and long sessions. The live tail currently rereads and remaps the whole JSONL file on each change. Replace that with a byte offset or entry-id checkpoint before treating it as scalable for very long sessions.

#### Dependency cleanup

The server source is Pi-only, but `packages/server/package.json` still lists several dependencies used by deleted providers. Remove them only after `npm run knip`, server build, and targeted tests prove they are unused.

### 4.3 Keep the web-serving contract, change its artifact

The daemon’s web middleware is useful and remains. It already provides SPA fallback, compression negotiation, caching, and `window.__PASEO_INITIAL_DAEMON_CONNECTION__` injection.

Re-create the reference `scripts/build-daemon-web-ui.mjs` in this repository with `apps/web/dist` as its only source. Keep the output at `packages/server/dist/server/web-ui` so daemon packaging, Docker, and the established operator flags behave the same way as the reference.

Do not remove `PASEO_WEB_UI_ENABLED`, `PASEO_WEB_UI_DIST_DIR`, `--web-ui`, or `--no-web-ui` during this rebuild.

---

## 5. Legacy frontend policy

### 5.1 Exclusion boundary

The legacy frontend is not carried over at all. It exists only in the read-only `D:\paseo` reference checkout and never enters this repository, so there is nothing to freeze, coexist with, or delete here. The exclusion covers everything under the reference `packages/app` directory:

- all `src/` code;
- `src/ui/beautiful/` and `src/pi-ui/`;
- Expo Router routes and screens;
- old state stores, host runtime, timeline, composer, terminal UI, and file UI;
- assets and public web files unless a brand asset is separately re-approved;
- app unit tests, browser tests, Playwright setup, Maestro flows, and stubs;
- Metro, Babel, Expo, EAS, Vitest, Playwright, and TypeScript configuration;
- generated Android, iOS, Expo, and web artifacts.

Nothing under the reference `packages/app` becomes production source in the new tree. The new applications are created blank.

### 5.2 What may be consulted

The reference frontend in `D:\paseo` may be read for behavior that is not fully documented, such as:

- request names and capability gates;
- authoritative timeline catch-up behavior;
- connection probing and relay switching;
- attachment and outbox edge cases;
- terminal resize ownership;
- Android keyboard failures;
- old test scenarios.

Convert each discovered behavior into a new test or written requirement. Do not copy the implementation.

### 5.3 Migration-only exception

If a previously installed legacy client build holds data the user still needs, a small, isolated export utility may be added inside the legacy checkout — never in this repository. This is the only allowed change to legacy frontend code.

Client-only data that may need export includes:

- saved host and relay profiles;
- drafts and queued prompts;
- attachment blobs referenced by drafts;
- review drafts.

The replica cache does not need migration because the daemon is authoritative. Push tokens may be re-registered.

The export format must be versioned JSON and must not include daemon passwords or private relay keys unless encrypted. If there is no valuable legacy client data, skip this utility and re-pair the new applications.

The Phase 0 audit (recorded in `docs/frontend-data-migration.md` §2/§3) found no legacy client
data worth exporting and took that "skip and re-pair" branch: **reset, not migrate**. This
repository adds no import path or schema migration for legacy drafts, hosts, or attachments
(T42) — a fresh pairing starts with empty local state, and the daemon's own timeline remains
the source of truth for everything else.

### 5.4 Build wiring is created fresh

There is no fork build system to retarget: CI, Nix, Docker, workspace scripts, and release workflows do not exist until this plan creates them. Author each of these clean, consulting the reference only to understand required behavior:

- root workspace and frontend scripts in `package.json`;
- a new `scripts/build-daemon-web-ui.mjs` targeting `apps/web/dist`;
- `packages/server` prepack behavior for the bundled web UI;
- CI workflows and path filters written for the new workspace list only;
- an Android APK release workflow written for `apps/android`;
- Nix and Docker packaging, added only if those deployment paths are wanted, referencing the new web artifact from day one;
- Vitest, `tsconfig.json`, and `knip.json` configuration with package-local aliases and no legacy paths;
- `CLAUDE.md`, `README.md`, `docs/architecture.md`, and frontend documentation written for this repository.

Because nothing legacy is present, there is no coexistence window, no artifact switch, and no post-cutover lockfile cleanup.

---

## 6. Proposed repository structure

```text
D:\pi-companion\
├─ apps/
│  ├─ web/
│  │  ├─ src/
│  │  │  ├─ app/                 # providers, bootstrap, error boundaries
│  │  │  ├─ routes/              # TanStack Router routes
│  │  │  ├─ features/
│  │  │  │  ├─ connect/
│  │  │  │  ├─ sessions/
│  │  │  │  ├─ transcript/
│  │  │  │  ├─ composer/
│  │  │  │  ├─ approvals/
│  │  │  │  ├─ extensions/
│  │  │  │  ├─ tools/
│  │  │  │  ├─ files/
│  │  │  │  ├─ terminal/
│  │  │  │  └─ settings/
│  │  │  ├─ ui/                  # web primitives and recipes
│  │  │  ├─ platform/            # IndexedDB, browser WS, clipboard
│  │  │  └─ styles/              # generated CSS variables, global CSS
│  │  ├─ e2e/
│  │  ├─ public/
│  │  ├─ package.json
│  │  └─ vite.config.ts
│  └─ android/
│     ├─ app/                     # Expo Router routes only
│     ├─ src/
│     │  ├─ app/                  # providers, bootstrap, error boundaries
│     │  ├─ features/             # same feature names as web
│     │  ├─ ui/                   # native primitives and recipes
│     │  └─ platform/             # SecureStore, SQLite, notifications, sharing
│     ├─ assets/
│     ├─ e2e/
│     ├─ maestro/
│     ├─ app.config.ts
│     ├─ eas.json
│     └─ package.json
├─ packages/
│  ├─ frontend-core/
│  │  ├─ src/
│  │  │  ├─ connection/
│  │  │  ├─ hosts/
│  │  │  ├─ sessions/
│  │  │  ├─ timeline/
│  │  │  ├─ composer/
│  │  │  ├─ permissions/
│  │  │  ├─ extensions/
│  │  │  ├─ tools/
│  │  │  ├─ files/
│  │  │  ├─ offline/
│  │  │  ├─ navigation/
│  │  │  ├─ platform/             # interfaces, never implementations
│  │  │  └─ testing/              # shared fixtures and contract builders
│  │  └─ package.json
│  ├─ design-tokens/
│  │  ├─ src/tokens.ts
│  │  ├─ src/web.ts               # CSS variable generator
│  │  └─ src/native.ts            # typed native theme values
│  ├─ protocol/                    # ported from reference
│  ├─ client/                      # ported from reference
│  ├─ server/                      # ported from reference
│  ├─ relay/                       # ported from reference
│  ├─ highlight/                   # ported from reference
│  ├─ cli/                         # ported from reference
│  ├─ pi-bridge/                   # ported from reference
│  └─ expo-two-way-audio/          # ported native audio infrastructure
└─ plan.md
```

Feature names should align across web and Android so ownership and parity are obvious. Files inside each feature are platform-specific; behavior comes from `frontend-core`.

Phase 1 must wire this tree into the monorepo, not merely create folders:

- add the four new workspaces to root `package.json` alongside the ported backend packages;
- give each workspace its own `package.json`, `tsconfig.json`, build, typecheck, and test scripts;
- add `knip.json` entries; any `@/` alias is package-local and never crosses workspaces;
- define Vitest aliases per package; add no root-level alias shims;
- build `@picompanion/design-tokens` before frontend-core and both applications;
- make web and Android depend on package exports, never source-relative cross-workspace paths;
- add an Android-only Metro configuration and a check that rejects `.web.*` files and web-only imports in `apps/android`.

---

## 7. Shared frontend core

### 7.1 Responsibilities

`@picompanion/frontend-core` owns:

- host profiles and connection state;
- `DaemonClient` construction and lifecycle;
- hello capabilities and server feature gates;
- connection probing, reconnect, and relay selection;
- normalized daemon entities;
- timeline ingestion, live reconciliation, pagination, and gaps;
- prompt submission, steer, follow-up, abort, and queue state;
- drafts, outbox, and optimistic submissions;
- permissions and extension dialogs;
- Pi UI state and action dispatch;
- tool-call view models;
- file and terminal session controllers;
- platform-neutral navigation intents;
- offline cache serialization;
- telemetry events that contain no prompt or source content.

### 7.2 State model

Keep daemon truth separate from local UI state.

- **Server replica:** agents, workspaces, sessions, active turn, timeline cursors, permissions, Pi UI state.
- **Pending mutations:** prompt submissions, permission answers, Pi UI actions, file writes.
- **Local durable state:** host profiles, drafts, outbox, last opened session, user preferences.
- **Renderer-only state:** selected panel, hover, measured sizes, open sheets, scroll anchors.

Use Zustand’s vanilla store for synchronous domain state. Use TanStack Query Core only for request-oriented caches. Do not put all state into one global store and do not make React Context the transport layer.

### 7.3 Platform interfaces

Define narrow interfaces for:

- key-value and structured storage;
- secure secret storage;
- network reachability;
- clock and timers;
- notifications;
- file picking and sharing;
- clipboard;
- audio input;
- lifecycle and foreground state;
- logging.

Web adapters use IndexedDB, Web Crypto, browser lifecycle APIs, and the native browser WebSocket. Android adapters use Expo SQLite for ordinary state, SecureStore for secrets, Expo lifecycle APIs, and native notification/share modules.

### 7.4 Timeline invariants

The live stream is for speed. `fetch_agent_timeline_request` remains authoritative.

The core reducer must:

- reset on epoch change;
- deduplicate by epoch and sequence;
- detect gaps and page until complete;
- reconcile optimistic user rows with accepted daemon rows;
- apply `replaceMessageId` corrections in place;
- keep tool execution updates attached to their tool call;
- preserve daemon timestamps;
- restore a stale cached tail without marking it authoritative;
- recover after app restart during an active turn;
- fence every asynchronous response with a monotonic run generation, so a slow reply from an
  abandoned run can never resurrect stale state (T46A1);
- reconcile on resume when a socket stays open but goes silent, not only when it closes (T46A2).

These rules need fixture-driven tests before transcript UI work starts.

**Liveness.** A closed socket and a dead app are both handled above. The third case is a socket
that stays open and goes **silent** because the tab was backgrounded or the phone slept. Push
alone does not cover it: the host must feed foreground and connectivity changes into the resume
controller, which then reconciles through the existing gap-detection path rather than adding a
second recovery route. On Android, where backgrounding is constant, this is not optional.

**Streaming is delta-based.** The server coalesces on a 60 ms window by concatenation and the
client reducer never concatenates, so each flush is its own `(epoch, seqStart)` row and dropping
one permanently loses text. Rate control therefore batches the **render** onto a frame clock
(§14.5, T45A1–T45A3) and must never drop or replace a row.

---

## 8. Web application architecture

### 8.1 Stack

Use:

- React 19 and TypeScript;
- Vite for development and static production output;
- TanStack Router for typed routes;
- TanStack React Query bindings for request caches;
- Radix primitives where they reduce accessibility risk;
- Tailwind CSS backed by generated design tokens;
- direct DOM xterm and CodeMirror integrations;
- Playwright for end-to-end testing.

Do not use Next.js or server-side rendering. The product is an authenticated control surface bundled into the daemon, not an indexed public site. A static SPA keeps daemon packaging simple.

### 8.2 Routes

Initial route set:

```text
/connect
/h/:serverId
/h/:serverId/sessions
/h/:serverId/session/:agentId
/h/:serverId/session/:agentId/files/*
/h/:serverId/session/:agentId/terminal/:terminalId
/h/:serverId/settings
```

The daemon-served build reads `window.__PASEO_INITIAL_DAEMON_CONNECTION__`. Standalone development reads an explicit environment setting or a manually saved host. Deep links must survive static SPA fallback.

### 8.3 Wide layout

Use a three-region workspace on wide screens:

- left: sessions, host state, search, and session creation;
- center: transcript and composer;
- right: live Pi extension rail.

A running subagent fleet, workflow, loop, or goal remains visible in the right rail. It does not disappear into a collapsed status chip. Empty extension state may collapse the rail.

Tool details, files, and terminal may use a resizable right pane or full route depending on available width. Avoid nested modal stacks.

### 8.4 Web-specific strengths

Use DOM features directly:

- xterm in the page rather than a WebView;
- CodeMirror for editable text and search;
- keyboard shortcuts with visible command hints;
- drag and drop for attachments;
- proper hover and context menus;
- virtualized transcript and logs (the transcript is windowed by a real virtualizer; the extension `log` element is not — it is tail-capped to 200 mounted lines, per §11.3 and §14.5. T226 decided that, and this bullet's "logs" is the general sense, not the `log` element's mechanism);
- route-level lazy loading for terminal, editor, diff, and voice code.

---

## 9. Android application architecture

### 9.1 Stack

Use:

- Expo 54 and React Native 0.81 as the proven initial baseline;
- Expo Router for Android deep links and route ownership;
- React Native Screens and Safe Area Context;
- Reanimated and Gesture Handler;
- Gorhom Bottom Sheet and Portal;
- SecureStore for credentials and relay secrets;
- Expo SQLite for ordinary local state;
- Expo Notifications, Sharing, Document Picker, Image Picker, Haptics, and Audio only where the feature requires them;
- Maestro and Agent Device for end-to-end tests.

Do not target web from `apps/android`. There are no `.web.tsx` files in the Android application.

### 9.2 Compact layout

The Android session screen is one primary transcript with:

- host/session header;
- compact status strip;
- pinned live extension area above the composer;
- virtualized transcript;
- bottom composer with prominent microphone and attachment actions.

Focused extension panels open as bottom sheets or full screens. Subagent fleet state remains pinned while active. Files and terminal are dedicated routes rather than squeezed beside chat.

### 9.3 Native interaction rules

- Primary touch targets are at least 48 dp.
- No action depends on hover.
- The composer must retain keyboard ownership when an extension sheet opens; use Portal rather than a detached Modal where required.
- Approval, finished, error, and blocked states have haptic patterns.
- Permission notifications provide Approve and Deny actions when safe.
- Share intents can create a draft or send to a chosen session.
- The app must remain useful after process death because agents continue in the daemon.

### 9.4 Voice entry: Groq transcription and draft insertion (T277)

The microphone action (§9.2/§9.3) captures a complete audio clip on-device
(T276) and turns it into text the user reviews before sending — never a
direct send. This section records that decision plus where the
transcription itself happens, so a future change to either has something
authoritative to cite instead of a reference-only document or a stale code
comment.

**A finished transcript is a draft, not a send.** `apps/android/src/
features/voice/voice-model.ts`'s `createVoiceCaptureController` resolves a
completed recording to `{ outcome: "drafted", text, looksSecretShaped }`;
the host (`Composer.tsx`) applies `text` to the composer's existing draft
via `applyTranscriptToDraft` (append, with a separating space when needed)
rather than enqueuing and sending it. An empty or whitespace-only result
(including one the server's hallucination guard below has already cleared
to empty) resolves `"empty-transcript"` instead and never touches the
existing draft. This supersedes an earlier version of the same module that
enqueued a transcript into the composer's outbox and sent it immediately —
that design is retired, not merely extended.

**Groq is a configuration of the existing `OpenAISTT` provider, not a new
provider implementation.** `packages/server/src/server/speech/providers/
openai/stt.ts`'s `OpenAISTT` already wraps the `openai` npm SDK against a
configurable `baseUrl`; Groq's `/audio/transcriptions` endpoint
(`https://api.groq.com/openai/v1/audio/transcriptions`) is
OpenAI-compatible (multipart file + model + language in, `{ text }` json
out), so pointing that same class at Groq's endpoint with a Groq API key
and a Groq model id (`whisper-large-v3-turbo` by default) transcribes
through Groq with no new engine code. `providers/openai/config.ts`
resolves a dedicated `GROQ_API_KEY` env var / `persisted.providers.groq.
apiKey` into that same `stt` slot — Groq's base URL and default model are
fixed in code, never user-configurable, and an explicit OpenAI STT
credential always takes priority when one is also configured (fully
backward compatible with every deployment that predates this section).
`whisper-large-v3-turbo` cannot translate to English; this product exposes
no translate-to-English affordance today, so the "force the non-turbo
model or hide the affordance" rule that would otherwise apply has nothing
to bind to yet — record that decision here if a translate affordance is
ever added, rather than leaving the interaction undecided.

**Transcription is a one-shot round trip, not the existing streaming
pipelines.** `packages/protocol/src/messages.ts`'s `voice_audio_chunk`/
`transcription_result` pair (the full-duplex "voice mode" agent
conversation) and `dictation_stream_*` pair (the desktop dictation
feature) are both PCM16-only two layers down their own call chains
(`STTManager`'s `preparePcmForModel`, `DictationStreamManager`'s
resampler) — neither can carry the AAC/m4a clip
`expo-audio-voice-capture-port.ts` actually produces without an
out-of-scope resample step. `transcribe_voice_clip.request`/`.response`
(T277) is a plain, minimal request/response pair instead, mirroring
`file.upload.request`/`.response`'s shape: the complete clip's bytes and
format go in, `{ text, error }` comes back once. Server-side, it resolves
through the SAME dictation STT provider slot the existing dictation
feature uses (conceptually the same thing: speech becomes editable text a
human reviews, not a live conversational turn), calling
`SpeechToTextProvider.transcribeClip` — an optional one-shot method
`OpenAISTT` implements and the local sherpa-onnx provider does not (its
design is incremental PCM streaming with no "hand me one complete file"
entry point; a caller against that provider gets an honest "does not
support" error, never a synthesized transcript).

**Size ceiling and the hallucination guard are enforced before/at the
transcription call, not discovered as a failure afterward.**
`packages/client/src/daemon-client.ts`'s `transcribeVoiceClip` rejects a
clip over 25 MB before sending a byte (matching `uploadFile`'s own
pre-flight check); `OpenAISTT.transcribeClip` enforces the identical
ceiling server-side as defense in depth (`MAX_TRANSCRIPTION_CLIP_BYTES`),
since Groq's free tier and OpenAI's own Whisper endpoint both cap a
request at 25 MB. A known Whisper failure mode — confident invented text
over a silent or non-speech clip — is guarded using Groq/OpenAI's
`verbose_json` per-segment `no_speech_prob`: `transcribeClip` requests
`verbose_json`, computes a duration-weighted average `no_speech_prob`
across segments, and clears `text` to `""` when it crosses `0.6` (the
commonly-used Whisper-tooling threshold for "probably no speech here").
That empty text flows through the client's ordinary `"empty-transcript"`
path — a hallucination-guarded silent clip and a genuinely silent clip are
indistinguishable to the user, which is the point.

**Cleanup is deterministic, not clever, and does not use an LLM.**
`voice-model.ts`'s `cleanTranscript` collapses doubled/irregular
whitespace, trims, and drops exactly one leading filler token ("um",
"uh", etc.) — nothing else. It does not do phonetic/fuzzy custom-word
repair (this product has no per-user vocabulary list to repair against
yet) and does not route text through an LLM (the added network round trip
is not worth it for fixes this simple).

**Disclosed gap, left for a future task to close by name.** T277 does not
wire a live `DaemonClient` into `Composer.tsx`'s `transcribeClient` prop —
that prop's default is `undefined` today, the same as `uploadClient`'s.
The call that would close it: `client.transcribeVoiceClip.bind(client)`,
using the same `AppCore.connection`-derived `DaemonClient` the route layer
already threads through for `queueModeClient`/`turnStatusClient`. Until
that wiring lands, a captured `{ kind: "audio" }` clip resolves the honest
`"transcription-unavailable"` outcome rather than a fake transcript or a
silent no-op.

---

## 10. Design system and Beautiful UI

### 10.1 Principle

**Beautiful UI** (https://www.beautifului.dev/, by Turbo) is the product's visual language. It is MIT licensed, Copyright (c) 2026 Shane Levine, which is compatible with this project's AGPL-3.0-or-later, so its code may be adapted directly **provided the MIT notice is retained**. The full extracted specification — tokens, shapes, shadows, type, motion, and signature traits — lives in `docs/beautiful-ui-reference.md`.

The product still owns its component APIs, its accessibility contract, and its platform implementations. Adopting the look does not mean adopting someone else's architecture.

**The standing consistency rule:** Beautiful UI defines the appearance of the _entire_ product, not just of the components it ships. Anything we build that has no counterpart there — the session rail, the Pi extension rail, the context-window meter, settings, terminal chrome — must still read as though it came from the same library.

Before adapting external code, record its source URL, version, license, and required attribution in `THIRD_PARTY_NOTICES.md`, and put an attribution header in any file containing adapted code. No file carrying adapted Beautiful UI code may land without its row.

> Historical note: before 2026-09-01 this section pointed at `D:\paseo\packages\app\src\ui\beautiful\`, the abandoned fork's derivative copy, and forbade copying. That was a misidentification of the source; the component _selection_ in §10.4 was nevertheless taken from the real library and remains correct.

### 10.2 Shared tokens

`@picompanion/design-tokens` owns the Beautiful UI token structure (see `docs/beautiful-ui-reference.md` for values):

- semantic color roles — the surface stack `page → canvas → surface → inset → field` and the text ramp `ink → ink-2 → ink-3`, not a numeric neutral ramp;
- typography scale;
- spacing and radii;
- elevation and border rules;
- status tones;
- code and diff colors;
- motion duration and easing;
- compact and wide breakpoints.

`npm run build:design-tokens` produces the package exports before either application builds. Web consumes generated CSS variables. Android consumes typed theme objects. Component code must not contain product colors as raw hex values.

Shadows are **1px rings, not blurs** (`0 0 0 1px var(--line)` is the workhorse). Radii are chip 6 / control 8 / card 10 / window 14. Type runs small (10.5–13px dominant) in Inter, with Geist Mono and tabular figures for all numerals. The signature easing is `cubic-bezier(.23,1,.32,1)`.

Support dark and light themes from the start. Test reduced motion and high contrast. Do not build multiple visual variants for the same component. Select one product-approved treatment.

### 10.3 Primitive layer

Build small platform-specific primitives with matching semantics:

- Button, IconButton, Link;
- TextField, TextArea, Select, Toggle;
- Card, Section, Divider;
- Chip and ChipGroup;
- StatusIndicator;
- Progress;
- SearchField;
- Table or responsive record list;
- CodeBlock;
- EmptyState, ErrorState, LoadingState;
- Sheet, Dialog, Popover;
- Toast and Banner.

### 10.4 Product recipes

Beautiful-derived recipes should include only components with a real Pi use case:

- SidebarNav (Beautiful UI component 14 — backs the left session rail);
- ThinkingSection;
- StreamingMessage;
- ApprovalForm;
- ToolChips;
- TaskRows;
- PromptBar;
- DiffSummary;
- CommandSearch;
- WorkflowSteps;
- CodeListing;
- SelectionActions.

Do not rebuild CRM tables, recommendation cards, insight dashboards, or context stacks until a real feature needs them.

### 10.5 Accessibility and motion

Every interactive component requires:

- a visible label or accessible name;
- keyboard operation on web;
- screen-reader role and state;
- visible focus treatment;
- non-color status text;
- reduced-motion behavior;
- stable test identifiers for critical flows.

Web runs axe checks. Android receives a manual TalkBack pass for every release candidate. Animations use shared motion tokens but platform-native implementations: CSS or Web Animations on web, Reanimated on Android.

---

## 11. Pi Agent and extension UI architecture

### 11.1 Core Pi behavior

The frontend must represent the full Pi RPC lifecycle rather than only chat text:

- agent and turn start/end/settled;
- assistant text and thinking deltas;
- tool start/update/end;
- bash streaming;
- steer and follow-up queues;
- compaction and summarization retry;
- auto-retry;
- extension errors;
- final `message_end` replacement;
- model and thinking changes;
- session tree, fork, clone, resume, and naming;
- commands and slash-command completion.

The daemon already maps most of this into shared session events. Add frontend views only after confirming the exact protocol payload and feature gate.

The provider contract should be checked against Pi's 32 RPC commands, grouped here so no capability disappears during the rebuild:

- conversation: `prompt`, `steer`, `follow_up`, `abort`;
- session lifecycle: `new_session`, `switch_session`, `fork`, `clone`, `get_fork_messages`, `set_session_name`;
- state and history: `get_state`, `get_messages`, `get_entries`, `get_tree`, `get_last_assistant_text`, `get_session_stats`;
- model and reasoning: `set_model`, `cycle_model`, `get_available_models`, `set_thinking_level`, `cycle_thinking_level`, `get_available_thinking_levels`;
- queues and automation: `set_steering_mode`, `set_follow_up_mode`, `set_auto_compaction`, `set_auto_retry`, `abort_retry`;
- maintenance and export: `compact`, `export_html`, `get_commands`;
- shell: `bash`, `abort_bash`.

The event fixture set must cover all 21 Pi RPC event types: `agent_start`, `agent_end`, `agent_settled`, `turn_start`, `turn_end`, `message_start`, `message_update`, `message_end`, `bash_execution_update`, `tool_execution_start`, `tool_execution_update`, `tool_execution_end`, `queue_update`, `compaction_start`, `compaction_end`, `auto_retry_start`, `auto_retry_end`, `summarization_retry_scheduled`, `summarization_retry_attempt_start`, `summarization_retry_finished`, and `extension_error`.

The frontend does not speak Pi RPC directly. These lists are provider-parity requirements for the daemon-to-client projection.

### 11.2 Three extension UI tiers

The frontend must support all three classes of Pi extension UI:

1. **Dialogs:** select, confirm, input, and editor requests. These block the extension and require a response or timeout.
2. **Fire-and-forget:** notify, status, widget, title, and editor text. These map to notices, status elements, pinned widgets, session title, and composer replacement.
3. **Terminal-only UI:** custom overlays, footers, headers, component widgets, and working indicators. These require structured Pi UI Bridge elements.

Do not expose raw marker messages or silently ignore unknown methods. Unknown input becomes a visible diagnostic with source and safe raw details.

### 11.3 Frozen bridge vocabulary

The ten v1 kinds remain:

| Kind       | Shared meaning                    | Web presentation               | Android presentation          |
| ---------- | --------------------------------- | ------------------------------ | ----------------------------- |
| `status`   | Glanceable state                  | header or right-rail status    | compact status strip          |
| `widget`   | Persistent summary                | right-rail card                | pinned card above composer    |
| `panel`    | Composed focused view             | rail, popover, or inline panel | sheet, inline card, or screen |
| `progress` | Determinate or indeterminate work | status/rail progress           | compact or pinned progress    |
| `roster`   | Agents, roles, keys, tasks        | persistent list with actions   | pinned list or full sheet     |
| `log`      | Streaming lines                   | tail-capped log                | tail-following list           |
| `markdown` | Rich textual content              | web markdown renderer          | native markdown renderer      |
| `diff`     | Unified changes                   | full diff view                 | compact diff then full screen |
| `form`     | Structured questions              | dialog or rail form            | sheet or full screen          |
| `composer` | Replace or prefill draft          | composer update with undo      | composer update with undo     |

A `panel` composes other kinds. Do not add a new wire kind for every extension.

`log`'s presentation on both platforms is a cap on how many of the payload's lines are
ever mounted (§14.5's 200-line budget), not a scrolling render-window virtualization —
there is nothing to window over once the mount itself is capped (T226).

### 11.4 Renderer registry

Each platform has an explicit registry:

```text
kind -> validate canonical payload -> build platform component -> dispatch action
```

The registry must provide:

- one renderer for every known kind;
- an error boundary per element;
- an unknown-kind fallback;
- revision and stale-state display in development;
- pending, success, and failure state for actions;
- confirmation for dangerous actions;
- namespace-aware logging;
- payload size limits.

Extension elements are first-class state, not ad hoc transcript HTML.

### 11.5 Placement and lifetime

- `status` appears in the session header/status strip.
- `pinned` remains visible near the composer or in the web rail.
- `inline` becomes a transcript-adjacent card.
- `sheet` opens a focused panel.
- `screen` owns a route.

Ephemeral elements live in daemon `PiUiState` and replay on reconnect. Durable snapshots become timeline items. The frontend must not persist ephemeral state as if it were history.

### 11.6 Tool renderer registry

Pi built-in and custom tools need a second registry, separate from the extension registry.

Provide purpose-built views for:

- read/list/find/grep/search;
- bash and terminal commands;
- write/edit and multi-edit;
- file and image results;
- diffs and patches;
- web/browser actions;
- todo, subagent, workflow, and goal tools;
- permission-required and blocked states.

Every arbitrary custom tool still renders through a safe generic card with:

- tool name and source;
- execution state and duration;
- collapsible validated input;
- streaming updates;
- result or error;
- copy and report actions.

Never fail the transcript because a plugin returns a new tool detail shape.

### 11.7 Customized extension coverage

The 2026-08-30 audit covered 25 actual extensions/providers plus shared library/test infrastructure.

**Headless or ordinary-chat behavior; no custom renderer required:**

- `herdr-agent-state`;
- `pi-herdr-delegate`;
- `pi-herdr-peer`;
- `opencode-live-catalog`;
- `plain-english`;
- `capabilities`;
- `vendor/pi-cursor-provider`;
- `web-access`;
- `mcp`;
- `handoff`;
- `vision-proxy`.

**Backend behavior that needs transcript protection:**

- `project-memory` — `display:false` content must remain hidden;
- `clarity` — final assistant replacement must correct the live row in place.

**First-class UI through bridge elements:**

| Extension          | Required UI                                                                        |
| ------------------ | ---------------------------------------------------------------------------------- |
| `loop`             | panel containing status, markdown, roster, progress, and log; stop/details actions |
| `btw`              | secondary conversation screen with markdown and composer                           |
| `subagents`        | prominent roster with running, blocked, done, usage, and cancel/open actions       |
| `todo`             | pinned task widget with collapse and item state                                    |
| `advisor`          | widget/panel with status, markdown, tool activity, and logs                        |
| `switchboard`      | key-health roster, cooldown state, and management form                             |
| `workflows`        | approval form, progress, roster, and logs                                          |
| `minimal-status`   | native status information, not a copied terminal footer                            |
| `plan-mode`        | mode status with toggle action                                                     |
| `pi-goal`          | goal status, rounds, budget, blocked/waiting state                                 |
| `prompt-arbitrage` | status plus composer replacement with undo                                         |
| `ask-user`         | rich form with search, descriptions, multi-select, and optional comment            |

Published channels remain `subagents:fleet`, `workflow:progress`, and `pi-goal:status`. Unknown channels produce one diagnostic and are not rendered as transcript text.

During Phase 0, re-audit the actual installed ecosystem at `C:\Users\aksha\.pi\agent\extensions` and any project-local `.pi\extensions` directories. Record the result in `docs/pi-extension-compatibility.md`, including helper API calls, exact payload fixtures, required bridge kinds, actions, and whether each extension is headless. The table above is the baseline, not a substitute for checking the current files.

---

## 12. API and data flow

### 12.1 Connection startup

```text
platform host storage
  -> frontend-core HostController
  -> @picompanion/client DaemonClient
  -> WebSocket hello with client type, version, and capabilities
  -> daemon server_info with serverId, version, and feature flags
  -> core enables supported features once
  -> directory and active-session snapshots
  -> selective timeline and Pi UI subscriptions
  -> renderers subscribe to stable core selectors
```

The web app may bootstrap from the daemon-injected connection hint. Android loads a paired host from secure local storage.

Pairing uses the existing `ConnectionOffer` contract in `packages/protocol/src/connection-offer.ts`. Direct WebSocket authentication continues through the `paseo.bearer.<token>` subprotocol. Relay profiles retain the daemon public key and use the existing encrypted relay transport; private material never enters a URL query. Host and Origin checks remain enforced by the daemon. Add tests for QR import, wrong password, wrong daemon key, relay reconnect, DNS-rebinding rejection, and SPA deep-link fallback.

### 12.2 Live turn

```text
Pi RPC event
  -> Pi provider mapping
  -> daemon AgentManager timeline/state
  -> agent_stream event
  -> DaemonClient
  -> frontend-core event parser
  -> timeline/turn/tool/extension reducers
  -> web or Android selectors
  -> platform renderer
```

The renderer never mutates the server replica directly. User actions create explicit pending mutations and wait for daemon acknowledgment.

### 12.3 Pi UI action

```text
user action
  -> platform confirmation if required
  -> frontend-core ExtensionActionController
  -> pi.ui.action.request
  -> daemon action router
  -> /pi_ui_event <base64url payload>
  -> owning Pi extension namespace
  -> extension state update
  -> pi_ui_delta or action result
  -> pending action resolves
```

Action identity is `(agentId, namespace, elementId, actionId, requestId)`. Bare element ids are insufficient.

**Single-answer semantics.** Web and Android can be live on the same session at once, so an
approval or dialog must be answerable exactly once across all connected clients. A second answer
resolves as **superseded** — not as an error, and never silently — carrying the outcome and, where
the daemon supplies it, which client answered. The losing client closes with a readable
explanation rather than having the dialog vanish. A guard that lives only in one client is not a
guard, because a second client defeats it (T47A1, T47A2).

**Agent-global settings have no change event.** Pi applies steering and follow-up mode to the live
session and persists them, but emits nothing when they change, so a second connected client would
hold a stale value indefinitely. Wherever the daemon exposes a setting of this shape it must
re-read authoritative state after a change and broadcast it (T38B0), rather than leaving each
client to discover the drift by polling.

**The Pi RPC mirror is not the boundary of what Pi can do.**
`packages/server/src/server/agent/providers/pi/rpc-types.ts` is a hand-maintained mirror and it has
drifted: Pi accepts 35 request types and the mirror carries 16. A capability missing from the
mirror must never be read as a capability Pi lacks — check Pi itself before concluding something is
impossible. T51 audits the gap and adds a test so it cannot silently return.

### 12.4 Files and terminal

File lists, reads, writes, uploads, and downloads use existing daemon RPC and binary frames. The frontend must not directly access laptop paths.

Terminal output stays on the existing binary channel and respects daemon backpressure. Web renders direct xterm. Android rebuilds an xterm WebView wrapper from the established binary protocol and behavior tests; the old frontend implementation is reference material only.

### 12.5 Offline behavior

The daemon remains authoritative. Local cache is display-only.

- Web stores ordinary data in IndexedDB.
- Android stores ordinary data in Expo SQLite.
- Web keeps daemon passwords in session memory by default. A persisted relay profile may store only Web Crypto-wrapped key material in IndexedDB after explicit consent.
- Android stores passwords and relay secrets in SecureStore.
- Cached timelines are marked stale until authoritative catch-up completes.
- Drafts survive restart.
- Outbox entries include a stable client submission id.
- Automatic resend is enabled only after daemon idempotency is verified; otherwise the user confirms uncertain sends.
- When the laptop is offline, show last-seen time and explain that agents and push notifications are also unavailable.

---

## 13. Development phases

Each phase has an exit condition. Do not begin screen-heavy work before the contract and core phases are green.

### Phase 0 — Bootstrap, reference audit, and fix contracts

1. Initialize the repository: fresh `git init`, clean root `package.json` and tooling configuration, and an initial commit. Add no remote pointing at Paseo.
2. Audit and port the `D:\paseo` backend: copy `protocol`, `client`, `server` (including the Pi provider), `relay`, `highlight`, `cli`, `pi-bridge`, and `expo-two-way-audio` under `@picompanion/*`; record provenance and AGPL-3.0-or-later attribution; bring their builds and targeted tests green in this repository. Import no frontend code.
3. Capture real Pi RPC and daemon WebSocket fixtures for chat, tools, permissions, retries, compaction, session import, and all bridge kinds.
4. Correct the Pi UI payload schema and state rules described in section 4.2.
5. Add tests for hidden messages and final-message correction.
6. Add long-session and duplicate-import tests for the watcher/live tail. A 100,000-entry synthetic session must read work proportional to appended bytes; warm append processing should stay below 250 ms p95 and 50 MiB additional peak memory on the reference laptop.
7. Record legacy client data that needs export and write the keep/reset decision into `docs/frontend-data-migration.md`.
8. Create `THIRD_PARTY_NOTICES.md` and complete the Beautiful source/license checklist.
9. Verify ownership of (or newly create) the EAS project, package ids, signing credentials, and release secrets before any new native build.
10. Re-audit installed extensions and create `docs/pi-extension-compatibility.md`.

**Exit:** the ported backend builds and its targeted tests pass in this repository; protocol and bridge fixtures round-trip without payload loss; compatibility tags and gates are present; the incremental live-tail benchmark passes; extension and license inventories exist; no frontend code was imported.

### Phase 1 — Create the new workspace skeleton

1. Add `apps/web`, `apps/android`, `packages/frontend-core`, and `packages/design-tokens` with workspace, package, TypeScript, Knip, Vitest, Metro, and build configuration.
2. Add root scripts for development, build, typecheck, lint, and targeted tests.
3. Create CI from scratch: path filters and jobs for `frontend-core`, `design-tokens`, `web`, `android`, and the ported backend; core or protocol changes must also run shared contract tests.
4. Add a guard that fails CI if a `packages/app` path or legacy frontend import ever appears, and reject `.web.*` files in `apps/android`.
5. Create `scripts/build-daemon-web-ui.mjs` targeting `apps/web/dist`; until the web app produces a real build, the daemon simply runs without a bundled UI.
6. Write a new Android APK release workflow for `apps/android`, using the reference workflow only as behavioral documentation.
7. Establish design tokens and blank authenticated shells.
8. Connect each shell to a fake core adapter before using the daemon.
9. Write `CLAUDE.md` and `README.md` with a prominent link to this plan; mark any copied Paseo docs as reference material.

**Exit:** both applications show a native “connected/disconnected” shell from shared state; no production import references legacy frontend code; `npm install --workspaces`, package typechecks, Knip, and CI routing recognize all workspaces; the daemon packages cleanly with or without a bundled web artifact.

### Phase 2 — Build frontend-core

1. Implement platform interfaces and host registry.
2. Wrap `DaemonClient` lifecycle and feature gates.
3. Implement entity stores, timeline reducer, pagination, and optimistic submissions.
4. Implement permissions, Pi UI state, action controller, drafts, and outbox.
5. Add shared navigation intents and fixtures.

**Exit:** node tests can drive a complete recorded session from hello through reconnect, gap recovery, extension action, and final correction without React.

### Phase 3 — Design system and component laboratory

1. Implement primitives on web and Android from shared tokens.
2. Add a development-only component laboratory to both applications using the same fixtures.
3. Build the approved Beautiful-inspired recipes.
4. Add keyboard, screen-reader, dark/light, reduced-motion, and compact/wide tests.
5. Record third-party provenance.

**Exit:** each primitive and recipe has matching semantics, visual evidence, and accessibility coverage on both platforms. There are no variant pickers.

### Phase 4 — Web vertical slice

1. Build connect/pair, session list, transcript, composer, and approvals.
2. Add thinking, streaming text, tools, code, images, and diffs.
3. Add the extension right rail and all ten bridge renderers.
4. Add direct xterm and CodeMirror routes.
5. Add responsive compact mode.

**Exit:** the web app can run a real Pi session, answer permissions, control a subagent fleet, survive reconnect, and render unknown tools safely.

### Phase 5 — Android vertical slice

1. Build onboarding/pairing, session list, transcript, composer, and approvals.
2. Add pinned extension state and bottom-sheet/full-screen renderers.
3. Add attachments, share target, notifications, voice entry, and haptics.
4. Add files and terminal routes.
5. Add offline cache and process-death recovery.

**Exit:** the Android app can complete the same core scenario over Wi-Fi and relay, including notification approval and reconnect after process death.

### Phase 6 — Advanced Pi parity

1. Session tree, fork, clone, resume, naming, model, and thinking level.
2. Steering and follow-up queue controls.
3. Compaction, retry, and extension-error surfaces.
4. Full extension matrix, including `/btw`, switchboard, workflows, and rich ask-user.
5. Prominent fleet/loop/goal behavior on wide and compact layouts.

**Exit:** every UI-bearing customized extension has a fixture, renderer, action path, and real-session test.

### Phase 7 — Operational features

1. File write conflict handling, upload/download progress, and native editing limits.
2. Terminal latency and resize ownership.
3. Push registration and trusted-device management.
4. Execute the draft/outbox migration or explicit reset already decided and documented in Phase 0.
5. Diagnostics screen with versions, capabilities, connection path, and exportable redacted logs.

**Exit:** the applications can diagnose host, protocol, and extension failures without exposing secrets.

### Phase 8 — Cutover to the new stack

1. Make `apps/web/dist` the daemon’s bundled web UI in every packaging path.
2. Finish Docker/Nix packaging and docs where those deployment paths are wanted; CI and workspace routing were already added in Phase 1.
3. Export legacy client data from previously installed clients if Phase 0 decided it is required, then import it.
4. Retire the legacy Paseo/fork installs; the new daemon and applications become the daily drivers against the same `$PASEO_HOME`.
5. Re-verify provenance records and `THIRD_PARTY_NOTICES.md`; confirm no unrecorded reference code drifted in.
6. Run `knip`, typecheck, format, lint, targeted tests, web E2E, and Android smoke.

**Exit:** `rg "packages/app"` finds only reference notes; daemon packaging contains the new web app; Android release uses `apps/android`; the legacy install is no longer needed for daily use.

### Phase 9 — Release hardening

1. Complete performance, accessibility, security, and version-drift checks.
2. Run the full CI matrix rather than the full suite locally.
3. Produce a signed internal APK.
4. Test a clean laptop daemon install and a clean Android install.
5. Document rollback and support procedures.

**Exit:** release candidate is usable as the daily Pi control surface on web and Android.

---

## 14. Testing strategy

### 14.1 Test layers

| Layer              | Scope                                               | Tooling                                   |
| ------------------ | --------------------------------------------------- | ----------------------------------------- |
| Protocol           | old/new schemas, generated validators, capabilities | ported protocol Vitest tests              |
| Core unit          | reducers, controllers, cache, outbox, bridge, tools | Vitest in Node                            |
| Contract fixtures  | recorded Pi RPC and daemon WS sequences             | shared fixture runner                     |
| Web components     | real DOM behavior and accessibility                 | Vitest Browser + Playwright provider      |
| Android components | native interaction contracts                        | React Native Testing Library where useful |
| Web E2E            | isolated daemon and browser                         | Playwright                                |
| Android E2E        | emulator/device and real daemon                     | Maestro + Agent Device                    |
| Backend targeted   | provider, watcher, bridge, auth, files              | ported server Vitest files                |

Do not use JSDOM as proof of browser behavior. Use real browser tests.

### 14.2 Required contract fixtures

At minimum, capture:

- hello and server capability negotiation;
- new session, imported terminal session, resume, and archive;
- streaming text and thinking;
- single and multi-edit tool calls;
- partial tool output and failure;
- permission and timed extension dialog;
- steer and follow-up queue;
- compaction and retries;
- hidden custom message;
- corrected `message_end`;
- every Pi UI kind;
- action success, rejection, timeout, and stale revision;
- reconnect with timeline gap and Pi UI full replay;
- unknown tool and unknown bridge kind.

Fixtures must contain synthetic paths and secrets.

### 14.3 Web end-to-end scenarios

- connect to an isolated daemon;
- create and run a Pi session;
- send during a turn as steer and follow-up;
- approve and deny a tool;
- open tool details and diff;
- interact with a bridge form and roster action;
- disconnect and catch up;
- restore a deep link;
- use keyboard-only navigation;
- open terminal and file editor;
- verify no request reaches the production daemon on port `6767`.

### 14.4 Android end-to-end scenarios

- pair direct and relay hosts;
- cold start into the last session;
- compose with keyboard, voice, attachment, and share intent;
- respond to an approval from a notification;
- interact with roster, form, and panel sheets;
- background and kill the app during a turn, then restore;
- switch network path;
- read offline cache and flush a safe outbox item;
- open files and terminal;
- verify 48 dp touch targets and TalkBack labels on critical controls.

### 14.5 Performance budgets

Set budgets in CI once the first vertical slice exists:

- web session route `/h/:serverId/session/:agentId`: under 500 KiB gzip for initial JavaScript and CSS, excluding lazy terminal/editor/diff chunks;
- local live-event-to-paint p95: under 100 ms on web and 200 ms on a Pixel 8 API 35 reference emulator;
- transcript: 10,000 timeline items without rendering more than a bounded window;
- extension log: cap the mounted line count to 200 on both platforms — a payload/mount
  bound, not a scrolling render-window virtualization (that is the transcript bullet
  above's concern, for a different and much larger list); real extensions already tail
  their own log payloads at 200 in practice (the `loop` extension), so this is a bound
  already met on the wire, not a target to grow toward (T226: web previously capped at
  500, decided down to match Android's 200);
- no bridge update rate above 20 messages per second per agent;
- the mechanism for the paint budget is a frame clock supplied through a platform interface:
  core batches pending rows into one application per tick, and the live streaming item is
  rendered separately from the memoized committed transcript so per-token cost stays independent
  of history length (T45A1–T45A3);
- terminal keeps the existing 4 MiB soft and 8 MiB hard backpressure invariants;
- reconnect restores cached content immediately and starts authoritative catch-up within one second of socket readiness.

Measure before changing a budget. Do not silence a regression by raising the limit without written rationale.

### 14.6 Local quality commands

These scripts are targets to add during Phase 1:

```bash
npm run build:client
npm run typecheck --workspace=@picompanion/frontend-core
npm run typecheck --workspace=@picompanion/web
npm run typecheck --workspace=@picompanion/android
npm run lint -- apps/web/src packages/frontend-core/src
npm run format:files -- apps/web/src packages/frontend-core/src
npx vitest run <specific-test-file> --bail=1
npm run test:e2e --workspace=@picompanion/web -- --grep <scenario>
```

Follow the repository rule: do not run the full test suite locally. Use CI for the complete matrix.

---

## 15. Development and deployment

### 15.1 Local development

Keep production daemon port `6767` untouched unless the user explicitly approves a restart.

Use the existing development daemon on `127.0.0.1:6768` with `PASEO_HOME=D:\pi-companion\.dev\paseo-home`.

Target root commands:

```bash
npm run dev:server
npm run dev:web
npm run dev:android
```

Suggested web dev port is `5173`. Android emulator reaches the laptop daemon through `10.0.2.2:6768` or `adb reverse`.

### 15.2 Bundled web UI

Production build:

```text
apps/web -> Vite static export -> apps/web/dist
         -> scripts/build-daemon-web-ui.mjs
         -> packages/server/dist/server/web-ui
```

Keep Brotli/Gzip precompression, hashed-asset immutable caching, SPA fallback, connection-hint injection, host allowlist, and API authentication boundaries.

`PASEO_WEB_UI_ENABLED=true` continues to enable the bundled UI. The default laptop deployment can serve it at `http://localhost:6767`.

### 15.3 Android build and distribution

Preserve the product identity:

- production package: `sh.picompanion`;
- development package: `sh.picompanion.debug`;
- scheme: `picompanion://`;
- an EAS project and signing credentials that are newly created or claimed only after verifying ownership.

Create the release pipeline for `apps/android`, using the reference release workflow as behavioral documentation:

```bash
npm run android:development --workspace=@picompanion/android
npm run android:production --workspace=@picompanion/android
eas build --platform android --profile production-apk
```

A release tag builds a signed APK and attaches it to the GitHub release. Keep F-Droid support only if its notification and native-module trade-offs are still desired.

### 15.4 CI gates

Required jobs from Phase 1 onward:

- format and lint;
- protocol/client build and tests;
- frontend-core unit and contract tests;
- web typecheck, browser components, and sharded Playwright;
- Android typecheck and production prebuild smoke;
- targeted server tests on Linux and Windows;
- daemon package dry-run with bundled new web UI;
- signed APK workflow on release tags;
- Docker and Nix checks when their paths change.

CI path filters must distinguish `frontend-core`, `web`, `android`, `backend`, and `protocol` changes without skipping shared-contract tests.

---

## 16. Security and privacy

The daemon grants full machine control to an authenticated client. Preserve its password, host allowlist, DNS-rebinding protection, relay encryption, and file path scoping.

Frontend rules:

- never log passwords, relay private keys, prompt content, source, or file content by default;
- keep browser daemon passwords in session memory; persist relay key material only after consent and only Web Crypto-wrapped in IndexedDB;
- store Android passwords and relay secrets in SecureStore;
- sanitize markdown, links, HTML previews, and tool-supplied labels;
- do not render extension-provided HTML;
- require confirmation for dangerous bridge actions;
- cap element payloads, logs, attachment sizes, and rendered JSON depth;
- isolate renderer failures with error boundaries;
- redact diagnostics exports;
- keep static web assets public but keep `/api`, WebSocket, MCP, and file routes authenticated according to existing server rules.

The repository is licensed AGPL-3.0-or-later from its first commit, as required for code ported from the AGPL-licensed reference. External component licenses must be compatible and documented.

---

## 17. Main risks and mitigations

| Priority | Risk                                                                         | Mitigation                                                                                                |
| -------- | ---------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| P0       | The backend port misses files, config, or hidden coupling from the reference | Port with a provenance checklist; Phase 0 exit requires green builds and targeted tests                   |
| P0       | Bridge payload data is stripped by current schema                            | Fix and fixture-test canonical payloads in Phase 0                                                        |
| P0       | A customized extension has no new renderer                                   | Maintain the extension matrix and require a fixture plus real-session test for every UI-bearing extension |
| P1       | Web and Android semantics drift                                              | Shared core, shared fixtures, matching feature names, parity CI                                           |
| P1       | Timeline duplication or gaps                                                 | Central reducer and recorded reconnect/gap tests                                                          |
| P1       | Old drafts, hosts, or outbox data are lost                                   | Decide migration need before cutover; export only valuable client state                                   |
| P1       | Browser or Android secrets are stored insecurely                             | Platform secret adapters and explicit persistence policy                                                  |
| P1       | Long Pi sessions make live tail expensive                                    | Replace whole-file reread with incremental checkpointing                                                  |
| P1       | Android keyboard breaks sheets and composer                                  | Portal-based sheets, focused IME tests, dedicated Maestro flows                                           |
| P2       | Beautiful source has unclear license                                         | Treat as inspiration only until provenance is recorded                                                    |
| P2       | Separate renderers duplicate visual work                                     | Share tokens, view models, fixtures, and semantics; allow platform-specific components                    |
| P2       | Web bundle grows with terminal/editor/audio                                  | Route-level lazy loading and explicit bundle budgets                                                      |
| P2       | Old Paseo docs mislead new sessions                                          | Mark this file authoritative and write repository docs fresh for this repository                          |
| P2       | Reference drift: `D:\paseo` backend fixes land after the port                | Manually review reference server, client, protocol, relay, and auth changes monthly and port what matters |

### Rollback

There is no demolition step. Backend data formats are unchanged, so the retired legacy install remains runnable against the same `$PASEO_HOME`. If cutover fails:

1. resume using the last known-good legacy daemon and clients;
2. keep the new daemon off the production port until it is fixed;
3. leave `$PASEO_HOME` untouched;
4. re-publish the last known-good server package or APK if one already shipped;
5. import any exported client data only after the new schema is corrected.

Because the ported backend preserves data formats and no daemon-data migration is planned, rollback is a choice of which binaries run rather than a database recovery. During the compatibility window, canonical bridge payloads and `pi_ui_snapshot` fields remain optional; durable snapshots default off until an old-daemon read fixture passes.

---

## 18. Technical decisions recorded

1. **No existing frontend is carried over.** The new applications start blank; nothing from the reference `packages/app` becomes production source.
2. **The backend is ported from the `D:\paseo` reference, not git-forked.** Preserve behavior and contracts; rewrite only where an audit finds a concrete contract or correctness issue.
3. **Web and Android use separate renderers with one shared core.** This was explicitly selected by the user.
4. **Web is DOM-first React with Vite.** It is a static authenticated SPA, not an SSR site.
5. **Android is Expo/React Native and Android-only.** It does not carry a web target.
6. **Pi extension rendering is a primary architecture layer.** It is not a special case inside transcript components.
7. **The ten Pi UI Bridge kinds remain the semantic vocabulary.** Panels compose kinds rather than expanding the protocol.
8. **Tool rendering and extension rendering use separate registries.** Both have safe unknown fallbacks.
9. **Beautiful Components supply curated design patterns, not copied architecture.** One approved style per component; no variant gallery in production.
10. **The laptop daemon remains the sole v1 host.** Offline clients show stale data and outbox state; they cannot run agents or receive daemon push while the laptop is down.
11. **`PASEO_*`, `$PASEO_HOME`, protocol compatibility, and daemon identity remain stable.**
12. **The repository is greenfield.** Fresh `git init`, clean root `package.json`, no upstream remote, no fork history; the legacy stack lives only outside this repository and is retired at cutover, not migrated.
13. **T262: the legacy-provider visibility gate in `session.ts` is retired, not patched.**
    `isProviderVisibleToClient` used to hide any provider outside
    `LEGACY_PROVIDER_IDS = new Set(["claude", "codex", "opencode"])` from a client whose
    declared `appVersion` fell below `MIN_VERSION_ALL_PROVIDERS` (`"0.1.45"`). Its original
    reason, quoted from the TODO it carried since T04's port of Paseo's daemon: "Remove once
    all app store clients are on >=0.1.45 and understand arbitrary provider strings. Clients
    before 0.1.45 validate providers with `z.enum(["claude", "codex", "opencode"])` and reject
    the entire session message if they encounter an unknown provider." That protected real,
    already-deployed Paseo app-store clients whose bundled wire schema hardcoded that enum.
    Pi Companion has no such installed base: `AgentProviderSchema`
    (`packages/protocol/src/provider-manifest.ts`) has always been an open `z.string()`, never
    an enum, and `AGENT_PROVIDER_DEFINITIONS` has always had exactly one entry, `id: "pi"`. With
    non-Pi providers a stated non-goal (§2.3), the set this gate filtered is pi-only IN
    PRODUCTION — `config.ts`'s default config object passes `agentClients: {}`, so nothing is ever overlaid onto the
    manifest-derived registry on a real daemon. **CORRECTED at the P9-I merge gate:** this said
    the set "can never again contain anything this product's own client would reject",
    unconditionally. That is false for any daemon with a non-empty `agentClients` — every test
    daemon — because `getAgentManagerProviderState`
    (`getAgentManagerProviderState` in
    `packages/server/src/server/agent/provider-snapshot-manager.ts`) overlays every
    `extraClients` entry with no `if (!definition) continue;` guard, unlike `buildRegistry`
    (`buildRegistry`) which has one. Measured against T262's own new e2e daemon,
    `list_available_providers_request` returns four provider ids, not one. The conclusion holds;
    the unconditional reasoning did not. The overlay itself is filed as T264.
    So the gate, left in place, did the opposite of its job: it hid the one real provider from
    the Android client, because `ANDROID_DAEMON_APP_VERSION`
    (`apps/android/src/app-shell/core.ts`, `"0.1.0"`) sits below `"0.1.45"` by construction and
    has no roadmap reason to ever cross it. The safety argument is stronger than "no installed
    base": the method returned `true` for any client at or above `"0.1.45"` and now returns
    `true` unconditionally, so retiring it is provably a no-op for every such client — and this
    product ships TWO clients, `apps/web`'s `DAEMON_APP_VERSION` being `"0.3.0-beta.2"`, already
    above the threshold. T262 levels Android up to what web always had; it cannot regress web.
    Two cheaper fixes were considered and rejected: adding `"pi"` to `LEGACY_PROVIDER_IDS` would
    make the set's own name false (`"pi"` is not legacy, it is the only provider) while leaving
    the whole now-pointless apparatus in place to be misapplied again; bumping
    `ANDROID_DAEMON_APP_VERSION` past `"0.1.45"` would pass this one gate, but that constant is
    an unexamined literal with no documented protocol meaning of its own (`core.ts`'s doc comment
    on `ANDROID_DAEMON_APP_VERSION`
    records it "was a bare `"0.1.0"` literal repeated at both construction sites", where web's
    `DAEMON_APP_VERSION` calls itself a fixed protocol-compatibility declaration) — a version
    number should describe what a client actually does, not be moved until an unrelated check
    passes. **CORRECTED at the same gate:** the rejection used to rest on the bump "risks
    silently crossing (or coming close to)" `MIN_VERSION_EXPLICIT_WORKSPACE_RECOVERY`
    (`"0.1.105"`). Executed against the real `isAppVersionAtLeast`, at `"0.1.46"`
    `clientUsesLegacyWorkspaceRestore` returns `true`, identical to `"0.1.0"` — not crossed, not
    near. It is vacuous at any value besides: neither shipped app issues the one RPC that reads
    it. `isProviderVisibleToClient` itself is kept (now an unconditional `true`) rather than
    deleted, because `ProviderCatalogSession`, `createAgentUpdatesService`, and
    `WorkspaceDirectory` each depended, AT T262, on a `host.isProviderVisibleToClient`
    callback of that shape; removing the parameter from those three modules was unscoped
    follow-up, not part of that decision. (**CORRECTED at the P9-J merge gate:** this read
    "each still depend on", present tense, which T266 made false for `WorkspaceDirectory`
    in the very commit the addendum below describes. The addendum was appended without
    marking the clause above it as superseded, so a grep of the governing document still
    returned the false claim as a standing statement.) **RESOLVED by T266, per caller, not in bulk:** `ProviderCatalogSession` and
    `createAgentUpdatesService` keep the callback — the first is the only remaining filter on
    provider-CATALOG content (available-providers and the snapshot, on both push and
    request paths — **CORRECTED at the P9-J merge gate:** this said
    "models/modes/available-providers/snapshot", and models and modes are not filtered,
    nor are they call sites; they read through `getProviderSnapshotEntryForRead`, which
    applies no visibility filter. The keep decision stands on the three that are), the
    second is the
    only gate on the LIVE agent-update push path, and an ablation test proved each is
    non-redundant with anything else in `session.ts`. `WorkspaceDirectory`'s copy was deleted:
    `session.ts` is its only production caller and already pre-filters the agent list this
    class receives through the SAME shared method (inside its own `listAgentPayloads()`), so
    the class's own second application of that method was provably, structurally redundant —
    an ablation test found byte-identical output with and without it, in both the gate-true and
    gate-false cases.

---

## 19. Definition of done

The frontend rebuild is complete when:

- no legacy `packages/app` code exists anywhere in the repository;
- web and Android connect to the same unchanged laptop daemon through `@picompanion/client`;
- frontend-core contains no React, DOM, React Native, or Expo imports;
- a recorded session produces equivalent domain state on both platforms;
- all Pi RPC lifecycle states are visible;
- all ten bridge kinds render and their actions round-trip;
- every UI-bearing custom extension in section 11.7 has parity evidence;
- unknown tools and unknown extension elements fail safely;
- web has responsive wide and compact layouts;
- Android passes notification, process-death, keyboard, and offline scenarios;
- the daemon bundles `apps/web/dist` successfully;
- the Android release pipeline builds a signed `sh.picompanion` APK;
- protocol, core, web, Android, and targeted backend CI gates pass;
- accessibility and performance budgets are met;
- current architecture and release docs no longer describe Paseo’s old frontend as the product.

---

## 20. First actions for the next Pi session

The next session should start in `D:\pi-companion` and do only Phase 0 work.

1. Read this entire file.
2. Initialize the greenfield repository if not already done: fresh `git init`, clean root `package.json`, an initial commit, and no Paseo remote.
3. Create task tracking for Phase 0 and start the reference audit of the `D:\paseo` backend packages to import.
4. Port the backend packages, then add contract tests that expose Pi UI payload stripping before changing schemas.
5. Design the canonical optional `payload` field and legacy normalization, respecting `docs/protocol-compatibility.md` and `docs/protocol-validation.md`.
6. Run only the relevant protocol, Pi provider, bridge, watcher, and live-tail tests.
7. Decide whether legacy host/draft/outbox data needs an export from previously installed clients.
8. Do not scaffold screens and do not copy any frontend code until Phase 0 exits cleanly.
