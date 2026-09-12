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

| Package (`@picompanion/*`) | Source path (`D:\paseo\...`)      | What was copied                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | Task       | Provenance doc           |
| -------------------------- | --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------- | ------------------------ |
| `protocol`                 | `packages/protocol`               | Full package verbatim (107 tracked files): wire schemas, RPC schemas, binary frames, validation/AOT codegen, tests. CORRECTED (P6-W25 merge gate): T43B1 raised this to 108 by counting the one gitignored generated file that `docs/T02-provenance.md` lists under its own "not committed, gitignored" sub-heading; 107 was right.                                                                                                                                                                                      | T02        | `docs/T02-provenance.md` |
| `relay`                    | `packages/relay`                  | Full package verbatim (18 tracked files — corrected T43B1; was misstated as 15): e2ee, Cloudflare adapter, cutover proxy. `e2e.test.ts` patched locally to skip gracefully without `wrangler`.                                                                                                                                                                                                                                                                                                                           | T02        | `docs/T02-provenance.md` |
| `highlight`                | `packages/highlight`              | Full package verbatim (13 tracked files — corrected T43B1; was misstated as 11): syntax highlighter, themes, parsers.                                                                                                                                                                                                                                                                                                                                                                                                    | T02        | `docs/T02-provenance.md` |
| —                          | `scripts/clean-package-dist.mjs`  | Shared build script, copied verbatim, used by all workspaces.                                                                                                                                                                                                                                                                                                                                                                                                                                                            | T02        | `docs/T02-provenance.md` |
| `client`                   | `packages/client`                 | Full package verbatim (23 tracked files): WebSocket/relay transports, reconnect, request correlation, terminal stream router.                                                                                                                                                                                                                                                                                                                                                                                            | T03        | `docs/T03-provenance.md` |
| `cli`                      | `packages/cli`                    | Full package verbatim (195 tracked files). One test's Windows path expectation adjusted to use `path.join`.                                                                                                                                                                                                                                                                                                                                                                                                              | T03        | `docs/T03-provenance.md` |
| `pi-bridge`                | `packages/pi-bridge`              | Full package verbatim (5 tracked files).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | T03        | `docs/T03-provenance.md` |
| `expo-two-way-audio`       | `packages/expo-two-way-audio`     | Full package verbatim (59 tracked files) — see §1.2, this package carries its own MIT license, aggregated (not relicensed) under this repository's AGPL-3.0-or-later distribution.                                                                                                                                                                                                                                                                                                                                       | T03        | `docs/T03-provenance.md` |
| `server`                   | `packages/server`                 | 696 tracked files copied verbatim (byte-identical tree hash to reference); 38 provably-dead non-Pi test/script files removed post-copy (imported providers never in tracked source) — 6 in an earlier rescued-WIP pass plus 32 while completing T04 proper (**corrected T43B1, 2026-09-06**: this row previously said "32", counting only the second group; `docs/T04-provenance.md` §2 itemizes both groups and has always totaled 38); Pi provider (`providers/pi/`, `ui-bridge/`, session watcher, live tail) intact. | T04        | `docs/T04-provenance.md` |
| —                          | `scripts/build-daemon-web-ui.mjs` | Adapted (not verbatim): compression/copy/measurement logic ported function-for-function from the reference script; source retargeted from `packages/app/dist` to `apps/web/dist`. Between T18 and T43A1 a missing source dist exited successfully (daemon runs without a bundled UI) instead of throwing; **CORRECTED (T43B1, 2026-09-06):** T43A1 retired that leniency once `apps/web` had a real build, so the script now throws on a missing dist, matching the reference again. See `docs/T18-provenance.md`.       | T18, T43A1 | `docs/T18-provenance.md` |

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
sans/mono face happened to be installed on the host OS. T345 added a third,
JetBrains Mono, as Android's mono face. All three are licensed under the
**SIL Open Font License, Version 1.1**; the license text is vendored
verbatim alongside each family's assets, as OFL requires.

