# Third-Party Notices

Pi Companion is licensed AGPL-3.0-or-later (see `LICENSE`). This document
records the provenance of code brought into this repository from third-party
sources, per plan §10.1, and is the gate document that any Beautiful-inspired
UI recipe must be checked against before it lands (Phase 0 gate — see
"Beautiful Components gate" below).

Detailed, file-level provenance for each porting task lives alongside this
document:

- `docs/T02-provenance.md` — protocol, relay, highlight
- `docs/T03-provenance.md` — client, cli, pi-bridge, expo-two-way-audio
- `docs/T04-provenance.md` — server (incl. Pi provider)
- `docs/T18-provenance.md` — daemon web-UI bundling script (`scripts/build-daemon-web-ui.mjs`)

This file is the consolidated, canonical attribution record referenced by
those documents and by plan §10.1.

## 1. Paseo (`D:\paseo`) — AGPL-3.0-or-later

- **Project:** Paseo — "Pi Companion: voice-controlled development
  environment for local AI coding agents"
- **Repository:** `https://github.com/getpaseo/paseo.git`
- **Homepage:** `https://paseo.sh`
- **Copyright:** Copyright (c) 2025-present Mohamed Boudra
- **License:** GNU Affero General Public License v3.0 or later
  (AGPL-3.0-or-later), plus per-component third-party licenses for
  incorporated dependencies (see `LICENSE` in the reference checkout).
- **Version ported:** `v0.3.0-beta.2` (tag `v0.3.0-beta.2-31-gede26c8e2`),
  commit `ede26c8e2e210b9e12cca0e6d6cf3e10a07208f8`, 2026-08-31.
- **Reference checkout used for porting:** `D:\paseo` (read-only; never
  modified, never given a git remote in this repository).
- **Explicitly excluded:** `packages/app` (the legacy Expo frontend,
  including `src/ui/beautiful/` and `src/pi-ui/`) was never copied, ported,
  or used as a code base — see §2 below. It was consulted only as read-only
  behavior/screenshot reference during design work outside this repository's
  history.

### 1.1 Packages copied and attribution per package

Every package below retains its original AGPL-3.0-or-later license and the
Mohamed Boudra / Paseo copyright notice. This repository's own AGPL-3.0-or-later
`LICENSE` covers this repository's cumulative work, consistent with AGPL §5(c)
("You must license the entire work ... under this License").

| Package (`@picompanion/*`) | Source path (`D:\paseo\...`)      | What was copied                                                                                                                                                                                                                                                                                                          | Task | Provenance doc           |
| -------------------------- | --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---- | ------------------------ |
| `protocol`                 | `packages/protocol`               | Full package verbatim (107 tracked files): wire schemas, RPC schemas, binary frames, validation/AOT codegen, tests.                                                                                                                                                                                                      | T02  | `docs/T02-provenance.md` |
| `relay`                    | `packages/relay`                  | Full package verbatim (15 tracked files): e2ee, Cloudflare adapter, cutover proxy. `e2e.test.ts` patched locally to skip gracefully without `wrangler`.                                                                                                                                                                  | T02  | `docs/T02-provenance.md` |
| `highlight`                | `packages/highlight`              | Full package verbatim (11 tracked files): syntax highlighter, themes, parsers.                                                                                                                                                                                                                                           | T02  | `docs/T02-provenance.md` |
| —                          | `scripts/clean-package-dist.mjs`  | Shared build script, copied verbatim, used by all workspaces.                                                                                                                                                                                                                                                            | T02  | `docs/T02-provenance.md` |
| `client`                   | `packages/client`                 | Full package verbatim (23 tracked files): WebSocket/relay transports, reconnect, request correlation, terminal stream router.                                                                                                                                                                                            | T03  | `docs/T03-provenance.md` |
| `cli`                      | `packages/cli`                    | Full package verbatim (195 tracked files). One test's Windows path expectation adjusted to use `path.join`.                                                                                                                                                                                                              | T03  | `docs/T03-provenance.md` |
| `pi-bridge`                | `packages/pi-bridge`              | Full package verbatim (5 tracked files).                                                                                                                                                                                                                                                                                 | T03  | `docs/T03-provenance.md` |
| `expo-two-way-audio`       | `packages/expo-two-way-audio`     | Full package verbatim (59 tracked files) — see §1.2, this package carries its own MIT license, aggregated (not relicensed) under this repository's AGPL-3.0-or-later distribution.                                                                                                                                       | T03  | `docs/T03-provenance.md` |
| `server`                   | `packages/server`                 | 696 tracked files copied verbatim (byte-identical tree hash to reference); 32 provably-dead non-Pi test/script files removed post-copy (imported providers never in tracked source); Pi provider (`providers/pi/`, `ui-bridge/`, session watcher, live tail) intact.                                                     | T04  | `docs/T04-provenance.md` |
| —                          | `scripts/build-daemon-web-ui.mjs` | Adapted (not verbatim): compression/copy/measurement logic ported function-for-function from the reference script; source retargeted from `packages/app/dist` to `apps/web/dist`, and a missing source dist now exits successfully (daemon runs without a bundled UI) instead of throwing. See `docs/T18-provenance.md`. | T18  | `docs/T18-provenance.md` |

