# T03 Provenance — Port client SDK, CLI, pi-bridge, and audio module

Source: `D:\paseo` (also reachable as `/d/paseo`) — Paseo `v0.3.0-beta.2`, AGPL-3.0-or-later.
Reference checkout is READ-ONLY. No files from `packages/app` were copied.

This document records exactly what T03 copied for AGPL attribution (to be consolidated in T05 / THIRD_PARTY_NOTICES.md per plan §10.1).

## Packages copied

### 1. `packages/client` — `@picompanion/client` (23 tracked files)

Copied via `git archive HEAD -- packages/client`:

- `packages/client/README.md`
- `packages/client/examples/README.md`
- `packages/client/examples/agents-and-providers.ts`
- `packages/client/examples/events-and-timeline.ts`
- `packages/client/examples/provider-settings.ts`
- `packages/client/examples/workspaces.ts`
- `packages/client/package.json`
- `packages/client/src/compat/normalize-provider-models.ts`
- `packages/client/src/daemon-client-relay-e2ee-transport.ts`
- `packages/client/src/daemon-client-runtime-metrics.ts`
- `packages/client/src/daemon-client-transport-types.ts`
- `packages/client/src/daemon-client-transport-utils.ts`
- `packages/client/src/daemon-client-transport.test.ts`
- `packages/client/src/daemon-client-transport.ts`
- `packages/client/src/daemon-client-websocket-transport.ts`
- `packages/client/src/daemon-client.test.ts`
- `packages/client/src/daemon-client.ts`
- `packages/client/src/index.test.ts`
- `packages/client/src/index.ts`
- `packages/client/src/terminal-stream-router.test.ts`
- `packages/client/src/terminal-stream-router.ts`
- `packages/client/tsconfig.examples.json`
- `packages/client/tsconfig.json`

### 2. `packages/cli` — `@picompanion/cli` (195 tracked files)

Copied via `git archive HEAD -- packages/cli` (195 files, full list via `git -C D:/paseo ls-files -- packages/cli`):

- `packages/cli/bin/paseo`
- `packages/cli/cli-client-id`
- `packages/cli/package.json`
- `packages/cli/src/classify.test.ts`
- `packages/cli/src/classify.ts`
- `packages/cli/src/cli-surface.test.ts`
- `packages/cli/src/cli.ts`
- `packages/cli/src/commands/agent/archive.ts`
- `packages/cli/src/commands/agent/attach.ts`
- `packages/cli/src/commands/agent/delete.test.ts`
- `packages/cli/src/commands/agent/delete.ts`
- (all 195 files — see `git -C D:/paseo ls-files -- packages/cli` for complete list)

### 3. `packages/pi-bridge` — `@picompanion/bridge` (5 tracked files)

Copied via `git archive HEAD -- packages/pi-bridge`:

- `packages/pi-bridge/README.md`
- `packages/pi-bridge/package.json`
- `packages/pi-bridge/pi-companion-bridge.mjs`
- `packages/pi-bridge/src/index.ts`
- `packages/pi-bridge/tsconfig.json`

### 4. `packages/expo-two-way-audio` — `@picompanion/expo-two-way-audio` (59 tracked files)

Copied via `git archive HEAD -- packages/expo-two-way-audio`:

- `packages/expo-two-way-audio/.eslintrc.js`
- `packages/expo-two-way-audio/.github/workflows/cd.yml`
- `packages/expo-two-way-audio/.github/workflows/ci.yml`
- `packages/expo-two-way-audio/.gitignore`
- `packages/expo-two-way-audio/.npmignore`
- `packages/expo-two-way-audio/.nvmrc`
- `packages/expo-two-way-audio/CODE_OF_CONDUCT.md`
- `packages/expo-two-way-audio/CONTRIBUTING.md`
- `packages/expo-two-way-audio/LICENSE`
- `packages/expo-two-way-audio/README.md`
- `packages/expo-two-way-audio/android/build.gradle`
- `packages/expo-two-way-audio/android/src/main/AndroidManifest.xml`
- `packages/expo-two-way-audio/android/src/main/java/expo/modules/twowayaudio/AudioEngine.kt`
- `packages/expo-two-way-audio/android/src/main/java/expo/modules/twowayaudio/ExpoTwoWayAudioLifeCycleListener.kt`
- `packages/expo-two-way-audio/android/src/main/java/expo/modules/twowayaudio/ExpoTwoWayAudioModule.kt`
- `packages/expo-two-way-audio/android/src/main/java/expo/modules/twowayaudio/ExpoTwoWayAudioPackage.kt`
- `packages/expo-two-way-audio/examples/basic-usage/App.tsx`
- `packages/expo-two-way-audio/examples/basic-usage/README.md`
- `packages/expo-two-way-audio/examples/basic-usage/app.json`
- `packages/expo-two-way-audio/examples/basic-usage/babel.config.js`
- `packages/expo-two-way-audio/examples/basic-usage/metro.config.js`
- `packages/expo-two-way-audio/examples/basic-usage/package.json`
- `packages/expo-two-way-audio/examples/basic-usage/tsconfig.json`
- `packages/expo-two-way-audio/examples/flow-api/App.tsx`
- `packages/expo-two-way-audio/examples/flow-api/auth.ts`
- `packages/expo-two-way-audio/examples/flow-api/volume-display.tsx`
- `packages/expo-two-way-audio/expo-module.config.json`
- `packages/expo-two-way-audio/ios/AudioEngine.swift`
- `packages/expo-two-way-audio/ios/ExpoTwoWayAudio.podspec`
- `packages/expo-two-way-audio/ios/ExpoTwoWayAudioModule.swift`
- `packages/expo-two-way-audio/ios/MicrophonePermissionRequester.swift`
- `packages/expo-two-way-audio/package.json`
- `packages/expo-two-way-audio/src/ExpoTwoWayAudioModule.ts`
- `packages/expo-two-way-audio/src/core.ts`
- `packages/expo-two-way-audio/src/events.ts`
- `packages/expo-two-way-audio/src/hooks.ts`
- `packages/expo-two-way-audio/src/index.ts`
- `packages/expo-two-way-audio/tsconfig.json`
- (plus .gitignore, LICENSE, android/ios sources, example assets — complete via `git -C D:/paseo ls-files -- packages/expo-two-way-audio`)