| Font                     | Source used to vendor                                      | Version                    | License | Vendored at                                                                                   |
| ------------------------ | ---------------------------------------------------------- | -------------------------- | ------- | --------------------------------------------------------------------------------------------- |
| Inter (web)              | `@fontsource/inter` npm package (woff2, latin subset)      | 5.3.0 (upstream Inter 4.1) | OFL-1.1 | `apps/web/src/assets/fonts/inter/` (`Inter-{400,500,600,700}.woff2`, `OFL.txt`)               |
| Inter (Android)          | `@expo-google-fonts/inter` npm package (ttf)               | 0.4.2                      | OFL-1.1 | `apps/android/assets/fonts/` (`Inter-{400,500,600,700}.ttf`, `OFL-Inter.txt`)                 |
| Geist Mono (web)         | `@fontsource/geist-mono` npm package (woff2, latin subset) | 5.3.0                      | OFL-1.1 | `apps/web/src/assets/fonts/geist-mono/` (`GeistMono-{400,500,600,700}.woff2`, `OFL.txt`)      |
| JetBrains Mono (Android) | `JetBrainsMono-2.304.zip` GitHub release asset (ttf)       | 2.304                      | OFL-1.1 | `apps/android/assets/fonts/` (`JetBrainsMono-{400,500,600,700}.ttf`, `OFL-JetBrainsMono.txt`) |