Files original to this repository (not from Paseo), added alongside ported
packages:

- `packages/server/scripts/smoke-daemon-hello.ts` (T04)
- The `PI_CODING_AGENT_DIR` / `PI_CODING_AGENT_SESSION_DIR` scratch-directory
  pin in `packages/server/src/test-utils/vitest-setup.ts` (T04, behavioral
  addition to an otherwise-ported file)

### 1.2 `expo-two-way-audio` — nested MIT license

`packages/expo-two-way-audio` is distributed inside the Paseo monorepo under
the umbrella AGPL-3.0-or-later license, but its own `packages/expo-two-way-audio/LICENSE`
carries a separate MIT notice:

```
MIT License
Copyright (c) 2023, Cantab Research Ltd.
```

That MIT notice is preserved verbatim at `packages/expo-two-way-audio/LICENSE`
in this repository. The package is aggregated with, not relicensed into, the
rest of this AGPL-3.0-or-later repository, consistent with how it was
distributed in the Paseo reference.

### 1.3 Compliance notes

- No file under `D:\paseo\packages\app` was copied into this repository at
  any point. Only synthetic path-shaped strings occur inside protocol test
  fixture data (e.g. `/paseo/worktrees/.../packages/app`), which are test
  values, not filesystem or import references.
- `D:\paseo` was used strictly as a read-only reference checkout; it was
  never added as a git remote and its own history is not part of this
  repository's history (`git remote -v` in this repository prints nothing).
- Local modifications made to ported files are itemized in the per-task
  provenance docs referenced in §1.1; they are behavioral fixes and
  isolation/test-environment adjustments, not new feature ports.
- This repository's root `LICENSE` (AGPL-3.0-or-later) governs the
  cumulative work as required by AGPL §5(c); this notices file documents
  provenance of the incorporated Paseo-derived and third-party portions per
  plan §10.1.

## 2. Beautiful UI — MIT (plan §10.1)

**Beautiful UI** is an external third-party design library:

- Source: <https://www.beautifului.dev/> ("Crafted primitives for AI-native
  interfaces"), built by Turbo (<https://turbodesign.co/>).
