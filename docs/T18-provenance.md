# T18 Provenance — Daemon web-UI bundling script and prepack

Source: `D:\paseo` (also reachable as `/d/paseo`) — Paseo `v0.3.0-beta.2`,
commit `ede26c8e2e210b9e12cca0e6d6cf3e10a07208f8`, AGPL-3.0-or-later.
The reference checkout is READ-ONLY and was never modified.
**Nothing from `D:\paseo\packages\app` was copied or referenced.**

This document records exactly what T18 adapted and changed, for AGPL
attribution (consolidated in `THIRD_PARTY_NOTICES.md` per plan §10.1, T05
convention).

## 1. Script adapted

### `scripts/build-daemon-web-ui.mjs`

Adapted from the reference `scripts/build-daemon-web-ui.mjs` (single file).
The compression, copy, and bundle-measurement logic (Brotli/Gzip
precompression at `BROTLI_MAX_QUALITY`, `.br`/`.gz` sibling files, recursive
directory walk, raw/gzip/brotli size reporting) is copied essentially
verbatim, function-for-function.

Adaptations made for this repository's layout and phasing:

- Source directory changed from the reference's `packages/app/dist` (legacy
  Expo web export) to this repository's `apps/web/dist` (the new DOM-first
  Vite web app built in T15).
- Build invocation changed from
  `npm run build:web --workspace=@picompanion/app` to
  `npm run build --workspace=@picompanion/web`.
- Target directory is unchanged: `packages/server/dist/server/web-ui`.
- Behavioral divergence (intentional, required by plan.md §13 Phase 1 item 5
  and the Phase 1 exit criterion "the daemon packages cleanly with or without
  a bundled web artifact"): the reference script **throws** if
  `packages/app/dist` is missing after the build step. This repository's
  script instead logs a message and **exits successfully**, clearing any
  stale bundle, when `apps/web/dist` does not exist. This lets
  `packages/server` build/prepack succeed before T15 lands a real web build,
  and lets any environment intentionally skip the web build. Added a
  `--skip-build` flag (not present in the reference) so the bundling step can
  be exercised/tested against a pre-existing `apps/web/dist` without
  reinvoking the web app's own build script.

## 2. Files not copied (already ported under T04)

The daemon-side web-serving contract this script feeds — SPA fallback,
hashed-asset immutable caching, Brotli/Gzip negotiation, and
`window.__PASEO_INITIAL_DAEMON_CONNECTION__` injection
(`packages/server/src/server/web-ui.ts`), its config resolution
(`PASEO_WEB_UI_ENABLED`, `PASEO_WEB_UI_DIST_DIR`,
`resolveBundledWebUiDistDir` in `packages/server/src/server/config.ts`), and
the CLI `--web-ui` / `--no-web-ui` flags
(`packages/cli/src/commands/daemon/start.ts`) — were already copied verbatim
as part of the full `packages/server` and `packages/cli` ports recorded in
`docs/T04-provenance.md` and `docs/T03-provenance.md`. T18 did not modify any
of that code; it only added the build script that produces the artifact those
components serve, and wired it into `package.json` (`build:daemon-web-ui`)
and `packages/server/package.json`'s existing `prepack` script (already
ported unchanged: `npm run build:clean && npm --prefix ../.. run
build:daemon-web-ui`).

## 2a. Post-review fix: Windows `spawn npm` ENOENT

Independent verification found that `run()`'s `spawn(command, args, { shell: false, ... })`
fails with `spawn npm ENOENT` on Windows, because `npm` resolves to a
`npm.cmd` shim that `child_process.spawn` can only launch through a shell.
This broke the default (non-`--skip-build`) invocation path — `npm run
build:daemon-web-ui` at the repo root and, transitively, `packages/server`'s
`prepack` — on a clean Windows checkout. The original verification only
exercised `--skip-build`, which bypasses `buildWebApp()` and therefore never
hit this code path.

Fix: `run()` now passes `shell: process.platform === "win32"`, so Windows
launches `npm` via a shell (resolving the `.cmd` shim) while other platforms
keep `shell: false` (direct exec, no shell-quoting concerns). No other
behavior changed.

## 3. Verification performed

- `scripts/build-daemon-web-ui.mjs --skip-build` against a missing
  `apps/web/dist`: logs and exits 0, clears any stale
  `packages/server/dist/server/web-ui`.
- `scripts/build-daemon-web-ui.mjs --skip-build` against a placeholder
  `apps/web/dist` (a minimal `index.html` plus one hashed `.js` asset):
  produces `packages/server/dist/server/web-ui` with `.br`/`.gz` siblings for
  the compressible files.
- `packages/server`'s existing (already-ported, unmodified) test suites —
  `src/server/web-ui.test.ts`, `src/server/config-web-ui.test.ts`,
  `src/server/bootstrap-web-ui.test.ts` (29 tests) — all pass unmodified
  against this repository.
- Manual smoke test: started the built daemon worker
  (`packages/server/dist/server/server/daemon-worker.js`) with
  `PASEO_WEB_UI_ENABLED=true` and `PASEO_WEB_UI_DIST_DIR` pointing at the
  script's output; confirmed `GET /` returns the injected
  `window.__PASEO_INITIAL_DAEMON_CONNECTION__` hint and `GET
/assets/<hashed>.js` returns `Content-Encoding: br` and `Cache-Control:
public, max-age=31536000, immutable`.

Re-verification after the Windows `spawn` fix (§2a), on Windows, from a clean
worktree with workspace prerequisites (`@picompanion/protocol`,
`@picompanion/highlight`, `@picompanion/relay`) built:

- `npm run build:daemon-web-ui` (repo root, no `--skip-build`): succeeds
  (exit 0), correctly builds `@picompanion/web`'s placeholder build script via
  `npm run build --workspace=@picompanion/web`, finds no `apps/web/dist` (T15
  not yet landed), logs, and clears the target directory.
- `npm run prepack` in `packages/server`: succeeds end-to-end (exit 0),
  including the `build:daemon-web-ui` step that previously failed with
  `spawn npm ENOENT`.
- `scripts/build-daemon-web-ui.mjs` (no `--skip-build`) against a placeholder
  `apps/web/dist`: builds via npm, finds the dist, copies and precompresses
  it into `packages/server/dist/server/web-ui` as expected.
- `src/server/web-ui.test.ts`, `src/server/config-web-ui.test.ts`,
  `src/server/bootstrap-web-ui.test.ts` (29 tests) re-run: all pass.
