# Android APK release record (T44B1)

This is the record `docs/issues-from-plan.md`'s T44B1 ("Produce the signed APK") asks
for: per criterion, what `.github/workflows/android-apk-release.yml` actually does,
what is enforced by a check versus what is a procedure, what is owner-blocked and
precisely what unblocks it, and how a reader re-derives every figure this document
states.

Measured against this tree at commit `8c8497ee3cae9e55376d8aa62a6873d2bee98c7f`
(`git rev-parse HEAD` — never the harness's own `gitStatus` snapshot, per this
repository's CLAUDE.md), immediately before this task's own commits. Every command
below is meant to be re-run by the reader, not trusted from this page.

**No signed APK was produced by this task, and none of this task's commits claim
otherwise.** T44B1's first acceptance criterion needs an `EXPO_TOKEN` repository
secret plus EAS-held Android signing credentials, both owner-supplied and both
absent (§4). This task never pushes, fetches, touches the remote, or dispatches a
workflow (CLAUDE.md), so it could not trigger a real EAS build even if the secret
existed. §2 and §3 record what this task DID close: criterion two ("signing material
is not present in the repository") had zero enforcement before this task and now
does; criterion three ("the build is reproducible from a clean checkout") had one
measured, real defect (a missing package build, matching the exact class of bug
`ci.yml`'s own `android-tests` job was built to prevent) which this task fixed, plus
one genuine, disclosed open question this task could not settle without running a
real EAS build (§3.3).

---

## 1. What the release workflow does, step by step

`.github/workflows/android-apk-release.yml`, job `publish-android-apk`, triggers on
`push:tags:[v*, android-v*]` and `workflow_dispatch`. Confirm the step count and
shape with `grep -nE '^      - (uses|run|name):' .github/workflows/android-apk-release.yml`
(11 steps at this commit — a bare `grep -c '      - '` overcounts at 13 because it
also matches the two `tags:` list entries under `on:`, which share the same
six-space indentation by coincidence) and by reading the file directly — it is
short enough to read in full.

1. Check out the pushed tag (`fetch-depth: 0`, `ref: $RELEASE_TAG`).
2. `npm ci` at the repository root.
3. **Build `@picompanion/protocol`, `@picompanion/design-tokens`,
   `@picompanion/highlight`, then `@picompanion/frontend-core`** (fixed by this task
   — see §3.1; it built only three of these four before).
4. `Check EAS credentials are configured` — sets `configured=true` when
   `secrets.EXPO_TOKEN` is non-empty, else `configured=false`. Every step after this
   one is `if: steps.eas-secrets.outputs.configured == 'true'`, except the final
   dry-run step, which is the mirror `== 'false'`. **This branch structure is
   unchanged by this task** — see §5 for the proof it still holds.
5. Ensure a GitHub release exists for the tag (idempotent: `gh release view` first,
   `gh release create` only if missing).
6. `expo/expo-github-action@v8` logs the runner in to EAS using `EXPO_TOKEN`.
7. `npx eas build --platform android --profile production-apk --non-interactive --wait --json`
   from `apps/android`, capturing the build id.
8. `npx eas build:view <id> --json`, extract `artifacts.buildUrl` /
   `artifacts.applicationArchiveUrl`, `curl` the APK to `$RUNNER_TEMP`.
9. `gh release upload <tag> <apk> --clobber`.

Every one of steps 5–9 is real, unconditional CI machinery today — it is not itself
gated on anything this task added — it is simply never REACHED, in any run to date,
because step 4 has always resolved `configured=false` (no `EXPO_TOKEN` secret has
ever existed on this repository — confirmed by T208's own record in `docs/issues-
from-plan.md`, still unchecked at this commit: `grep -n '#### T208' docs/issues-
from-plan.md` to find its current line, since line numbers in that file shift as
other tasks are added).

---

## 2. Criterion two — "signing material is not present in the repository"

### 2.1 The gap, as measured before this task

- `scripts/ci/run-guard-secret-scan.mjs`'s `BINARY_EXTENSIONS` set (T44A3) already
  contained `".keystore"`, `".jks"`, `".apk"`, `".aab"` — files with those
  extensions were skipped before any content read, by design (that guard exists to
  scan TEXT for vendor-prefixed token shapes; see its own module header). Confirm:
  `grep -n '"\.keystore"\|"\.jks"\|"\.apk"\|"\.aab"' scripts/ci/run-guard-secret-scan.mjs`.
- `.gitignore` had no entry naming any signing-material extension or filename.
  Confirm against the pre-task tree: `git show 8c8497e:.gitignore | grep -i
'jks\|keystore\|p12\|pfx\|pepk\|mobileprovision\|google-services\|credentials'`
  returns nothing.
- So a committed keystore under any of those four extensions would have been
  tracked, un-ignored, and explicitly excluded from the one guard whose job is
  finding committed secrets. `git ls-files | grep -iE
"\.(keystore|jks|p12|pfx|pepk|apk|aab|mobileprovision)$|google-services\.json$|credentials\.json$"`
  found nothing tracked at this commit — there is no live leak — but nothing would
  have caught one.

### 2.2 What this task added

- **`.gitignore`** now ignores `*.keystore`, `*.jks`, `*.p12`, `*.pfx`, `*.pepk`,
  `*.mobileprovision`, `google-services.json`, `credentials.json`, `*.apk`, `*.aab`.
  This prevents an ACCIDENTAL `git add` from succeeding; it does nothing for a file
  already tracked (ignoring a path does not untrack it), which is exactly why §2.2's
  second half is a separate, independent control.
- **`scripts/ci/guard-signing-material.mjs`** (pure check functions) +
  **`scripts/ci/run-guard-signing-material.mjs`** (CLI entry point, scans
  `git ls-files`) + **`scripts/ci/guard-signing-material.test.mjs`** (21 `node --test`
  cases). It fails when a TRACKED file's name matches a signing extension
  (`.keystore`, `.jks`, `.p12`, `.pfx`, `.pepk`, `.apk`, `.aab`,
  `.mobileprovision`) or a reserved basename (`google-services.json`,
  `credentials.json`) regardless of content or directory, and independently when
  ANY tracked file's content contains a PEM private-key header (reusing
  `guard-secret-scan.mjs`'s own `private-key-block` pattern) — so a keystore
  renamed to hide its extension, or a raw key pasted into an unrelated file, is
  still caught by content. See that module's own header for the full reasoning,
  including why this is a new, dedicated guard rather than a change to
  `guard-secret-scan.mjs`'s skip list (a binary keystore is not valid UTF-8, so
  unblocking its extension there would not have helped — its own `catch { continue;
}` on a decode failure would have silently skipped it anyway).
- **`.github/workflows/ci.yml`**'s new `guard-signing-material` job, unconditional
  (same placement discipline as `guard-secret-scan`, right beside it), invoking
  `node scripts/ci/run-guard-signing-material.mjs`.

### 2.3 Proof this actually fires — not fixture-level only

Run these from the repository root (they are also exactly what a future contributor
can re-run to convince themselves the guard is real):

```bash
# 1. A real tracked keystore-shaped file:
echo "scratch" > apps/android/release.keystore
git add apps/android/release.keystore
node scripts/ci/run-guard-signing-material.mjs   # exits 1, names the file
git restore --staged apps/android/release.keystore
rm apps/android/release.keystore

# 2. A real tracked file carrying a PEM private-key header under an unrelated name:
node -e "require('fs').writeFileSync('docs/scratch-pem-fixture.md', '-----BEGIN RSA PRIVATE KEY-----\n...')"
git add docs/scratch-pem-fixture.md
node scripts/ci/run-guard-signing-material.mjs   # exits 1, names the file and line
git restore --staged docs/scratch-pem-fixture.md
rm docs/scratch-pem-fixture.md

# 3. Confirm the tree is clean again:
node scripts/ci/run-guard-clean-working-tree.mjs   # exits 0
```

This task ran exactly this sequence (both directions) against the real tree before
writing this record: both fixtures produced exit 1 naming the correct file (and, for
the PEM case, the correct line); both cleanups produced exit 0 on
`run-guard-signing-material.mjs` and on `run-guard-clean-working-tree.mjs`
afterward. `git status --porcelain` was empty of anything but this task's own new,
not-yet-committed files at that point — never a leftover fixture.

`node scripts/ci/run-guard-run-guard-wiring.mjs` was also re-run after adding the
`guard-signing-material` job to `ci.yml` and reported OK — the new job is genuinely
invoked by a real `run:` step, not merely mentioned in a comment (see that guard's
own header for why the distinction matters).

---

## 3. Criterion three — "the build is reproducible from a clean checkout"

### 3.1 Fixed: the release workflow was missing a package build `android-tests` needs

`apps/android` resolves `@picompanion/protocol`, `@picompanion/design-tokens`,
`@picompanion/highlight`, and `@picompanion/frontend-core` through their BUILT
`dist/` output (each package's `exports` map points there), never through source.
`.github/workflows/ci.yml`'s `android-tests` job already builds all four, with a
comment recording exactly why `@picompanion/highlight` is one of them: T35A2's
`apps/android/src/features/files/file-syntax-highlight.ts` is the first Android
importer of `@picompanion/highlight`, and omitting its build fails a clean checkout
with `TS2307: Cannot find module '@picompanion/highlight'` — a failure that a
developer's own machine hides because it already carries a stale
`packages/highlight/dist` from unrelated local work (exactly `CLAUDE.md`'s "a stale
`dist` is the standing reason a local build can disagree with CI" warning,
previously proven live at T156).

`android-apk-release.yml`'s own equivalent step built only three of the four
(protocol, design-tokens, frontend-core) and its comment claimed parity with
`android-tests` — false the day it was measured: `android-tests` already built
four. This task added the missing `@picompanion/highlight` build line and corrected
the comment (see the workflow file's own `CORRECTED (T44B1)` note).

**Whether this specific gap could have broken a real EAS run is, honestly, an open
question** (§3.3) — nothing in the release workflow today runs `npm run typecheck
--workspace=@picompanion/android` or `npm run test --workspace=@picompanion/android`
locally on the GitHub Actions runner (unlike `android-tests`), so this local build
step's output is consumed by nothing ON THE RUNNER today. It matters for two
reasons regardless: the comment's parity claim was simply false and false comments
are their own defect (CLAUDE.md, "A doc comment ... that states a false premise is a
defect"), and if `eas build`'s remote archiving DOES pick up locally-built `dist/`
output (§3.3 could not settle this), a missing package here would silently produce
a broken remote build the exact first time criterion one is ever attempted — the
worst possible moment to discover it.

The "already fixed once, for a sibling job" history is recorded in `ci.yml`'s own
comment directly above the `android-tests` job's build step, which names the
P5-W10 merge gate as the commit that added the `highlight` line there — **that
attribution is quoted from the comment's own text, not independently reproduced
from `git log`**: this repository's history was destroyed and rebuilt from session
transcripts after the P6-W24 incident (`CLAUDE.md`, "The repository was deleted by
an unset variable"), so `git log --oneline -S'file-syntax-highlight' --
.github/workflows/ci.yml` today returns only the single post-recovery "Recovered
baseline" commit, not the original P5-W10 commit — expected, per that section's own
note that "SHAs older than [the recovery] no longer exist", not a sign the
attribution is wrong.

### 3.2 Version: one source, not two (checked, not assumed)

`apps/android/eas.json`'s `"appVersionSource": "local"` means EAS reads the app
version from `apps/android/app.config.ts`'s own `version: "0.1.0"` field (and the
implicit `android.versionCode`, which is not set anywhere in `app.config.ts` —
confirmed by `grep -n "versionCode" apps/android/app.config.ts`, no match — so Expo
defaults it to `1`) rather than computing it from anything remote. Neither
`eas.json` nor `app.config.ts` reads the release workflow's `$RELEASE_TAG` (the git
tag that triggered the run) at all — `grep -n "RELEASE_TAG\|GITHUB_REF\|process.env"
apps/android/app.config.ts` finds none of those.

This makes the BUILD deterministic (the same tag always produces the same declared
app version — good for reproducibility, the letter of this criterion) but means the
git tag and the app's own declared version are two independent, disconnected
identifiers: tagging `v0.2.0` and `v0.3.0` both produce an APK internally declared
`0.1.0` / `versionCode 1`. Practically, since neither `eas.json` nor
`"autoIncrement"` is set on the `production-apk` profile, `versionCode` never
increases release over release — this does not break criterion three (a clean
checkout still reproduces the same output for the same tag) but it does mean
Android's package manager cannot distinguish two different tagged releases from
each other, and will refuse to install one over the other as an update
(`INSTALL_FAILED_VERSION_DOWNGRADE`) once a device already has a copy installed.
This is the same "two sources of truth for a version" shape CLAUDE.md's T230 note
names elsewhere. **Filed as a gap, not fixed**: `apps/android/app.config.ts` is not
in this task's Owns line (only `.github/workflows/android-apk-release.yml`,
`.gitignore`, `apps/android/eas.json`, a new `scripts/ci` guard, and this doc are).
The concrete fix, for whoever owns `app.config.ts` next (T44B2 or a new task): bump
`version`/set an explicit `android.versionCode` per release, or set
`"autoIncrement": true` on the `production-apk` profile (EAS then increments
`versionCode` itself on every build using that profile) — the second is the
smaller, more mechanical change and does not require deriving anything from the git
tag at all.

### 3.3 Disclosed, unverifiable-here: does the EAS remote archive include locally-built `dist/`?

This is the single largest open question for criterion three, and this task could
not settle it without running a real `eas build` (owner-blocked, §4).

- `dist/` is `.gitignore`d repository-wide (`.gitignore` line 2), so
  `packages/protocol/dist`, `packages/design-tokens/dist`,
  `packages/highlight/dist`, and `packages/frontend-core/dist` — everything §3.1's
  build step produces on the GitHub Actions runner — are all untracked by git.
- No `apps/android/.easignore` exists (`find . -iname .easignore` at this commit:
  no output). EAS CLI's documented default, absent an `.easignore`, is to determine
  what to upload for a remote build from the project's VCS state — in practice,
  version-controlled (tracked) content, with interactive/CI handling of uncommitted
  changes that has changed across `eas-cli` versions and is not something this task
  can pin down by reading source alone.
- **If** `eas build`'s upload is git-tracked-content-only, then the three (now four)
  package builds this workflow performs locally, before ever calling `eas build`,
  never reach the remote builder at all — they would be dead weight for THIS job,
  their only real effect being to keep this file's own claims about matching
  `android-tests`' build set truthful, and (if the EAS remote build config, via
  Expo's managed CNG, needs an `npm install`-then-build step of its own for these
  workspace packages) the actual dependency-resolution burden would fall entirely
  on the remote builder, which this task did not verify has any equivalent build
  step configured for it at all — `apps/android/package.json` has no
  `eas-build-pre-install` / `eas-build-post-install` lifecycle script (`grep -n
"eas-build-" apps/android/package.json` at this commit: no match), which is the
  standard EAS mechanism for exactly this monorepo shape.
- **If**, instead, `eas build` uploads the actual on-disk working directory
  (including untracked-but-present `dist/` output at upload time), then §3.1's
  build order is load-bearing for real and this task's fix in §3.1 was necessary,
  not merely cosmetic.

**Neither branch was assumed; both are stated because this task could not
distinguish them without a real `EXPO_TOKEN` and a real build.** The executable
check that WOULD settle it, for whoever runs the first real build (§4):

```bash
cd apps/android
npx eas build:inspect --platform android --profile production-apk --stage archive \
  --output /tmp/eas-archive-inspect --non-interactive
ls -la /tmp/eas-archive-inspect/packages/protocol \
       /tmp/eas-archive-inspect/packages/design-tokens \
       /tmp/eas-archive-inspect/packages/highlight \
       /tmp/eas-archive-inspect/packages/frontend-core
```

`eas build:inspect -s archive` extracts, locally, exactly the project snapshot EAS
would upload for a real build, without starting one. If each package's `dist/`
directory is present in that extracted snapshot, §3.1's local build step (run
immediately before `eas build:inspect`, so its output is on disk when the archive is
made) is real and load-bearing. If `dist/` is absent from the extracted snapshot,
the release workflow needs an `eas-build-post-install` hook in
`apps/android/package.json` (out of this task's Owns line — file as a new task) that
runs the four workspace builds ON the remote builder, after its own `npm install`,
before the native/bundle step — the standard fix for this exact monorepo shape,
and the one `android-tests`' local build order does not need because `android-tests`
runs its own typecheck/test/prebuild-smoke steps locally, on the same runner that
just built the dist output, with no remote-archive boundary in between.

### 3.4 `apps/android`'s inputs that live outside the repository

`expo prebuild` (invoked by EAS's managed CNG when no committed `apps/android/android/`
exists — confirmed gitignored, `.gitignore` line 19) needs, beyond the checked-out
tree and `npm ci`'s resolved `node_modules`: nothing else that this task could find.
`app.config.ts` reads no environment variable except `APP_VARIANT` (used only to
switch the dev/prod package id and app name — confirmed by
`grep -n "process.env" apps/android/app.config.ts`, one hit), and the release
workflow sets no `env:` on the `production-apk` build call, so `APP_VARIANT` is
unset during a release build and `isDevelopmentClient` evaluates `false` — the only
thing making `sh.picompanion` (not `sh.picompanion.debug`) the package name that
ships, confirmed by reading `app.config.ts:75` and the workflow's own EAS build
step (no `env:` block).

---

## 4. Owner-blocked: exactly what unblocks criterion one

Nothing below can be done by an agent session (CLAUDE.md: no remote access, no
`npm install`/`eas`/`expo`/`gradle`, never push/fetch/dispatch). This is the
executable checklist for whoever (the repository owner) can:

1. **Verify or create the EAS project.** `docs/frontend-data-migration.md` §4.2
   records the reference project id (`0e7f65ce-0367-46c8-a238-2b65963d235a`, owner
   `getpaseo`) as UNVERIFIED for this new repository. Run `npx expo whoami` (from
   `apps/android`, logged in as the intended Expo account) and either confirm
   access to that org, or create a fresh EAS project
   (`npx eas init` from `apps/android`) and record the new project id somewhere
   durable (that reference doc is itself reference-only per this repository's
   CLAUDE.md — record the real decision in a new, authoritative note, not by
   editing that file).
2. **Generate or link an Android signing keystore in EAS Credentials** — never
   locally, never committed. `npx eas credentials --platform android` from
   `apps/android`, using the `production-apk` profile, either links an existing
   project keystore or offers to generate one. Expected output: a keystore entry
   listed under the verified project, with EAS holding the private key — nothing
   downloaded to this machine.
3. **Add the `EXPO_TOKEN` repository secret.** GitHub repository Settings → Secrets
   and variables → Actions → New repository secret, name `EXPO_TOKEN`, value from
   `npx expo login` + a generated access token
   (https://expo.dev/accounts/[account]/settings/access-tokens) for the account
   that owns the verified project from step 1.
4. **Dispatch a real run** — `workflow_dispatch` on `android-apk-release.yml` with
   an existing tag input, or push a new `vX.Y.Z`/`android-vX.Y.Z` tag. Expected
   output on success: `Check EAS credentials are configured` sets `configured=true`
   (visible in the run's log for that step); the EAS build step logs a real build
   id and a queue/build wall-clock time (T208's own record estimates 15–30 minutes
   for `production-apk`); the run ends with a GitHub Release for that tag carrying
   one asset, `picompanion-<tag>-android.apk`.
5. **Read the real run, per this repository's standing rule** (CLAUDE.md): `gh run
list --branch main --limit 3` / the tag's own workflow run, `gh run view <id>`,
   and record the run id and conclusion — in this file, or in T208's own record —
   rather than trusting a description of what "should" happen.

Steps 1–3 are `docs/frontend-data-migration.md` §4.6's own unchecked checklist,
carried forward here in executable form; that document is reference-only per this
repository's CLAUDE.md (it describes Paseo's old migration audit) and is not edited
by this task, but its checklist items are still the right ones to execute — this
section restates them as commands rather than editing that file.

---

## 5. The `distribution` decision — `"internal"`, not `"store"`

`apps/android/eas.json`'s `production-apk` profile declared
`"distribution": "store"` before this task. This task changed it to
`"distribution": "internal"`. This was decided on the plan's own explicit words,
not on the task summary's looser wording, and is recorded here so the next reader
does not need to re-derive it:

- `plan.md` — the sole authoritative spec for this repository (`CLAUDE.md`) — §13,
  Phase 9, item 3, says in as many words: **"Produce a signed internal APK."**
  (`grep -n "signed internal APK" plan.md`). This is not a loose paraphrase this
  task is reinterpreting; it is the literal, already-authoritative text.
- Semantically, in EAS, `distribution` selects the signing-credentials/delivery
  path a build is prepared for: `"store"` is Play Store submission shape,
  `"internal"` is ad-hoc/internal distribution — an install link Expo hosts,
  installable directly, no Play Console involvement. This release pipeline does
  neither `eas submit` nor anything Play-Store-shaped anywhere in
  `android-apk-release.yml` — every artifact this workflow produces is downloaded
  from EAS and re-uploaded as a plain GitHub Release asset (§1, steps 7–9). That is
  exactly the shape `"internal"` names and `"store"` does not.
- `docs/frontend-data-migration.md` §4.3 (reference-only, but corroborating as a
  fact about what was PREVIOUSLY intended, not as spec) already states "Play
  Store / internal distribution secrets: **None yet — internal distribution only
  (`distribution: "internal"`) per `eas.json`**" — meaning even the migration audit
  assumed `"internal"` was what `apps/android/eas.json` would declare. `"store"`
  was very likely an unintentional drift from that intent, introduced sometime
  during the T16/T17 scaffold, not a considered choice this task is overriding.
- `docs/issues-from-plan.md` T44B1's own one-line summary — "Produce a signed
  **internal** `sh.picompanion` APK from the release workflow" — agrees with
  `plan.md`, not with the profile's pre-task value.

**Nothing else changes as a result of this fix.** `"buildType": "apk"` is unchanged
on the profile (both distributions accept the override); no `eas submit` step
exists to gate on `distribution` either way; the artifact URL resolution in §1 step
8 reads `artifacts.buildUrl` / `artifacts.applicationArchiveUrl`, both populated for
either distribution value. The only practical effect is which EAS-side credentials
database entry and install-page behavior the build uses — internal distribution
also gives Expo's dashboard an install-link/QR page for the build, which store
distribution does not, a genuine (if minor) benefit for a project with no Play
Store submission path today.

---

## 6. Baselines this task confirmed itself

- `node --test scripts/ci/*.test.mjs` — all pass (615 tests including this task's
  new 21, at the commit this task produced).
- `./node_modules/.bin/oxfmt --check .` — clean (this task's own new test file
  needed one `oxfmt` pass before this was true; re-run and confirmed clean
  afterward).
- `node scripts/ci/run-guard-run-guard-wiring.mjs` — OK, the new
  `guard-signing-material` job is genuinely wired.
- `node scripts/ci/run-guard-clean-working-tree.mjs` — confirmed exit 0 after every
  fixture-cleanup step in §2.3, and again before this task's final commit.
- `npm run typecheck --workspaces --if-present` — this task touched no
  `packages/*/src` or `apps/*/src` file, only workflow YAML, `.gitignore`,
  `apps/android/eas.json` (data, not code), and new `scripts/ci/*.mjs` files with
  no import from any workspace's `src`. Run to completion, exit code `2`: the ONLY
  workspace that failed was `@picompanion/android`, with exactly the 18 `TS2307:
Cannot find module 'expo-router'` errors this repository's own T200 correction
  documents as a standing, local-workstation-only fact (`expo-router` is declared
  in `apps/android/package.json` but genuinely absent from
  `apps/android/node_modules` on this machine; `ls apps/android/node_modules | grep
'^expo-router$'` confirms — a clean CI `npm ci` checkout does not have this
  problem). Every other workspace, including `@picompanion/web` (which chains
  through `design-tokens`, `frontend-core`, `highlight`, `protocol`, `client`,
  `relay`), typechecked clean. This is pre-existing and outside this task's
  Owns line either way — nothing this task touched can affect module resolution
  under `apps/android/src`.
