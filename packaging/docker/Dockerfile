# syntax=docker/dockerfile:1.7
#
# Pi Companion daemon — Docker packaging path (T43A3, plan.md §15.4 "Docker
# and Nix checks when their paths change").
#
# This file is new, written for this repository's own npm-workspaces build
# graph. It is not derived from, or a port of, any file under a Paseo
# `packages/app` tree (plan.md §5) — Paseo has no Docker packaging for that
# tree to port from in the first place.
#
# Build (from the REPOSITORY ROOT, which is the build context — see
# packaging/docker/README.md for why the context can't be packaging/docker/
# itself):
#   docker build -f packaging/docker/Dockerfile -t picompanion-daemon .
#
# Run:
#   docker run --rm -p 127.0.0.1:6767:6767 \
#     -v picompanion-data:/data \
#     picompanion-daemon
#
# packaging/docker/README.md has the full walkthrough, the security notes
# on the `-p 127.0.0.1:...` host-loopback publish flag versus this image's
# own `0.0.0.0` internal listen address, and — most importantly — an
# explicit "what has and has not been verified" section. No Docker runtime
# is available in the environment that authored this file; it has never
# actually been built or run. `scripts/ci/guard-docker-packaging-paths.mjs`
# statically checks this file's COPY sources exist and that its build
# steps NAME every workspace the dependency chain needs plus the
# `build:daemon-web-ui` step. CORRECTED (P6-W20 gate): this said the
# guard checks that the build ORDER matches `packages/server/
# package.json`'s `prepack`. It does not — both checks are
# `includes()` presence tests over the concatenated RUN text, with no
# position comparison anywhere in the guard. Swapping the
# `npm run build:clean --workspace=@picompanion/server` and
# `npm run build:daemon-web-ui -- --skip-build` lines below (so
# `build:clean` wipes the dist AFTER the web UI is bundled) leaves the
# guard at exit 0 while producing an image with no web UI at all; deleting
# a build line is caught, reordering is not.
#
# UPDATED (T174): the ordering half now exists. The same guard's
# `findBuildOrderViolations` asserts `build:clean
# --workspace=@picompanion/server` runs before `build:daemon-web-ui`, and
# that `@picompanion/client`/`@picompanion/frontend-core`/
# `@picompanion/web` each build after the `@picompanion/*` workspaces
# their own real `dependencies` field names. Re-run at T174: swapping the
# two lines below now gives exit 1; the file as written gives exit 0; the
# `@picompanion/highlight`-omission positive control still gives exit 1.
# Either way, none of this is a real `docker build`.

ARG NODE_IMAGE=node:22.23.1-bookworm-slim

# -----------------------------------------------------------------------
# Stage 1 (builder): install every workspace dependency and build the
# exact chain `packages/server/package.json`'s `prepack` script and
# `.github/workflows/ci.yml`'s `daemon-package-dry-run` job use:
#   1. the server's own `@picompanion/*` dependency chain
#      (protocol -> relay -> highlight -> client)
#   2. the web app's `@picompanion/*` dependency chain
#      (protocol -> design-tokens -> frontend-core -> highlight -> web)
#   3. the server's own `build:clean` (T43A1: this WIPES
#      packages/server/dist first, so it must run before step 4)
#   4. `build:daemon-web-ui` (T43A1's invariant: bundles the already-built
#      apps/web/dist into packages/server/dist/server/web-ui) with
#      --skip-build, since apps/web was already built in step 2
#
# Never reorder step 3 after step 4 — build:clean's dist wipe would erase
# an already-bundled web-ui.
# -----------------------------------------------------------------------
FROM ${NODE_IMAGE} AS builder

# node-pty's install script tries a prebuilt binary first and falls back to
# `node-gyp rebuild`; python3/make/g++ are node-gyp's toolchain. git is
# needed by some transitive install scripts that shell out to it for
# version metadata.
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 make g++ git \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /repo

# Single-layer copy of the whole source tree (filtered by the repo-root
# .dockerignore). npm workspaces resolve every package.json in one `npm
# ci`, so per-workspace layer caching would need one COPY per workspace
# package.json before this; this repo is small enough that the simpler,
# fully-auditable single COPY was chosen instead. See
# packaging/docker/README.md "Build cache trade-off" if that changes.
COPY . .

RUN npm ci

RUN npm run build --workspace=@picompanion/protocol \
    && npm run build --workspace=@picompanion/relay \
    && npm run build --workspace=@picompanion/highlight \
    && npm run build --workspace=@picompanion/client \
    && npm run build --workspace=@picompanion/design-tokens \
    && npm run build --workspace=@picompanion/frontend-core \
    && npm run build --workspace=@picompanion/web \
    && npm run build:clean --workspace=@picompanion/server \
    && npm run build:daemon-web-ui -- --skip-build

# -----------------------------------------------------------------------
# Stage 2 (runtime): same base image TAG as the builder. `npm ci` above
# resolves platform/arch-specific prebuilt native binaries for node-pty and
# sherpa-onnx-node (see packaging/docker/README.md "Why the same base
# image"); copying that node_modules tree into a *different* base image
# (Alpine's musl libc, most notably) silently produces a binary that fails
# to load at runtime instead of a build-time error. Copying the whole
# /repo forward — rather than pruning devDependencies — keeps this stage
# simple at a real, disclosed size cost; see the README for the pruning
# follow-up.
# -----------------------------------------------------------------------
FROM ${NODE_IMAGE} AS runtime

RUN useradd --system --create-home --home-dir /home/picompanion picompanion \
    && mkdir -p /data \
    && chown picompanion:picompanion /data

WORKDIR /repo
COPY --from=builder --chown=picompanion:picompanion /repo /repo

# PASEO_HOME (packages/server/.env.example) holds runtime state
# (agents.json, sessions, etc.) and must survive container restarts.
VOLUME ["/data"]

# The container's OWN network namespace has no other tenants, so listening
# on 0.0.0.0 here does not widen the daemon's real exposure — that is
# controlled entirely by how the `docker run -p ...` (or Compose / Nix
# service) publish flag binds the container port to a host address. Publish
# it as `-p 127.0.0.1:6767:6767` to keep the daemon loopback-only from
# off-host, matching plan.md §15.1 / T59's stance for the bare-process
# deployment. See packaging/docker/README.md.
ENV PASEO_HOME=/data \
    PASEO_LISTEN=0.0.0.0:6767 \
    NODE_ENV=production

EXPOSE 6767
USER picompanion
WORKDIR /repo/packages/server
ENTRYPOINT ["node", "dist/scripts/supervisor-entrypoint.js"]
