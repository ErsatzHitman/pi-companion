# Pi Companion

Pi Companion is a purpose-built control surface for the [Pi coding agent](https://github.com/earendil-works/pi):
a laptop daemon plus two new frontends — a DOM-first web application and a native
Android application — that share one framework-neutral core.

> **The authoritative specification for this repository is [`plan.md`](./plan.md).**
> Every architectural decision, package boundary, phase, and acceptance criterion in
> this codebase traces back to it. If anything below (or in any other document)
> disagrees with `plan.md`, `plan.md` wins. Read it before making structural changes,
> and read `docs/issues-from-plan.md` for the task breakdown that implements it.

## What this repository is

This is a **new repository built from scratch**, not a fork. It has no upstream Git
remote and no inherited working tree. The read-only reference checkout at `D:\paseo`
(Paseo `v0.3.0-beta.2`, AGPL-3.0-or-later) is consulted for behavior and for the
difficult backend systems work — the daemon, wire protocol, client SDK, relay,
connection/auth flow, CLI, Pi provider, and pi-bridge — which is ported or
re-implemented here under the `@picompanion/*` package scope with full AGPL
attribution (see [`THIRD_PARTY_NOTICES.md`](./THIRD_PARTY_NOTICES.md)).

**Paseo's old frontend (`packages/app` in the reference checkout) never enters this
repository.** No Pi UI renderer, no Beautiful component, no screen, no store, and no
test from that tree is copied, ported, or used as a base here. This repository's `web`
and `android` apps are built from blank scaffolds, driven by a shared
`@picompanion/frontend-core` package. See `plan.md` §5 ("Legacy frontend policy") for
the full exclusion boundary and the narrow, legacy-checkout-only migration exception.

## Repository layout

```text
apps/
  web/                 DOM-first React + Vite web application (no Next.js, no SSR)
  android/              Expo/React Native Android-only application
packages/
  frontend-core/        Framework-neutral shared core (no React/RN/Expo/DOM imports)
  design-tokens/        Shared design tokens with web (CSS vars) and native outputs
  protocol/             Ported wire protocol (@picompanion/protocol)
  client/                Ported client SDK (@picompanion/client)
  server/                Ported daemon, including the Pi provider (@picompanion/server)
  relay/                 Ported relay (@picompanion/relay)
  highlight/              Ported syntax highlighting (@picompanion/highlight)
  cli/                    Ported CLI (@picompanion/cli)
  pi-bridge/              Ported Pi UI bridge (@picompanion/pi-bridge)
  expo-two-way-audio/     Ported native audio module
docs/                    Provenance records and Phase 0 decision documents
plan.md                   Authoritative plan for the entire rebuild
```

The full target tree, including feature folders inside `apps/*` and
`packages/frontend-core`, is defined in `plan.md` §6.

## Reference-only documents

Some documents in this tree were **copied verbatim from the Paseo reference
checkout** as part of porting the backend packages, or were generated while auditing
that checkout. They describe Paseo's old product, its old frontend, or its old
monorepo layout, and are kept only as historical/behavioral reference — **none of them
specify this product**:

- `packages/server/README.md`, `packages/server/CLAUDE.md`, `packages/server/AGENTS.md`
- `packages/client/README.md`, `packages/protocol/README.md`, `packages/pi-bridge/README.md`
- `packages/expo-two-way-audio/README.md` and its `CODE_OF_CONDUCT.md`/`CONTRIBUTING.md`
- `docs/T02-provenance.md`, `docs/T03-provenance.md`, `docs/T04-provenance.md` (what was
  copied and why, for AGPL attribution)
- `docs/frontend-data-migration.md`, `docs/pi-extension-compatibility.md` (Phase 0
  decision records about the reference checkout)

If a claim in one of those documents ever conflicts with `plan.md`, treat it as
describing Paseo, not Pi Companion.

## Development

Keep the production daemon on port `6767` untouched unless the user explicitly
approves restarting it. Local development targets a separate dev daemon on
`127.0.0.1:6768`. See `plan.md` §15.1 for the full local-development setup.

Install from the repository root with plain `npm install` (it installs every workspace
_and_ the root-only tooling). Do not add `include-workspace-root=true` to `.npmrc`:
it makes every `npm run <script> --workspace=<pkg>` also try to run `<script>` in the
root package, which breaks the nested workspace builds (`client` → `protocol`,
`cli` → `server`, `android` → `frontend-core`) and the root `build:*` scripts.
If you install with `npm install --workspaces`, follow it with a bare `npm install`
so the root devDependencies (oxfmt, oxlint, knip, typescript, vitest) are present.

```bash
npm install
npm run typecheck
npm run lint
npm run format:check
npm run dev:server      # start the daemon
npm run dev:web         # start the web app
npm run dev:android     # start the Android app (Expo)
```

Do not run the full test suite locally; use CI for the complete matrix. Run targeted
tests instead, for example:

```bash
npx vitest run packages/protocol/tests --bail=1
npm run typecheck --workspace=@picompanion/frontend-core
```

See `plan.md` §14.6 for the full list of local quality commands and §15 for build,
bundling, and Android release details.

## License

AGPL-3.0-or-later, from the first commit — see [`LICENSE`](./LICENSE). Third-party
provenance and attribution are recorded in
[`THIRD_PARTY_NOTICES.md`](./THIRD_PARTY_NOTICES.md).

## For AI coding agents

See [`CLAUDE.md`](./CLAUDE.md) for agent-focused rules, including the legacy-frontend
exclusion boundary, package invariants, and the pointer back to `plan.md`.
