# Packaging paths (T43A3)

Two optional daemon packaging paths, added on top of the packaging T43A1
and T43A2 already established (`npm run build:daemon-web-ui`, the
`daemon-package-dry-run` CI job, `scripts/ci/guard-daemon-web-ui-bundled.mjs`):

- [`docker/`](./docker/README.md) — a two-stage `Dockerfile` producing a
  container image that runs the daemon with the bundled web UI.
- [`nix/`](./nix/README.md) — a Nix flake providing a dev shell and a
  package derivation for the same thing.

Both preserve the T43A1 packaging invariant instead of routing around it:
the daemon's runnable artifact always carries `apps/web/dist` as
`dist/server/web-ui`, produced by the same
`npm run build:daemon-web-ui` script and the same build order
`packages/server/package.json`'s `prepack` script already encodes. Neither
path re-derives that bundling step differently.

## Verification

`node scripts/ci/run-guard-docker-packaging-paths.mjs` statically checks
both paths: that the Dockerfile's and flake's referenced source paths
exist in this repository, that their build-order commands include every
workspace `@picompanion/server`'s real dependency chain needs plus the
`build:daemon-web-ui` step, and that neither file names a legacy Paseo
`packages/app` path. See the task report for what this run found, and each
subdirectory's README for what remains unverified without a real Docker or
Nix installation — an honest limit, not an oversight: this task's
instructions explicitly forbid running `docker build`, `docker run`, or
`nix build` here.

## Skippability

Nothing under `packaging/` is read by the default `npm run build`, `npm
test`, `npm run typecheck`, `npm pack`, or the `prepack` lifecycle script.
Deleting this whole directory changes none of their behavior.

## CI: the static guard runs; a real `docker build`/`nix build` still does not

T176 wired the static packaging guard
(`node scripts/ci/run-guard-docker-packaging-paths.mjs`, T43A3/T174) into
`.github/workflows/ci.yml` as the `guard-docker-packaging-paths` job. It
runs whenever `packaging/**` or `scripts/ci/**` changes (a new `packaging`
filter in `.github/ci-paths.yml`), or on any push/PR that already forces a
full run (routing/workspace/CI-definition changes, or any push to `main`).
It reads both packaging files as plain text and does not need a Docker or
Nix toolchain; see that script's own header, and
`scripts/ci/guard-docker-packaging-paths.mjs`'s header, for exactly what it
does and does not prove — T174 changed those assertions in the same wave
this disclosure was updated, so this file intentionally does not enumerate
them; they are the guard's business, not this README's.

CORRECTED (T397). This paragraph said no CI job runs a real `docker build`
or `nix build` against these packaging paths, that the `docker`/`nix`
filters in `.github/ci-paths.yml` "still only match a repository-root
`Dockerfile`/`docker/**` and `flake.nix`/`nix/**`", that both jobs "remain
exactly as dormant as before T176", and that the exact seam to close was
repointing those two filters. Every one of those statements was true when
written and the first three are now fixed. The fourth was INCOMPLETE, which
is the part worth keeping: repointing the filters was necessary and not
sufficient, because both job BODIES were also written for repository-root
paths — `docker build -t picompanion-ci-check .` with no `-f`, and a bare
`nix flake check` — so a filter-only fix would have started two jobs and
watched each fail on a missing file rather than on anything about the
inputs here. T397 corrected the filters and both bodies together.

What is genuinely undone is now narrower and is named rather than implied:
`packaging/nix/flake.nix` still carries `npmDepsHash = pkgs.lib.fakeHash`,
a placeholder its own header discloses. `nix flake check` EVALUATES the
flake's outputs without building them, and this flake declares no `checks`
output, so that placeholder is not reached by the CI job as wired — but
`nix build .#default` would still fail on it, and nothing in CI covers that
today. Substituting a real hash needs someone who can run `nix` locally.
The task ID for the CI half is T397 in `docs/issues-from-plan.md`; the
hash half remains unfiled work for whoever has a `nix` binary.
