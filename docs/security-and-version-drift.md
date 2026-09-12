# Security and version-drift findings register (T44A3)

This is the findings register T44A3 (`plan.md` §13 phase 9, "Complete
performance, accessibility, security, and version-drift checks") produces.
It records every real result measured on this tree, at commit
`50f66d0a342c3fbffe1ead6b1988260d6d68e3f6` (via `git rev-parse HEAD` — never
the harness's own stale `gitStatus` snapshot, per this repository's own
CLAUDE.md), across the task's three halves: version drift, dependency
scanning, and secret scanning. Every number below was measured in the
foreground, once, on this tree — none is a copied or expected figure.

Before this task, `.github/` contained exactly `ci-paths.yml` and
`workflows/`; `grep -rn "audit\|gitleaks\|trufflehog\|codeql" .github/workflows/`
found nothing but `EXPO_TOKEN` handling in `android-apk-release.yml`. No
dependency audit, secret scan, CodeQL, or Dependabot config existed anywhere.
All three halves below are greenfield.

---

## 1. Version drift

Three independent, machine-checkable axes are gated by
`scripts/ci/guard-version-drift.mjs` (wired as the `guard-version-drift` job
in `.github/workflows/ci.yml`, unconditional — it runs on every push, PR,
and merge-queue run, not gated on a path filter). Each was proven able to
fail, on the real committed file, by direct mutation (mutated, observed
`run-guard-version-drift.mjs` and the module's own real-tree `node --test`
assertion both fail, restored the file byte-identically from a scratchpad
backup copy — never `git checkout --` — and confirmed
`node scripts/ci/run-guard-clean-working-tree.mjs` exits 0 afterward):

| Axis                                                                                                 | Where                                                                                                                                                                                                    | Real result today      | Mutation proof                                                                                                                                                                                                |
| ---------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Every `@picompanion/*` dependency/devDependency pin equals its target's own `package.json` `version` | Every `packages/*/package.json` and `apps/*/package.json` (12 manifests)                                                                                                                                 | Clean — 0 drifted pins | Changed `apps/web/package.json`'s `@picompanion/protocol` pin from `0.3.0-beta.2` to `0.3.0-beta.99` → `run-guard-version-drift.mjs` exited 1, naming the exact manifest, package, pinned and actual versions |
| Daemon/client WS hello-handshake protocol version literal                                            | `packages/server/src/server/websocket-server.ts`'s `WS_PROTOCOL_VERSION = 1` vs. `packages/client/src/daemon-client.ts`'s `sendHelloMessage`'s hand-written `protocolVersion: 1` literal                 | Clean — both are `1`   | Changed the client's literal to `2` → guard exited 1: `daemon WS_PROTOCOL_VERSION=1 but client sendHelloMessage's protocolVersion=2`                                                                          |
| Protocol/relay relay-wire-version literal                                                            | `packages/protocol/src/daemon-endpoints.ts`'s exported `CURRENT_RELAY_PROTOCOL_VERSION = "2"` vs. `packages/relay/src/cloudflare-adapter.ts`'s own, independently-declared `CURRENT_RELAY_VERSION = "2"` | Clean — both are `"2"` | Changed the relay's literal to `"3"` → guard exited 1: `protocol's CURRENT_RELAY_PROTOCOL_VERSION="2" but relay's own CURRENT_RELAY_VERSION="3"`                                                              |

**Why the second and third axes exist at all, not just the first.** The
task's own brief pointed at `packages/protocol/src/daemon-endpoints.ts`'s exported
`CURRENT_RELAY_PROTOCOL_VERSION` and asked "find who else names a version
and whether anything checks they agree." Two answers were found by reading
the tree, not assumed:

- `packages/frontend-core/src/hosts/connection-url.ts` correctly **imports**
  `CURRENT_RELAY_PROTOCOL_VERSION` from `@picompanion/protocol/daemon-endpoints`
  — this is the single-source-of-truth pattern working as intended, and
  needs no guard.
- `packages/relay/src/cloudflare-adapter.ts` does **not** import it. It
  re-declares its own local `CURRENT_RELAY_VERSION = "2"`. `packages/relay`
  declares no `@picompanion/protocol` dependency at all — it deploys to
  Cloudflare Workers, a separate runtime from every other workspace, so
  simply adding the import is a packaging question outside this task's
  scope (see §1.1 below for the gap this leaves).
- Separately, the daemon (`packages/server/src/server/websocket-server.ts`)
  and the client (`packages/client/src/daemon-client.ts`) each hard-code the
  hello-handshake `protocolVersion` as a bare numeric literal.
  `packages/protocol/src/messages.ts`'s `WSHelloMessageSchema` only types
  this field as `z.number().int()` — it declares no constant either side
  could import to guarantee agreement. This is the more acute of the two
  drift risks: a daemon upgrade that bumps `WS_PROTOCOL_VERSION` without a
  matching client change now fails LOUD (the daemon already closes the
  socket with `WS_CLOSE_INCOMPATIBLE_PROTOCOL`), but a silent drift the
  other direction — client sends a version the (older) daemon still
  accepts, but the two sides now disagree about what that version number
  is documented to mean — was previously undetectable until it caused a
  real support incident.

### 1.1 Version-drift axes NOT gated, and why

- **Neither `packages/protocol` nor `packages/relay`'s relay-version literal
  is imported from a single source today** — the guard above only proves
  the two literals currently AGREE, not that they are structurally
  incapable of disagreeing. The real fix (giving `packages/relay` a way to
  import `@picompanion/protocol`'s constant despite targeting Cloudflare
  Workers — e.g. a build step that inlines the value, or a hand-copied
  constant with a comment cross-referencing the guard) is a packaging
  change to `packages/relay`'s own build, which this task's `Owns:` line
  (`.github/workflows/*.yml`, a new `scripts/ci` guard, a new `docs/` file)
  does not cover. **Filed as a gap for whoever next touches
  `packages/relay`'s build config or `packages/protocol`'s public surface.**
- **The Expo/React Native SDK version pinned in `apps/android/package.json`**
  (`expo: "^54.0.18"` and its satellite `expo-*`/`@react-navigation/*`
  packages) is not cross-checked against anything — there is no second
  "daemon-side" declaration of that version to drift against; it is a
  single pin whose only "drift" risk is going stale, which §2 below covers
  (as a dependency-audit finding, not a version-drift one). (CORRECTED at
  T326: this said the pin is not cross-checked against anything, and that
  there is no second declaration to drift against. There is one — the
  `expo` package's own `bundledNativeModules.json`, the map from every
  satellite package to the version its SDK ships — and
  `scripts/ci/guard-expo-sdk-alignment.mjs` now checks every installed
  package `apps/android` can see against it, from `package-lock.json`.
  Three Maestro dispatches had each found one satellite from the wrong
  SDK the slow way before that guard existed. The pin itself is still
  only ever stale, never drifted; the satellites around it are what
  drift, and are what the guard reads.)
- **The daemon's own self-reported `daemonVersion`**
  (`packages/server/src/server/daemon-version.ts`'s `resolveDaemonVersion()`)
  reads `packages/server/package.json`'s `version` LIVE, at runtime, via
  `resolvePackageVersion()` — it is not a separately-maintained literal, so
  it cannot drift from its own source by construction. Verified by reading
  `daemon-version.ts`; not gated because there is nothing to gate.
- **Third-party (non-`@picompanion/*`) dependency version ranges** are a
  dependency-audit concern (§2), not a version-drift one, and are not
  duplicated here.

### 1.2 T230 addendum: the Workers-boundary question, answered

T230 (`wave: P9-W12`) was filed by this section's first bullet above to
answer, with evidence rather than assumption, whether
`packages/relay/src/cloudflare-adapter.ts` can take a `@picompanion/protocol`
import at the Cloudflare Workers boundary. Measured at
`bc6c303e7c51274879d4444631e0bc13ea64e7e9` (`git rev-parse HEAD`):

- **The Workers runtime is not the blocker.** `@picompanion/protocol`'s
  `daemon-endpoints.ts` — the module that exports
  `CURRENT_RELAY_PROTOCOL_VERSION` — has zero `import` statements, in
  either the source or its compiled `dist/daemon-endpoints.js`. It uses only
  `URL`, string methods, and `RegExp`, all present in the Workers runtime.
  `packages/protocol/package.json`'s `exports` map resolves the subpath
  `@picompanion/protocol/daemon-endpoints` unambiguously to
  `dist/daemon-endpoints.js` via its `"./*"` wildcard entry (only a
  `types`/`default` pair — no `node`/`browser` condition branch to diverge
  on). `packages/relay/wrangler.toml` sets `main = "src/cloudflare-adapter.ts"`,
  so `wrangler`'s own bundler (esbuild) would resolve that specifier by
  ordinary Node module resolution and, because the target module has no
  imports of its own, pull in nothing beyond that one small file — no
  `zod` (protocol's only runtime dependency lives entirely outside this
  module), no Node builtins, nothing incompatible with Workers.
- **The real blocker is dependency-declaration mechanics, not the runtime.**
  `packages/relay/package.json` does not list `@picompanion/protocol` under
  `dependencies`. Because this is an npm workspace, the import would
  actually _resolve_ today without any edit — every `packages/*` and
  `apps/*` member is symlinked into the root `node_modules/@picompanion/*`
  unconditionally (confirmed: `node_modules/@picompanion/protocol` already
  points at `packages/protocol` on this tree) — but doing that on purpose
  is the exact undeclared-workspace-dependency shape
  `scripts/ci/guard-declared-workspace-deps.mjs` (T60B) exists to catch for
  `apps/android` and `apps/web`. **CORRECTED (T251):** this paragraph
  previously said that guard "does not scan `packages/relay`" and that "an
  undeclared import here would not be caught" — both true when written,
  both false now. T251 widened the guard's walk to every `packages/*/src`
  (`packages/relay` included), each checked against its OWN
  `package.json` `dependencies`, never the root's — measured directly: an
  undeclared `packages/relay` -> `@picompanion/protocol` import added to a
  scratch copy of `cloudflare-adapter.ts` made
  `run-guard-declared-workspace-deps.mjs` exit 1 naming `packages/relay` and
  the missing package, and restoring the file returned it to exit 0. This still does
  not make it safe to ship the import deliberately without declaring it —
  the dependency-declaration/lockfile mechanics below remain the real
  blocker, `packages/relay` still being deployed completely outside the
  rest of this monorepo's own build tooling (`wrangler deploy`, not
  `npm run build`).
  Declaring the dependency correctly requires adding
  `"@picompanion/protocol": "0.3.0-beta.2"` to
  `packages/relay/package.json`'s `dependencies` — and `package-lock.json`
  carries its own mirrored copy of every workspace member's `dependencies`
  block (confirmed at its `"packages/relay"` entry), which `npm ci`
  validates against `package.json` exactly. Adding the line without
  regenerating that lockfile entry would desync the two and break `npm ci`
  in CI; regenerating it requires running `npm install`, which — like the
  `npm audit` half of this same document — this environment's permission
  classifier refuses, per this task's own hard rules ("npm install ... any
  package.json-dependency or package-lock.json edit is REFUSED ... Do not
  attempt it").
- **Decision: KEEP the guard.** The structural fix (relay imports
  protocol's real constant) is correct in principle and blocked in this
  environment by the dependency-declaration/lockfile mechanics above, not
  by anything about Cloudflare Workers. `findRelayProtocolVersionDrift`
  (§1's table, third row) was re-proven on this tree: mutating
  `cloudflare-adapter.ts`'s `CURRENT_RELAY_VERSION` literal to `"3"` made
  `run-guard-version-drift.mjs` exit 1 naming the exact mismatch, and
  restoring it byte-identically returned it to exit 0 with
  `run-guard-clean-working-tree.mjs` also exit 0 (this document's own §1
  historical mutation predates this re-proof and stays as originally
  measured).
  **When the owner unblocks `npm install`:** run, from the repository root,
  `npm install @picompanion/protocol@0.3.0-beta.2 --workspace=@picompanion/relay --save-exact`
  (or hand-add the `dependencies` line and run a plain `npm install` to
  regenerate the lockfile entry), change `cloudflare-adapter.ts` to
  `import { CURRENT_RELAY_PROTOCOL_VERSION as CURRENT_RELAY_VERSION } from "@picompanion/protocol/daemon-endpoints";`
  in place of the local literal, rebuild `packages/relay`
  (`npm run build --workspace=@picompanion/relay`), and confirm a real
  Cloudflare Workers deploy still bundles cleanly before treating
  `findRelayProtocolVersionDrift`'s relay-side check as redundant and
  removing it — the compile error only replaces the guard once the import
  is real, not once it merely typechecks locally.

---

## 2. Dependency scan (`npm audit`)

`npm audit --json` was run in the foreground, once, against this tree's
real, already-installed `node_modules` (884 top-level entries; no `npm
install`/`npm ci` was run to produce this — both are refused by this
environment's permission classifier, per this task's hard rules, and were
never attempted).

### 2.1 Real result

```
"vulnerabilities": {
  "info": 0, "low": 3, "moderate": 23, "high": 10, "critical": 0, "total": 36
},
"dependencies": {
  "prod": 1051, "dev": 621, "optional": 156, "peer": 337, "peerOptional": 0, "total": 1951
}
```

**36 real advisories, 0 critical, 10 high, 23 moderate, 3 low.** Every one of
the 36 top-level packages `npm audit --json` names is recorded, with its
severity and affected range, in `scripts/ci/guard-audit-baseline.mjs`'s
`AUDIT_BASELINE` — this is the full list; **nothing was dropped, and none
were merged or summarized away.**

(UPDATED at T326 — the figures above are the T44A3 measurement; the live
baseline is now **35: 0 critical, 10 high, 22 moderate, 3 low**. T307/T326
removed the SDK-57 Expo tree that npm had hoisted to the repository root,
and with it two advisories that existed only because of that tree —
`@expo/inline-modules` and `@expo/local-build-cache-provider`, neither of
which `expo@54` depends on. The `expo` advisory itself is unchanged, but its
reported range narrowed from `40.0.0-alpha.0 - 40.0.0-beta.5 || >=41.0.0-alpha.0`
to `>=41.0.0-alpha.0`, because npm audit states the range relative to what
is installed and only one `expo@54.0.37` remains. One entry is new:
`expo-audio` (moderate), reached via the now-correct `expo-asset@12.0.13`;
the installed `1.1.1` sits below the advisory range's floor, so this is the
via-chain shape, and its named fix is the same SDK upgrade as every other
entry with the Android owner. Net 36 → 35; the guard's stale-entry report
is what surfaced all three changes.)

### 2.2 Why every one of the 36 is currently un-fixable here, not silently waived

Every advisory's only available fix (`npm audit --json`'s own
`fixAvailable`) requires an `npm install`, and in every case here that
install is a semver-major bump:

- **7 are `packages/server`'s own backend runtime dependencies**: `ai`
  (direct, low), `@ai-sdk/gateway`/`@ai-sdk/provider-utils` (transitive via
  `ai`, low), `express` (direct, moderate), `body-parser`/`qs` (transitive
  via `express`, moderate), and `uuid` (direct, moderate — the available fix
  is `uuid@14.0.2`, a jump of 5 major versions from the current `^9.0.1`
  pin). **Owner: `packages/server` dependency owner.**
- **28 are the Expo/React Native toolchain `apps/android` depends on**
  (29 at T44A3; see the T326 note in §2.1): `expo` itself (direct, high)
  and its satellites (`@expo/cli`/`@expo/config`/`@expo/config-plugins`/
  `@expo/metro`/`@expo/metro-config`/`@expo/prebuild-config`), `expo-audio`
  (via `expo-asset`), the Metro bundler chain
  (`@react-native/metro-config`/`metro`/`metro-config`/
  `metro-transform-worker`/`image-size`/`postcss`), React Navigation (via
  `expo-router`: `@react-navigation/bottom-tabs`/`core`/`elements`/`native`/
  `native-stack`), and a handful of smaller transitive packages
  (`decode-uri-component`/`query-string`/`xcode`/`jest-expo`/`expo-asset`/
  `expo-constants`/`expo-linking`/`expo-module-scripts`/`expo-router`
  itself). The available fix for nearly all of these is `expo@57.0.20` — 3
  major versions ahead of the `^54.0.18` this app currently pins, and
  several of the individual package fixes are themselves semver-major.
  **Wave 3 added the 36th**: installing `expo-notifications@~0.32.17` (T391,
  which is what gives Android a real push token and the Approve/Deny actions
  its port documented as missing) brought upstream's own canary-range advisory
  against the SDK 54 line in with it — moderate, installed version inside the
  range, and fixable only by the same Expo SDK upgrade this bullet already
  names. Recorded in `AUDIT_BASELINE` under the same owner.
  **Owner: `apps/android` dependency owner (Expo SDK upgrade).**

None of this is a "genuinely unfixable, forever" waiver — every one of these
IS fixable, by the SDK/dependency upgrade named above. It is unfixable
**in this task**, under this task's hard rule against `npm install`/`npm
ci`, and the record above is the explicit, reasoned, owner-attributed waiver
this task's third acceptance criterion requires — not silence.

### 2.3 The gate: a documented baseline, not a raised threshold

A bare `npm audit --audit-level=moderate` (or any level) CI step would fail
on every run, forever, for a reason nobody reading that one red job could
act on — the exact shape that gets a check disabled a few waves later
rather than fixed. Raising `--audit-level` until the job goes quiet was
explicitly ruled out by this task's own brief for the identical reason: it
hides real findings instead of documenting them.

Instead, `scripts/ci/guard-audit-baseline.mjs` (wired as the
`guard-audit-baseline` job, which runs `npm ci` then
`node scripts/ci/run-guard-audit-baseline.mjs`) diffs `npm audit`'s live
output against the 36-entry `AUDIT_BASELINE` above, matched by
**(package, severity, range)** — not package name alone. This means:

- **A genuinely new advisory** (a 37th package, or an existing package's
  advisory changing severity or affected range) is NOT silently absorbed —
  it fails the job, by design, until someone adds a reasoned, owned entry
  to `AUDIT_BASELINE` (or fixes it).
- **A fixed or withdrawn advisory** (a baseline entry `npm audit` no longer
  reports) is reported as a non-fatal "stale, please prune" note — this
  guard does not fail a security gate because something got BETTER, which
  would be a perverse incentive; see `findStaleBaselineEntries`'s own doc
  comment in `guard-audit-baseline.mjs`.

**Proven, not asserted** (both live against the real, captured `npm audit`
JSON from §2.1, via a throwaway script — no file in the repository was
touched for this proof):

- Injecting a 37th, fake package (`totally-fake-package`, severity
  `critical`) into the real vulnerabilities object →
  `findUnbaselinedAdvisories` reported exactly that one entry.
- Removing `uuid` from the real vulnerabilities object (simulating it being
  fixed) → `findStaleBaselineEntries` reported exactly `uuid` as stale.
- `node scripts/ci/run-guard-audit-baseline.mjs` was also run for real
  (network, no repo mutation): `guard-audit-baseline: OK — every advisory
npm audit reports (36 package(s)) is covered by the documented baseline.`

**Disclosed limitation** (from `guard-audit-baseline.mjs`'s own header, and
pinned by a dedicated test): matching on (package, severity, range) means a
genuinely NEW, DIFFERENT advisory landing on an already-baselined package,
at the exact same severity and the exact same affected-range string, is
invisible to this guard. Closing this fully means keying on the advisory's
own GHSA id / numeric `source`, which `npm audit --json`'s `via` array
carries inconsistently (a bare string for a purely transitive hop, an
object with `source`/`url`/`title` for the package an advisory was filed
against directly) — not built here; revisit if this blind spot is ever
actually hit.

---

## 3. Secret scan

`scripts/ci/guard-secret-scan.mjs` (wired as the `guard-secret-scan` job,
unconditional) is a **curated, high-signal** scan — 11 patterns, each
anchored to one vendor's documented token prefix (AWS access key id, an
`aws_secret_access_key`-style assignment, GitHub PAT classic/fine-grained/
OAuth-App, Slack token and webhook URL, Google API key, Stripe live secret
key, npm access token, a PEM private-key block header) — over every
`git ls-files`-tracked file (never a raw filesystem walk, so it can never
wander outside the repository or touch `D:\tmp`, `$PASEO_HOME`, or
`C:\Users\aksha\.pi`). No generic entropy scanning or bare `KEY=...`
assignment matching was built: this repository has plenty of legitimate
high-entropy strings (hashes, fixtures, generated ids) that would make such
a scanner permanently noisy and, per this repository's own established
lesson about checks nobody trusts, quickly disabled.

**Real result at the P9-W3 merge gate** (commit `910188f`, the tip of this
wave — re-run by that gate rather than carried over):
`guard-secret-scan: OK — no committed file matched a curated secret pattern
(2453 of 2477 tracked files scanned).` 24 tracked files were skipped as
binary by extension or by failing UTF-8 decode — images, fonts, and
similar; see `run-guard-secret-scan.mjs`'s `BINARY_EXTENSIONS`.

**CORRECTED (T248): `BINARY_EXTENSIONS` no longer exists.** The premise
above — that `readFileSync(path, "utf8")` fails to decode a binary file and
that skipping fonts/images by extension was worth doing — was disproved the
same way T237 disproved it next door for `run-guard-signing-material.mjs`:
Node's UTF-8 decode never throws (it substitutes U+FFFD), so the guard's own
`catch` never fired for the reason its comment claimed, and the real read
cost of the 24 skipped files (largest: `apps/android/assets/fonts/
Inter-700.ttf`, 344,072 bytes) measured within the noise of the scan itself
(5 runs each: 181.4ms mean with the skip applied, 190.0ms mean without —
an ~8.6ms difference smaller than the ~30ms spread already present across
the "with skip" runs alone), with zero false positives either way. T248
removed the set entirely; every tracked file's content is now read, subject
only to the existing 5 MiB size cap. `run-guard-secret-scan.mjs` now
reports every tracked file scanned, not just the non-skipped ones — re-run
`node scripts/ci/run-guard-secret-scan.mjs` for the current figure.

**Do not trust that pair of numbers as current** — the total is the tracked
file count, so every wave that adds a file moves it. Re-derive instead:
`node scripts/ci/run-guard-secret-scan.mjs` prints both figures, and
`git ls-tree -r --name-only HEAD | wc -l` is the total it should agree
with. (CORRECTED at the P9-W3 merge gate: this said "2443 of 2467 tracked
files" as a live "today" figure. That was measured before this wave's own
ten files were staged, so the document under-counted the tree it shipped
in by exactly the files it added.)

### 3.1 Mutation proof against a REAL tracked file

Per this task's explicit instruction, the unit-test fixtures in
`guard-secret-scan.test.mjs` are not sufficient proof on their own (they
build every secret-shaped fixture via string concatenation specifically so
the guard's own test file can never trip the real scan — see that file's
header). A second, live proof was run against a real tracked file:

1. This very document (`docs/security-and-version-drift.md`) was committed
   first, as a genuinely tracked file.
2. A synthetic, obviously-fake AWS access key id — the `AKIA` prefix
   followed by 16 example characters, deliberately not spelled out as one
   contiguous run in this sentence so this very paragraph cannot itself
   re-trip the guard it is describing — was appended to this file.
3. `node scripts/ci/run-guard-secret-scan.mjs` was run: it exited **1**,
   naming this exact file, the exact line number, and `aws-access-key-id`
   as the matched pattern — WITHOUT printing the matched text itself, per
   this guard's own no-leak design (see `guard-secret-scan.mjs`'s header).
4. The added line was removed, restoring this file byte-identically from a
   scratchpad backup copy taken before the mutation — **never
   `git checkout --`**.
5. `git status --porcelain` and
   `node scripts/ci/run-guard-clean-working-tree.mjs` were both re-run and
   confirmed the tree was clean again (exit 0) before this document's real
   content was committed.

### 3.2 Disclosed scope

- Tracked-tree-only. A secret that ever reached a commit and was later
  deleted is still reachable via `git log` — this guard says nothing about
  history, only the current tree.
- No secret was found, live or fake-committed, anywhere else in this
  repository's tracked tree at the time this scan was run.
- **If a real secret is ever found by this guard**: this task's own hard
  rules apply — stop, report it, never print its value, never rotate it or
  rewrite history unilaterally; it is an owner decision.

---

## 4. GitHub Actions supply-chain pinning (T229: fixed, re-measured after)

Measured directly from the committed tree at the P9-W3 merge gate (commit
`910188f`) with `git grep -h "uses: " HEAD -- '.github/workflows/*.yml'`,
counting SHA pins as `@` followed by forty hex characters: **78** total
`uses:` lines, of which 22 were SHA-pinned and 56 were still tag-pinned
(`actions/setup-node@v4` x34, `actions/checkout@v4` x16 beside 21
already-SHA-pinned occurrences, `expo/expo-github-action@v8` x3,
`reactivecircus/android-emulator-runner@v2` x2,
`cachix/install-nix-action@v27` x1). That was already a dated snapshot by
the time T229 started; waves landed between the two, and T229's own
re-measurement — with the identical command, before touching anything —
found different counts: **88** `uses:` lines, 25 already SHA-pinned, 63
tag-pinned. Neither historical figure should be trusted without re-running
the command; the current state is the table below, re-derived at this
section's own commit (named in the paragraph after it).

T229 SHA-pinned every remaining tag-pinned `uses:` line, resolving each
commit via `gh api repos/<owner>/<repo>/git/refs/tags/<tag>` — dereferencing
one annotated tag object where the API returned `object.type: "tag"` rather
than `"commit"` (`reactivecircus/android-emulator-runner@v2`) — rather than
guessing, landed across three commits in increasing order of risk
(`actions/setup-node` first, then the remaining `actions/checkout@v4`
occurrences, then the three third-party actions last) so a bad pin can be
bisected instead of reverted wholesale. The exact API call, whether each
tag was annotated, and the response read for every SHA are in that task's
commit messages (`git log --grep=T229`), not repeated here.

Re-measured after those three commits, at this repository's `HEAD` at the
time this paragraph was written (`git rev-parse HEAD` →
`de5fce9402742ecfb8ce6ad90cf6bbd30451f93d`), with the same commands as
above:

```
$ git grep -h "uses: " HEAD -- '.github/workflows/*.yml' | wc -l
88
$ git grep -hE "uses: [A-Za-z0-9_./-]+@[0-9a-f]{40}" HEAD -- '.github/workflows/*.yml' | wc -l
88
$ git grep -hoE "uses: [A-Za-z0-9_./-]+" HEAD -- '.github/workflows/*.yml' | sed 's/uses: //' | sort | uniq -c
     42 actions/checkout
     39 actions/setup-node
      1 cachix/install-nix-action
      1 dorny/paths-filter
      3 expo/expo-github-action
      2 reactivecircus/android-emulator-runner
```

| Action                                   | Count  | Pinning                                                   |
| ---------------------------------------- | ------ | --------------------------------------------------------- |
| `actions/checkout`                       | 42     | **all 42 SHA-pinned** (`@11d5960a...` `# v4.4.0`)         |
| `actions/setup-node`                     | 39     | **all 39 SHA-pinned** (`@49933ea5...` `# v4.4.0`)         |
| `expo/expo-github-action`                | 3      | **all 3 SHA-pinned** (`@c7b66a9c...` `# v8.2.1`)          |
| `reactivecircus/android-emulator-runner` | 2      | **both SHA-pinned** (`@a421e438...` `# v2.38.0`)          |
| `cachix/install-nix-action`              | 1      | **SHA-pinned** (`@ba0dd844...` `# v27`)                   |
| `dorny/paths-filter`                     | 1      | SHA-pinned (`@de90cc6f...` `# v3.0.2`, unchanged by T229) |
| **Total**                                | **88** | **all 88 SHA-pinned, 0 tag-pinned**                       |

No mutable tag (`@v4`, `@v8`, `@v2`, `@v27`) remains anywhere in
`.github/workflows/*.yml`. The supply-chain surface this section used to
disclose as an open finding is closed by pinning, not by narrowing the
count basis — every command above is copy-pasteable and re-derives the
table from the live tree; nothing in it was hand-typed to match an
expectation.

(CORRECTED at the P9-W3 merge gate: this said "so this task adds zero new
tag-pinned `uses:` lines", counting only one of the two `uses:` lines each
new job contributes. In a register whose acceptance criterion is that
nothing is silently waived, that under-reported this wave's own added
attack surface — the single number a reader would most want to trust. That
sentence described a surface T229, above, has since closed entirely: there
is no longer a tag-pinned line of any kind in this tree left to
under-report.)

---

## 5. What is NOT covered by this task

- No third-party secret-scanning GitHub Action (a gitleaks/trufflehog
  Action) was added. The curated in-repo guard (§3) is the one that can
  actually be proven able to fail from this environment; the task's own
  guidance is to prefer that over an action that "can only be reasoned
  about, not proven" here. Not adding one is a deliberate choice, not an
  oversight — revisit if the curated pattern list's coverage is found
  insufficient in practice.
- No CodeQL workflow was added — outside this task's `Owns:` line and this
  task's brief did not ask for it.
- No Dependabot config was added — `npm install`/`npm ci` being refused in
  this environment means any Dependabot-opened PR could not be verified
  here either; §2's baseline-diff guard is the mechanism that keeps the
  dependency-audit half honest without one.
