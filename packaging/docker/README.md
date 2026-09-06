# Docker packaging (T43A3)

This is one of two optional packaging paths added by T43A3 (plan.md §13 Phase
8, item 3; §15.4's "Docker and Nix checks when their paths change"). Neither
path is required by, or wired into, the default `npm run build` /
`npm test` / `npm pack` workflow — see "Skippability" below.

## Build and run

From the **repository root** (the build context — see "Why the context is
the repo root"):

```bash
docker build -f packaging/docker/Dockerfile -t picompanion-daemon .
docker run --rm -p 127.0.0.1:6767:6767 -v picompanion-data:/data picompanion-daemon
```

`PASEO_HOME` inside the container is `/data`, backed by the named volume
`picompanion-data` so agent/session state survives container restarts.
Override any `.env.example` variable with `-e NAME=value`.

## Why the context is the repo root, not `packaging/docker/`

The image builds every `@picompanion/*` workspace this daemon needs
(protocol, relay, highlight, client, design-tokens, frontend-core, web,
server) via `npm ci` + the workspace build chain, exactly mirroring
`packages/server/package.json`'s own `prepack` script
(`build:clean` then the root `build:daemon-web-ui` script) and
`.github/workflows/ci.yml`'s `daemon-package-dry-run` job. That needs the
whole monorepo — every workspace's `package.json`, `package-lock.json`, and
`src/` — visible in the build context, which only the repo root provides.
`../../.dockerignore` at the repo root (not a `packaging/docker/.dockerignore`)
is what npm-workspaces Docker builds normally require for this reason.

## Why the same base image tag for both stages

`npm ci` resolves platform/arch-specific optional dependencies for
`sherpa-onnx-node` (`sherpa-onnx-linux-x64`, `sherpa-onnx-linux-arm64`, …)
and, when no prebuilt binary matches, `node-pty` falls back to `node-gyp
rebuild` against the build stage's own glibc and Node ABI. Both stages use
the identical `NODE_IMAGE` build arg (`node:22.23.1-bookworm-slim` by
default — glibc, matching the `sherpa-onnx-node` optional-dependency list,
which ships no musl/Alpine build) so the `node_modules` copied into the
runtime stage were built for the exact platform that will load them. Never
retarget the runtime stage to a different base image (Alpine, distroless,
etc.) without re-running the whole build against that image — copying
`node_modules` across a libc change is a silent, not a build-time, failure.

## Loopback vs. container-internal listen address

The image sets `PASEO_LISTEN=0.0.0.0:6767` so the daemon accepts
connections from anywhere inside its own container network namespace —
there is no other tenant of that namespace, so this does not widen the
daemon's real exposure. Real exposure is controlled entirely by how the
`docker run -p` (or Compose / orchestrator) publish flag binds the
container's port to a host address. Publish it as
`-p 127.0.0.1:6767:6767`, not `-p 6767:6767`, to keep the daemon reachable
only from the host itself — the same loopback-only stance plan.md §15.1 and
T59 describe for the bare-process deployment, carried into the containerized
one. A reverse proxy terminating TLS (T59) then talks to
`127.0.0.1:6767` on the host exactly as it would for a non-containerized
daemon.

## Size trade-off (disclosed, not fixed here)

The runtime stage copies the builder's entire `/repo`, including
`devDependencies` (vite, vitest, typescript, tsx, …) and every workspace's
`src/`, not just `@picompanion/server`'s own `package.json` `files` list
(`dist/server`, `dist/src`, `dist/scripts`, `README.md`, `.env.example`).
This keeps the Dockerfile simple and auditable at a real image-size cost.
A follow-up could instead `npm ci --omit=dev` a second time in the runtime
stage from a pruned `package.json`/lockfile subset, or use
`npm pack`'s own `files` list to select exactly what ships — but doing that
correctly for an npm-workspaces monorepo (workspace-protocol dependencies
need resolving to their built `dist/`, not their `workspace:*` source)
is real work with its own risk of quietly dropping a runtime dependency,
and was left undone here rather than done unverified. This is the
disclosed gap for **whoever picks up a Docker image-size task**, not a
functional defect in the path this task built.

## What has and has not been verified

**Not verified — no Docker runtime available in the environment that wrote
this file:**

- That `docker build` actually completes against this Dockerfile.
- That `npm ci` resolves and installs cleanly inside the `node:22.23.1-bookworm-slim`
  image (in particular, that `node-pty`'s `node-gyp rebuild` fallback
  succeeds with only `python3 make g++ git` installed, and that
  `sherpa-onnx-node`'s optional-dependency resolution picks a real,
  loadable binary for the build architecture).
- That the running container actually serves the bundled web UI and
  accepts daemon connections end to end.

**Verified statically, without a container runtime** (see this task's
report for the exact commands and output):

- Every `COPY` source this Dockerfile names (`.` from the repo root)
  exists (`scripts/ci/guard-docker-packaging-paths.mjs`). CORRECTED
  (P6-W20 gate): this also claimed the guard checks the source "is not
  excluded by `.dockerignore` in a way that would break the build". The
  guard never reads `.dockerignore` — `grep -c dockerignore` returns 0 in
  all three guard files. Note too that with a single `COPY . .` this
  check only ever asserts that `.` exists, so it is close to inert on
  this particular Dockerfile.
- The Dockerfile's build steps NAME every workspace
  `npm pack --dry-run --json --workspace=@picompanion/server`'s dependency
  chain requires, appear in the order their own real `dependencies` field
  requires, and include the `build:daemon-web-ui` step running AFTER
  `build:clean --workspace=@picompanion/server` (same guard).
  CORRECTED (P6-W20 gate): this said the guard checks those steps appear
  "in the same order `packages/server/package.json`'s `prepack` script
  encodes", and concluded that "this packaging path cannot silently skip
  the T43A1 bundling invariant". Both halves were false at the time — the
  guard did presence checks only. Reproduced at the gate: swapping the
  `build:clean` and `build:daemon-web-ui` lines in BOTH packaging files
  left `run-guard-docker-packaging-paths.mjs` at **exit 0**, and that
  order is exactly the one the Dockerfile's own "Never reorder step 3
  after step 4" warning (in its builder-stage comment block) calls fatal —
  `build:clean` would wipe `packages/server/dist` after the web UI was
  bundled into it. Positive control from the same session: deleting the
  `@picompanion/highlight` build line gave exit 1. Omission was caught;
  ordering was not.

  T174 closed it: `findBuildOrderViolations` in
  `scripts/ci/guard-docker-packaging-paths.mjs` now asserts
  `build:clean --workspace=@picompanion/server` runs before
  `build:daemon-web-ui`, and that `@picompanion/client`,
  `@picompanion/frontend-core`, and `@picompanion/web` each build after
  the `@picompanion/*` workspaces their own `dependencies` field names
  (see `WORKSPACE_BUILD_DEPENDENCIES` in that file). Re-run at T174:
  swapping the `build:clean`/`build:daemon-web-ui` lines in EITHER
  packaging file independently now gives **exit 1**; the files intact
  give exit 0; the `@picompanion/highlight`-omission positive control
  still gives exit 1. Building the full `REQUIRED_WORKSPACE_BUILD_STEPS`
  list in strict left-to-right array order is still not required — four
  of its members (`protocol`, `relay`, `highlight`, `design-tokens`) have
  no `@picompanion/*` dependencies of their own, so nothing actually
  requires them to build in one particular relative order and the guard
  does not manufacture a false positive by pinning one anyway.

- No file under `packaging/` names any legacy Paseo `packages/app` path
  (same guard, plus a manual `rg` — see the task report).

## Skippability

Nothing in the default workflow (`npm run build`, `npm test`, `npm run
typecheck`, `npm pack`, the `prepack` lifecycle script) reads anything
under `packaging/`. Deleting this directory changes nothing about any of
those commands.

CORRECTED (T176): this used to say the `scripts/ci/guard-docker-packaging-
paths.mjs` check "is not yet wired into any CI job". T176 wired it —
`.github/workflows/ci.yml`'s `guard-docker-packaging-paths` job runs
`node scripts/ci/run-guard-docker-packaging-paths.mjs` on any change under
`packaging/**` or `scripts/ci/**` (see `.github/ci-paths.yml`'s `packaging`
filter), or whenever a push already forces a full CI run. A real
`docker build`/`nix build` against these paths still does not run in CI;
see `packaging/README.md`'s disclosure for that separate, still-open gap.