- License: **MIT**, Copyright (c) 2026 Shane Levine
  (<https://www.beautifului.dev/license>).
- Visual language extracted 2026-09-01 into `docs/beautiful-ui-reference.md`.

MIT is compatible with this project's AGPL-3.0-or-later. Beautiful UI code may
therefore be adapted directly into this repository, **provided the MIT notice
below is retained**. Any file containing adapted Beautiful UI code must carry
an attribution header naming this section, and must add a row to the checklist
below before it merges. Purely visual conformance — using the tokens, shapes,
and motion described in `docs/beautiful-ui-reference.md` without copying code
— does not require a row.

### MIT License notice (retain verbatim)

```
MIT License

Copyright (c) 2026 Shane Levine

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

> **Correction (2026-09-01).** This section previously identified "Beautiful
> Components" as the legacy work at `D:\paseo\packages\app\src\ui\beautiful\`
> and asserted it was "not an external third-party design library", forbidding
> code reuse. That was a misidentification: the real source is the MIT-licensed
> library above. The Phase 3 recipes (T25B/T26B) were built from clean
> specifications under the old, stricter reading and therefore need no rows;
> the Phase 3.5 conformance tasks (T25C/T26C) may adapt code and must add rows
> for any file that does.

Nothing from `D:\paseo\packages\app\src\ui\beautiful\` has been copied into
this repository (see §1.3 and plan §1.3), and that remains prohibited — it is
AGPL fork-experiment work, superseded by the MIT source above.

### Beautiful source/license checklist

Rows are required only for files containing **adapted code**, not for files that
merely conform to the visual language.

| Component / recipe                                     | Source URL | Version / commit | License | Attribution required | Approved by | Notes |
| ------------------------------------------------------ | ---------- | ---------------- | ------- | -------------------- | ----------- | ----- |
| _(none yet — no adapted Beautiful UI code has landed)_ |            |                  |         |                      |             |       |

Row format when a recipe is added:

- **Component / recipe** — the new component name in this repository (e.g.
  `ThinkingSection`).
- **Source URL** — exact reference location, e.g.
  the Beautiful UI component page or asset URL under
  <https://www.beautifului.dev/>, or an external URL for any other source.
- **Version / commit** — the retrieval date or published version inspected
  (Beautiful UI does not publish commit hashes on the site).
- **License** — the license governing that source (MIT for Beautiful UI;
  whatever license applies for any other external source).
- **Attribution required** — what notice, if any, must ship with this
  repository as a result (e.g. "none — reimplemented from a clean spec,
  interaction idea only" or "AGPL-3.0-or-later, see §1").
- **Approved by** — who signed off that the row satisfies the gate before the
  recipe merged.
- **Notes** — anything else relevant (e.g. "colors/layout reinterpreted from
  screenshot only, no code copied").

**Gate statement:** per plan §10.1, no file containing code adapted from
Beautiful UI or any other external source may be merged into this repository
without a corresponding, approved row in the table above and an attribution
header in the file itself. Components built from a clean specification, or
styled to match the visual language in `docs/beautiful-ui-reference.md`
without copying code, do not require a row, but should note "no third-party
code copied" in their own PR description.

## 3. Bundled fonts — SIL Open Font License 1.1

T13C (docs/issues-from-plan.md "Bundle Inter/Geist Mono and complete
light-theme values") self-hosts both fonts Beautiful UI's visual language
names (`docs/beautiful-ui-reference.md` "Fonts"), closing the gap where
neither shipped with the product and the UI silently fell back to whatever
sans/mono face happened to be installed on the host OS. Both are licensed
under the **SIL Open Font License, Version 1.1**; the license text is
vendored verbatim alongside each family's assets, as OFL requires.

| Font                 | Source used to vendor                                      | Version                    | License | Vendored at                                                                              |
| -------------------- | ---------------------------------------------------------- | -------------------------- | ------- | ---------------------------------------------------------------------------------------- |
| Inter (web)          | `@fontsource/inter` npm package (woff2, latin subset)      | 5.3.0 (upstream Inter 4.1) | OFL-1.1 | `apps/web/src/assets/fonts/inter/` (`Inter-{400,500,600,700}.woff2`, `OFL.txt`)          |
| Inter (Android)      | `@expo-google-fonts/inter` npm package (ttf)               | 0.4.2                      | OFL-1.1 | `apps/android/assets/fonts/` (`Inter-{400,500,600,700}.ttf`, `OFL-Inter.txt`)            |
| Geist Mono (web)     | `@fontsource/geist-mono` npm package (woff2, latin subset) | 5.3.0                      | OFL-1.1 | `apps/web/src/assets/fonts/geist-mono/` (`GeistMono-{400,500,600,700}.woff2`, `OFL.txt`) |
| Geist Mono (Android) | `geist` npm package (Vercel, ttf)                          | 1.7.2                      | OFL-1.1 | `apps/android/assets/fonts/` (`GeistMono-{400,500,600,700}.ttf`, `OFL-GeistMono.txt`)    |

- **Inter** — Copyright 2020 The Inter Project Authors
  (<https://github.com/rsms/inter>).
- **Geist Mono** — Copyright (c) 2023 Vercel, in collaboration with
  basement.studio (<https://github.com/vercel/geist-font>).
- Neither font is fetched from a CDN (Google Fonts or otherwise) at runtime:
  `apps/web/src/styles/fonts.css` declares `@font-face` rules against the
  vendored woff2 files with `font-display: swap`, and
  `apps/android/src/ui/theme/fonts.ts` registers the vendored TTFs through
  `expo-font`'s `useFonts()`. This keeps the product usable fully offline
  against a local daemon (plan §1, §15.1).
- Only the compiled font _files_ were vendored, not source code; no row is
  required in the Beautiful UI checklist above (that gate is for adapted
  _code_, and font assets are unrelated to the Beautiful UI library itself).