- **Inter** — Copyright 2020 The Inter Project Authors
  (<https://github.com/rsms/inter>).
- **Geist Mono** — Copyright (c) 2023 Vercel, in collaboration with
  basement.studio (<https://github.com/vercel/geist-font>). Web only since
  T345.
- **JetBrains Mono** — Copyright 2020 The JetBrains Mono Project Authors
  (<https://github.com/JetBrains/JetBrainsMono>). Android only: T345 swapped
  the Android mono face to the one the S7 phone design (plan.md §10.2) sets,
  and removed the vendored Geist Mono TTFs the app no longer registers.
- Neither font is fetched from a CDN (Google Fonts or otherwise) at runtime:
  `apps/web/src/styles/fonts.css` declares `@font-face` rules against the
  vendored woff2 files with `font-display: swap`, and
  `apps/android/src/ui/theme/fonts.ts` registers the vendored TTFs through
  `expo-font`'s `useFonts()`. This keeps the product usable fully offline
  against a local daemon (plan §1, §15.1).
- Only the compiled font _files_ were vendored, not source code; no row is
  required in the Beautiful UI checklist above (that gate is for adapted
  _code_, and font assets are unrelated to the Beautiful UI library itself).

## 4. NPM dependency licences (full workspace audit — T43B1)

T43B1 (2026-09-06) walked every `package.json` in the workspace (root,
`packages/*`, `apps/*`) — `dependencies`, `devDependencies`,
`peerDependencies`, and `optionalDependencies` — and resolved each
third-party (non-`@picompanion/*`) package's licence from its own
`node_modules/<name>/package.json` `license` field, per plan §10.1. This
table is that audit's record; it supersedes no prior section but is the
first place in this document where ordinary npm dependency licences (as
opposed to ported-code or vendored-asset provenance) are recorded at all.

108 distinct third-party package names are declared across the 13
`package.json` files. 107 resolve in `node_modules` with a licence field;
one (`expo-router`, declared in `apps/android/package.json` at `~6.0.13`) is
**not installed** — this is expected and already recorded in `CLAUDE.md`'s
known-uninstallable list (T116): it is never actually pulled in by `npm
install`, so it ships no code and needs no licence entry.

| Package                          | Version resolved     | Declared range(s)                 | Licence                          | Workspace(s)                                                                                                 |
| -------------------------------- | -------------------- | --------------------------------- | -------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `@anthropic-ai/claude-agent-sdk` | 0.3.251              | `^0.3.220`                        | **Proprietary** — see note below | server                                                                                                       |
| `@anthropic-ai/sdk`              | 0.104.2              | `^0.104.2`                        | MIT                              | server                                                                                                       |
| `@clack/prompts`                 | 1.7.0                | `^1.0.0`                          | MIT                              | cli                                                                                                          |
| `@codemirror/commands`           | 6.11.0               | `^6.11.0`                         | MIT                              | web                                                                                                          |
| `@codemirror/language`           | 6.12.4               | `6.12.4`                          | MIT                              | highlight, web                                                                                               |
| `@codemirror/legacy-modes`       | 6.5.3                | `^6.5.3`                          | MIT                              | highlight                                                                                                    |
| `@codemirror/state`              | 6.7.2                | `^6.7.2`                          | MIT                              | web                                                                                                          |
| `@codemirror/view`               | 6.43.10              | `^6.43.10`                        | MIT                              | web                                                                                                          |
| `@expo/metro-runtime`            | 57.0.14              | `^6.1.2`                          | MIT                              | android                                                                                                      |
| `@isaacs/ttlcache`               | 2.1.5                | `^2.1.4`                          | BlueOak-1.0.0                    | server                                                                                                       |
| `@lezer/common`                  | 1.5.2                | `^1.5.0`                          | MIT                              | highlight                                                                                                    |
| `@lezer/cpp`                     | 1.1.6                | `^1.1.5`                          | MIT                              | highlight                                                                                                    |
| `@lezer/css`                     | 1.3.6                | `^1.3.0`                          | MIT                              | highlight                                                                                                    |
| `@lezer/go`                      | 1.0.1                | `^1.0.1`                          | MIT                              | highlight                                                                                                    |
| `@lezer/highlight`               | 1.2.3                | `^1.2.3`                          | MIT                              | highlight                                                                                                    |
| `@lezer/html`                    | 1.3.13               | `^1.3.13`                         | MIT                              | highlight                                                                                                    |
| `@lezer/java`                    | 1.1.3                | `^1.1.3`                          | MIT                              | highlight                                                                                                    |
| `@lezer/javascript`              | 1.5.4                | `^1.5.4`                          | MIT                              | highlight                                                                                                    |
| `@lezer/json`                    | 1.0.3                | `^1.0.3`                          | MIT                              | highlight                                                                                                    |
| `@lezer/markdown`                | 1.7.2                | `^1.6.2`                          | MIT                              | highlight                                                                                                    |
| `@lezer/php`                     | 1.0.5                | `^1.0.5`                          | MIT                              | highlight                                                                                                    |
| `@lezer/python`                  | 1.1.19               | `^1.1.18`                         | MIT                              | highlight                                                                                                    |
| `@lezer/rust`                    | 1.0.2                | `^1.0.2`                          | MIT                              | highlight                                                                                                    |
| `@lezer/xml`                     | 1.0.6                | `^1.0.6`                          | MIT                              | highlight                                                                                                    |
| `@lezer/yaml`                    | 1.0.4                | `^1.0.4`                          | MIT                              | highlight                                                                                                    |
| `@modelcontextprotocol/sdk`      | 1.30.0               | `^1.20.1`                         | MIT                              | server                                                                                                       |
| `@parcel/watcher`                | 2.6.0                | `^2.6.0`                          | MIT                              | server                                                                                                       |
| `@playwright/test`               | 1.62.1               | `^1.62.1`                         | Apache-2.0                       | web                                                                                                          |
| `@replit/codemirror-lang-csharp` | 6.2.0                | `^6.2.0`                          | MIT                              | highlight                                                                                                    |
| `@tanstack/react-router`         | 1.170.32             | `^1.170.32`                       | MIT                              | web                                                                                                          |
| `@tanstack/react-virtual`        | 3.14.10              | `^3.14.10`                        | MIT                              | web                                                                                                          |
| `@testing-library/react`         | 16.3.3               | `^16.3.3`                         | MIT                              | web                                                                                                          |
| `@testing-library/user-event`    | 14.6.6               | `^14.6.6`                         | MIT                              | web                                                                                                          |
| `@types/express`                 | 4.17.25              | `^4.17.20`                        | MIT                              | server                                                                                                       |
| `@types/jest`                    | 29.5.14              | `^29.5.14`                        | MIT                              | expo-two-way-audio                                                                                           |
| `@types/jest-axe`                | 3.5.9                | `^3.5.9`                          | MIT                              | web                                                                                                          |
| `@types/mime-types`              | 3.0.1                | `^3.0.1`                          | MIT                              | cli                                                                                                          |
| `@types/node`                    | 26.4.0               | `^20.9.0`                         | MIT                              | client, protocol, relay, server                                                                              |
| `@types/qrcode`                  | 1.5.6                | `^1.5.6`                          | MIT                              | server                                                                                                       |
| `@types/react`                   | 19.2.18              | `^18.0.25`, `~19.2.0`, `^19.2.18` | MIT                              | android, expo-two-way-audio, web                                                                             |
| `@types/react-dom`               | 19.2.5               | `^19.2.5`                         | MIT                              | web                                                                                                          |
| `@types/uuid`                    | 9.0.8                | `^9.0.7`                          | MIT                              | server                                                                                                       |
| `@types/ws`                      | 8.18.1               | `^8.5.8`                          | MIT                              | cli, client, relay, server                                                                                   |
| `@typescript/native-preview`     | 7.0.0-dev.20260423.1 | `7.0.0-dev.20260423.1`            | Apache-2.0                       | root                                                                                                         |
| `@vitejs/plugin-react`           | 6.1.1                | `^6.1.1`                          | MIT                              | web                                                                                                          |
| `@vitest/ui`                     | 4.1.11               | `^4.1.6`                          | MIT                              | server                                                                                                       |
| `@xterm/addon-fit`               | 0.11.0               | `^0.11.0`                         | MIT                              | web                                                                                                          |
| `@xterm/headless`                | 6.0.0                | `^6.0.0`                          | MIT                              | server                                                                                                       |
| `@xterm/xterm`                   | 6.0.0                | `^6.0.0`                          | MIT                              | web                                                                                                          |
| `ai`                             | 5.0.78               | `5.0.78`                          | Apache-2.0                       | server                                                                                                       |
| `ajv`                            | 8.20.0               | `^8.20.0`                         | MIT                              | server                                                                                                       |
| `babel-preset-expo`              | 57.0.9               | `~54.0.12`                        | MIT                              | android                                                                                                      |
| `base64-js`                      | 1.5.1                | `^1.5.1`                          | MIT                              | relay                                                                                                        |
| `bcryptjs`                       | 3.0.3                | `^3.0.3`                          | BSD-3-Clause                     | server                                                                                                       |
| `chalk`                          | 5.6.2                | `^5.3.0`                          | MIT                              | cli                                                                                                          |
| `commander`                      | 12.1.0               | `^12.0.0`                         | MIT                              | cli                                                                                                          |
| `cross-env`                      | 10.1.0               | `^10.1.0`                         | MIT                              | server                                                                                                       |
| `dotenv`                         | 17.4.2               | `^17.2.3`                         | BSD-2-Clause                     | server                                                                                                       |
| `expo`                           | 57.0.18              | `*`, `^54.0.18`                   | MIT                              | android, expo-two-way-audio                                                                                  |
| `expo-constants`                 | 57.0.16              | `~18.0.9`                         | MIT                              | android                                                                                                      |
| `expo-font`                      | 57.0.2               | `~14.0.12`                        | MIT                              | android                                                                                                      |
| `expo-linking`                   | 8.0.12               | `~8.0.8`                          | MIT                              | android                                                                                                      |
| `expo-module-scripts`            | 5.0.8                | `^5.0.8`                          | MIT                              | expo-two-way-audio                                                                                           |
| `expo-modules-core`              | 2.5.0                | `^2.0.4`                          | MIT                              | expo-two-way-audio                                                                                           |
| `expo-router`                    | **not installed**    | `~6.0.13`                         | N/A — never installed (T116)     | android                                                                                                      |
| `expo-secure-store`              | 57.0.3               | `~57.0.2`                         | MIT                              | android                                                                                                      |
| `expo-status-bar`                | 3.0.9                | `~3.0.9`                          | MIT                              | android                                                                                                      |
| `express`                        | 4.22.2               | `^4.18.2`                         | MIT                              | server                                                                                                       |
| `fast-deep-equal`                | 3.1.3                | `^3.1.3`                          | MIT                              | server                                                                                                       |
| `jest-axe`                       | 9.0.0                | `^9.0.0`                          | MIT                              | web                                                                                                          |
| `jsdom`                          | 20.0.3               | `^30.0.1`                         | MIT                              | web                                                                                                          |
| `jsqr`                           | 1.4.0                | `^1.4.0`                          | Apache-2.0                       | web                                                                                                          |
| `knip`                           | 5.88.1               | `^5.82.1`                         | ISC                              | root                                                                                                         |
| `lezer-elixir`                   | 1.1.3                | `^1.1.2`                          | Apache-2.0                       | highlight                                                                                                    |
| `lru-cache`                      | 11.5.2               | `^11.5.1`                         | BlueOak-1.0.0                    | server                                                                                                       |
| `mime-types`                     | 2.1.35               | `^2.1.35`                         | MIT                              | cli                                                                                                          |
| `mnemonic-id`                    | 3.2.7                | `^3.2.7`                          | MIT                              | server                                                                                                       |
| `node-pty`                       | 1.2.0-beta.11        | `1.2.0-beta.11`                   | MIT                              | server                                                                                                       |
| `openai`                         | 6.49.0               | `^6.44.0`                         | Apache-2.0                       | server                                                                                                       |
| `oxfmt`                          | 0.46.0               | `0.46.0`                          | MIT                              | root                                                                                                         |
| `oxlint`                         | 1.61.0               | `1.61.0`                          | MIT                              | root                                                                                                         |
| `p-limit`                        | 7.3.2                | `^7.3.0`                          | MIT                              | server                                                                                                       |
| `p-throttle`                     | 8.1.0                | `^8.1.0`                          | MIT                              | server                                                                                                       |
| `pino`                           | 10.3.1               | `^10.2.0`                         | MIT                              | server, web                                                                                                  |
| `pino-pretty`                    | 13.1.3               | `^13.1.3`                         | MIT                              | server                                                                                                       |
| `qrcode`                         | 1.5.4                | `^1.5.4`                          | MIT                              | server                                                                                                       |
| `react`                          | 19.2.8               | `*`, `19.1.0`, `^19.2.8`          | MIT                              | android, expo-two-way-audio, web                                                                             |
| `react-dom`                      | 19.2.8               | `^19.2.8`                         | MIT                              | web                                                                                                          |
| `react-native`                   | 0.81.5               | `*`, `0.81.5`                     | MIT                              | android, expo-two-way-audio                                                                                  |
| `react-native-reanimated`        | 4.1.7                | `~4.1.1`                          | MIT                              | android                                                                                                      |
| `react-native-safe-area-context` | 5.6.2                | `~5.6.0`                          | MIT                              | android                                                                                                      |
| `react-native-screens`           | 4.16.0               | `~4.16.0`                         | MIT                              | android                                                                                                      |
| `rotating-file-stream`           | 3.2.10               | `^3.2.9`                          | MIT                              | server                                                                                                       |
| `sherpa-onnx-node`               | 1.12.28              | `1.12.28`                         | Apache-2.0                       | server                                                                                                       |
| `strip-ansi`                     | 7.2.0                | `^7.1.2`                          | MIT                              | server                                                                                                       |
| `tree-kill`                      | 1.2.2                | `^1.2.2`                          | MIT                              | cli, server                                                                                                  |
| `tsx`                            | 4.23.13              | `^4.6.0`                          | MIT                              | cli, server                                                                                                  |
| `tweetnacl`                      | 1.0.3                | `^1.0.3`                          | Unlicense                        | relay                                                                                                        |
| `typescript`                     | 5.9.3                | `^5.9.3`, `^5.2.2`, `^5.9.2`      | Apache-2.0                       | android, cli, client, design-tokens, frontend-core, highlight, pi-bridge, protocol, relay, root, server, web |
| `uuid`                           | 9.0.1                | `^9.0.1`                          | MIT                              | server                                                                                                       |
| `vite`                           | 8.2.2                | `^8.2.2`                          | MIT                              | web                                                                                                          |
| `vitest`                         | 4.1.11               | `^4.1.6`                          | MIT                              | android, cli, client, design-tokens, frontend-core, highlight, protocol, relay, root, server, web            |
| `which`                          | 5.0.0                | `^5.0.0`                          | ISC                              | server                                                                                                       |
| `ws`                             | 8.21.3               | `^8.14.2`                         | MIT                              | cli, client, relay, server                                                                                   |
| `yaml`                           | 2.9.0                | `^2.8.4`                          | ISC                              | cli                                                                                                          |
| `zod`                            | 4.5.4                | `^4.4.3`                          | MIT                              | cli, client, protocol, server                                                                                |
| `zod-aot`                        | 0.20.4               | `0.20.4`                          | MIT                              | protocol                                                                                                     |
| `zx`                             | 8.8.5                | `^8.8.5`                          | Apache-2.0                       | cli                                                                                                          |

**Recorded-or-not, before this audit:** 0 of 107 installed third-party
dependencies had a licence recorded anywhere in this document (this section
did not exist). **After this audit:** all 107 are recorded above; the one
declared-but-uninstalled package (`expo-router`) is called out by name
rather than given a licence, since it ships no code.

### 4.1 `@anthropic-ai/claude-agent-sdk` — proprietary, not open source

This is the one entry above that is not an open-source licence and needs a
correction, not just a citation. Its own `package.json` declares
`"license": "SEE LICENSE IN README.md"`, but `README.md` in the installed
package contains no licence text at all — the actual terms are in a
sibling `LICENSE.md`, which the `package.json` field does not name. That
file reads in full:

> © Anthropic PBC. All rights reserved. Use is subject to the Legal
> Agreements outlined here: https://code.claude.com/docs/en/legal-and-compliance.

This is a proprietary, all-rights-reserved licence (Anthropic's Claude
Code / Claude Agent SDK terms at the URL above), not a permissive or
copyleft open-source licence. It is used by `packages/server` as an
ordinary npm dependency (unmodified, not vendored, resolved normally through
`npm`'s registry install) to talk to the Pi/Claude coding-agent provider;
no source from it is copied into this repository. Distributing this
repository's own source under AGPL-3.0-or-later is unaffected by depending
on a proprietary SDK at the npm level (AGPL §5(c) governs code incorporated
into the covered work, not arm's-length runtime dependencies resolved via a
package manager) — but anyone building or redistributing this project
should be aware that using the `server` workspace's Pi provider means
accepting Anthropic's own terms at the URL above, separately from this
repository's AGPL-3.0-or-later licence.

### 4.2 Method and scope

- **Source of truth:** each package's own installed
  `node_modules/<name>/package.json` `license` field, per this task's brief
  — never `npm install`, never a registry API call, never inferred from a
  README.
- **Scope:** every `dependencies`, `devDependencies`, `peerDependencies`,
  and `optionalDependencies` entry in the root `package.json`, every
  `packages/*/package.json`, and every `apps/*/package.json`. Internal
  `@picompanion/*` workspace packages are excluded (they are this
  repository's own code, not third-party).
- **Not in scope:** transitive dependencies (the packages above's own
  `node_modules` subtrees). This section audits direct declarations only,
  matching the acceptance criterion ("every third-party dependency" was
  read, in context, as every package.json-declared dependency of this
  workspace — see the T43B1 task report for the transitive-audit gap this
  leaves, filed for whoever owns a future SBOM/license-scanning task).
- The vendored font packages in §3 (`@fontsource/inter`,
  `@expo-google-fonts/inter`, `@fontsource/geist-mono`, `geist`) are
  intentionally absent from the table above: they are not npm dependencies
  of any workspace here (no `package.json` declares them) — only their
  compiled font _files_ were vendored, one time, as static assets. §3
  already records their provenance correctly.

## 5. Supernova (`D:\supernova`) — MIT (T383)

**Supernova** is an independent third-party project (not Paseo), read as a
behavioural reference for the daemon's workspace checkpoint snapshots:

- Source: the local checkout `D:\supernova`, MIT, Copyright (c) 2026 Mattia
  Cerutti.
- Commit read: `5e6b861d152e41d4fd715abe1dba92421d45c753` (2026-09-11).
- What was taken: behaviour only, **reimplemented, not ported** — no file was
  copied. `packages/server/src/server/agent/checkpoints/` restates the snapshot
  manifest, shadow-repository, restore-plan and rollback semantics in plain
  Node; Supernova's own implementation is entangled with Effect RPC, Bun and an
  Electron shell this repository does not take.
- File-level record: `docs/T383-provenance.md` names every source file and the
  symbols that carried each behaviour.

MIT is compatible with this project's AGPL-3.0-or-later, so adaptation with
attribution is permitted. Because nothing was copied verbatim, no per-file
attribution header is required; the notice below is retained because this
section records the licence the work was read under.

```
MIT License

Copyright (c) 2026 Mattia Cerutti

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

**Not derived from Paseo.** Checked before adapting: none of the Supernova files
`docs/T383-provenance.md` names is itself derived from Paseo's `packages/app`
tree, so plan §5's exclusion boundary is untouched by this adaptation.