### 5. Shared script

- `scripts/clean-package-dist.mjs` — already present from T02 (copied from `D:\paseo\scripts\clean-package-dist.mjs`), reused by all packages.

## Exclusions

- `D:\paseo\packages\app` — never copied, never referenced (hard rule).

## Local modifications

- `packages/expo-two-way-audio/tsconfig.json`: added `../../node_modules/expo-module-scripts/ts-declarations` to `typeRoots` for npm workspace hoisting.
- `packages/cli/src/commands/daemon/local-daemon.supervision.test.ts`: fixed Windows path expectation to use `path.join`.
- `packages/server/` — minimal isolation stub for `@picompanion/server` (not from paseo) to allow CLI to build/test without T04; will be replaced by T04's full server port. Fixed in the T03-fix pass (`phase0/t03-fix`): added `packages/server/tsconfig.json` (outDir `dist/server`, matching the reference layout the stub's `exports` field already pointed at) and changed `build` from `echo stub build` to a real `tsc` invocation, so `@picompanion/server`'s `dist/` is actually emitted and downstream packages resolve it.
- `packages/client/package.json` and `packages/cli/package.json` `build` scripts: extended to build their own workspace dependencies first (`protocol` → `relay` → `client` → `server`), the same pattern `client`'s build script already used for `protocol`. Without this, `npm run build --workspace=@picompanion/cli` from a clean checkout (no pre-built `dist/` anywhere) failed even after the server stub was fixed, because `@picompanion/relay/e2ee` and `@picompanion/client` were never built either.
- `packages/client/src/daemon-connection.smoke.test.ts` (added in the T03-fix pass): a real-socket smoke check — starts a `ws` `WebSocketServer` on an ephemeral localhost port as a protocol-accurate daemon stand-in, drives `DaemonClient`'s real WebSocket transport over an actual TCP connection through the `hello` → `server_info` handshake, and asserts `connectionState.status === "connected"`. Added `ws`/`@types/ws` as client devDependencies for this test only (client's runtime code has no new dependency).

## Verification

Re-run from a clean `dist/`-less checkout (`rm -rf packages/{protocol,relay,client,server,cli}/dist`) after `npm install` (1332+ packages):

- `npm run build --workspace=@picompanion/protocol` → OK
- `npm run build --workspace=@picompanion/relay` → OK
- `npm run build --workspace=@picompanion/client` → OK
- `npm run build --workspace=@picompanion/server` → OK (stub build now actually emits `dist/`)
- `npm run build --workspace=@picompanion/cli` → OK, standalone (chains protocol/client/server builds first)
- `npm run build --workspace=@picompanion/bridge` (pi-bridge) → OK
- `npm run build --workspace=@picompanion/expo-two-way-audio` → OK
- `npx vitest run packages/client/src` → OK, 126 tests (125 ported + 1 new smoke check)
- `npx vitest run packages/cli/src` (the package's own `test:unit` target) → OK, 173 tests — matches the count claimed above
- `npx vitest run packages/pi-bridge packages/expo-two-way-audio` → "No test files found" — confirmed **not** a T03 gap: `D:\paseo\packages\pi-bridge` and `D:\paseo\packages\expo-two-way-audio` contain zero `*.test.*`/`*.spec.*`/`__tests__` files in the reference (verified via `find ... -iname "*test*" -o -iname "*spec*"`), so there is nothing upstream to port for either package.
- `npx vitest run packages/protocol packages/relay packages/highlight` (T02 packages, regression check) → OK, 595 passed / 4 skipped
- No `packages/app` or `D:\paseo` references

**Known, intentionally out of scope for T03/T03-fix:** `packages/cli/tests/**` (the package's `test:local` target, run via `tsx tests/run-all.ts`, not vitest) spawns a real daemon process via `paseo daemon start` and drives real `paseo` CLI subprocesses against it. That requires `@picompanion/server`'s actual daemon implementation (T04) — the T03 stub only provides typed no-op/stub exports so the CLI compiles, it does not start a listening daemon. Running `npx vitest run packages/cli` (no path scoping) sweeps these `tests/**` files in too, even though they are written for the `tsx`/`zx`-based `test:local` runner, not vitest — several report "No test suite found" for that reason alone, independent of the daemon dependency. This mirrors the reference repo's own test split (`packages/cli/package.json` `test`: `test:unit && test:local`, and the reference root `test` script is `npm run test --workspaces --if-present`, i.e. it also never runs a bare `vitest run` swept over the whole tree). The T03 acceptance criterion "all four packages build; ported tests pass" is satisfied by `test:unit`/the packages' proper vitest suites (verified above); `test:local` is tracked as a T04 dependency, not a T03 regression.

## License

All copied source remains AGPL-3.0-or-later, copyright Mohamed Boudra / Paseo project. Attribution to be consolidated in `THIRD_PARTY_NOTICES.md` by T05. `packages/expo-two-way-audio` retains its MIT license but is aggregated under AGPL-3.0-or-later when distributed with the companion.
