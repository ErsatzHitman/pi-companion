# Nix packaging (T43A3)

This is the second of two optional packaging paths added by T43A3 (plan.md
§13 Phase 8, item 3; §15.4). Like `packaging/docker/`, nothing in the
default `npm run build` / `npm test` / `npm pack` workflow reads anything
under `packaging/` — see "Skippability".

## What this gives you today

- **`nix develop`** (from `packaging/nix/`, or `nix develop
./packaging/nix` from the repo root): a shell with Node 22 and the
  native-module build toolchain (`python3`, `make`/`gnumake`, `gcc`,
  `pkg-config`, `git`) that `node-pty`'s `node-gyp rebuild` fallback and a
  from-source build need. This has **no `npmDepsHash` to fill in** and is
  the more likely of the two outputs to work as written — but see
  "What has and has not been verified" below; it has never actually been
  entered.
- **`nix build .#default`** (same directory): intended to produce
  `result/bin/picompanion-daemon`, mirroring
  `packaging/docker/Dockerfile`'s build order exactly (protocol -> relay ->
  highlight -> client -> design-tokens -> frontend-core -> web -> server's
  `build:clean` -> `build:daemon-web-ui --skip-build`). **This cannot build
  as committed** — see below.

## Why `packages.default` cannot build as committed

`flake.nix`'s `npmDepsHash` is `pkgs.lib.fakeHash`, a Nix convention: the
first real `nix build` against a `buildNpmPackage` derivation always fails
with a hash mismatch, and Nix prints the correct hash in its error output.
That is the intended way to fill in the real value — computing it requires
actually running Nix's fixed-output-derivation fetch against
`package-lock.json`, which needs a real `nix` installation this environment
does not have. Whoever next has Nix installed should:

1. Run `nix build .#default` from `packaging/nix/`.
2. Copy the "got: sha256-..." hash from the failure output into
   `npmDepsHash` in `flake.nix`.
3. Re-run `nix build .#default` and continue from whatever the next failure
   is (see the two specific risks named below — either could be the next
   thing that needs a real fix, not just a hash).

## What has and has not been verified

**Not verified — no `nix` binary available in the environment that wrote
this file:**

- That `nix build` or `nix develop` parse and evaluate this flake at all
  (Nix's own error messages for a malformed flake are often only legible
  once you can actually run `nix flake check`).
- The real `npmDepsHash` (see above).
- Whether `sherpa-onnx-node`'s platform-specific optional-dependency
  binary and `node-pty`'s `node-gyp rebuild` fallback succeed inside Nix's
  **sandboxed** build phase. `buildNpmPackage`'s fixed-output `npmDepsHash`
  derivation is the only step with network access; the actual `buildPhase`
  above runs `npm run build --workspace=...` commands with network
  disabled. If either native module's install step tries to reach the
  network _during_ a workspace's `npm run build` (rather than having
  already resolved everything during the earlier, network-enabled
  dependency-fetch step), the build fails inside Nix's sandbox in a way
  Docker's unsandboxed build does not reproduce. This is the single
  biggest open risk in this packaging path and is exactly why it is
  disclosed here rather than silently assumed to work.
- That the resulting `result/bin/picompanion-daemon` launcher actually
  starts a working daemon that serves the bundled web UI.

**Verified statically, without a Nix installation** (see this task's
report for the exact commands and output):

- The Nix expression's syntax is well-formed enough for `node` to parse it
  as balanced braces/parens/brackets and to extract every `src`-relative
  path it names (`scripts/ci/guard-docker-packaging-paths.mjs`'s Nix check
  — a much shallower check than `nix flake check` would give you, disclosed
  as such).
- The `src = ../..` reference resolves to the repository root, the build
  phase names every workspace on a hardcoded required list, builds
  `@picompanion/client`/`@picompanion/frontend-core`/`@picompanion/web`
  after the `@picompanion/*` workspaces their own real `dependencies`
  field names, and runs `build:clean --workspace=@picompanion/server`
  before `build:daemon-web-ui` (same guard). CORRECTED (P6-W20 gate):
  this said those workspace names are checked against "real
  `package.json` files in this repository". They are not — the guard
  compares against `REQUIRED_WORKSPACE_BUILD_STEPS`, a literal array,
  and reads no manifest at any point. The array's CONTENTS were
  re-derived from the real manifests at the gate and are correct; it is
  the provenance claim that was wrong. At the time of that correction the
  check was ALSO fully order-insensitive: reordering `build:clean` after
  `build:daemon-web-ui` in this flake left the guard at exit 0 while
  yielding a derivation with no web UI.

  T174 closed the ordering gap: `findBuildOrderViolations` in
  `scripts/ci/guard-docker-packaging-paths.mjs` now asserts the
  `build:clean`-before-`build:daemon-web-ui` order and the
  `WORKSPACE_BUILD_DEPENDENCIES` edges listed above. Re-run at T174:
  reordering `build:clean` after `build:daemon-web-ui` in this flake now
  gives **exit 1**; the file as written gives exit 0. The full
  `REQUIRED_WORKSPACE_BUILD_STEPS` list is still not required to appear
  in strict left-to-right array order — `protocol`, `relay`, `highlight`,
  and `design-tokens` have no `@picompanion/*` dependencies of their own,
  so nothing requires one particular relative order among them and the
  guard does not pin one.

- No file under `packaging/` names any legacy Paseo `packages/app` path
  (same guard, plus a manual `rg` — see the task report).

## Skippability

Deleting `packaging/nix/` changes nothing about `npm run build`, `npm
test`, `npm run typecheck`, `npm pack`, or the `prepack` lifecycle script —
none of them read anything under `packaging/`.
