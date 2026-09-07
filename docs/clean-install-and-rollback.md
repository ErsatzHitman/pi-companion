# Clean install and rollback (T44B2)

This is the record `docs/issues-from-plan.md`'s T44B2 ("Verify clean installs and
document rollback") asks for. It has two audiences and keeps them in separate
sections:

- **Part A** is a runbook for the person actually doing the install, the
  uninstall, or the support call. No task IDs, no internal jargon.
- **Part B**, at the end, is the provenance: what was measured, how, and what
  could not be run at all — for the next agent or reviewer who needs to check
  this page's claims.

**Read this before anything else, if you are the person running these steps on
the machine that also runs this project's own daemon:** this laptop already runs
a production Pi Companion / Paseo daemon on port 6767, with a real `$PASEO_HOME`
data directory. Everything below that is safe on a machine with nothing running
yet becomes a real hazard on a machine like that one. §A.5 exists specifically
for that situation — read it before you type a command that starts a daemon.

---

## Part A — for the person installing, uninstalling, or supporting this

### A.1 What "installing this product" actually means

There are two separate things to install, and they don't touch each other:

| Piece            | What it is                                                                                                       | Where it runs      | What you install                                                                          |
| ---------------- | ---------------------------------------------------------------------------------------------------------------- | ------------------ | ----------------------------------------------------------------------------------------- |
| **Daemon + CLI** | The background process that talks to your coding agents, and the command-line tool that starts/stops/inspects it | Your laptop        | An npm package, `@picompanion/cli`, which puts one command, `paseo`, on your command line |
| **App**          | The phone app you actually use day to day                                                                        | Your Android phone | An APK (an Android install file)                                                          |

You can install either one without the other, but the app needs a daemon
somewhere to talk to.

### A.2 Installing the daemon and CLI on your laptop

**What you'll run** (a maintainer runs this, not an automated process — see
§B.3 for why):

```
npm install -g @picompanion/cli
```

**What you should see:** npm prints a short summary ending in a line of the
form `added N packages in Ms`, where **N is in the low hundreds, not 1**.

No exact figure is printed here on purpose. Two independent walks of this
repository's `package-lock.json` at the P9-W6 merge gate returned 286 and 243
registry packages, because hoisting, deduplication and platform-optional
entries all move the number, and an npm upgrade moves it again. **A big number
here is normal and is not a sign you installed the wrong thing** — it is the
`paseo` program plus every library it depends on. If you see `added 1 package`,
something is wrong: check you typed the package name in full.

A new command called `paseo` becomes available in your terminal.

**How to check it worked**, without starting anything:

```
paseo --version
```

Expected output: a version string, e.g. `0.3.0-beta.2`. This command only reads
the package's own `package.json` — it does not start a daemon and does not
touch your data directory. If this fails with "command not found" or
"'paseo' is not recognized", npm's global bin directory is not on your `PATH`;
run `npm config get prefix` and add that folder's `bin` (or, on Windows, the
prefix folder itself) to your `PATH`, then open a new terminal window.

**What actually landed on disk:** three things, and it is worth knowing which
is which.

1. **The `paseo` package itself** — a small launcher script (`bin/paseo`, 2
   lines: it just loads the real program), the compiled program (`dist/`), and
   its `package.json`. That is the whole published package; §B.1 lists it
   exactly.
2. **The libraries it depends on**, downloaded from npm at install time. These
   are the majority of the files and the whole of that large "added N
   packages" number. They live beside the package in npm's global folder and
   are removed with it when you uninstall.
3. **A `paseo` shortcut** in npm's global command folder, which is what makes
   the word `paseo` work as a command anywhere.

The install step by itself does not create, read, or write your data directory
— it only copies files into npm's own global package folder. See §B.1–§B.2
for the exact evidence.

(CORRECTED at the P9-W6 merge gate: this said the install lands "exactly two
kinds of file ... Nothing else", and paired that with an expected `added 1
package`. Both described the published TARBALL, not an install: the tarball
vendors no `node_modules`, so npm resolves the dependency closure from the
registry. §B.1 of this same document already named `package.json` as a third
file, which contradicted the "exactly two ... Nothing else" above it.)

**Do not run a bare `paseo` with no other words after it yet.** Typing just
`paseo` and pressing enter starts a **first-time setup wizard**, and that
wizard's whole job is to start a daemon — on port 6767 by default, the same
port a daemon on this kind of machine may already be using for something else
important. Read §A.5 before you run that. `paseo --version` and `paseo --help`
are safe; a bare `paseo` is not.

### A.3 Installing the app on an Android phone — status: cannot be done yet

**Nothing has been installed here. No APK exists yet to install.** This section
is the checklist for whoever can eventually run it, written as commands with
their expected output — not a description of something that already happened.

Two separate things are blocking this, and they are different problems:

1. **There is no APK to install.** Building one needs a signing credential and
   an access token that only the project owner can supply (`EXPO_TOKEN` plus
   Android signing keys held by Expo's build service). Neither exists yet.
   `docs/android-apk-release.md` §4 is the exact, numbered checklist for the
   owner to produce the first one.
2. **Even once an APK exists, installing a SECOND one over the first will fail
   today**, with an error Android phones show as
   `INSTALL_FAILED_VERSION_DOWNGRADE`. Every build made from this codebase
   currently claims to be the exact same version internally, no matter which
   tag it was built from, so Android's package manager refuses to treat a new
   one as an upgrade. This is filed and not yet fixed — see §B.6. **Practical
   consequence for you:** the first install on a given phone will work; before
   installing an update, uninstall the old one first (§A.4 covers this).

**Once an APK exists**, installing it (from a computer with the Android
developer tools, with the phone connected by USB and "USB debugging" enabled
in its developer settings):

```
adb install path\to\the.apk
```

Expected output ends with `Success`. If you instead see
`INSTALL_FAILED_VERSION_DOWNGRADE`, that is the known issue above — uninstall
the existing app first (§A.4), then reinstall.

Without a computer, copying the APK file to the phone and opening it also
works, after allowing "install unknown apps" for whichever app you used to
open the file (email, file manager, browser download).

### A.4 Rolling back

Read this in order. Each step says exactly what you keep and what you lose.

#### Rolling back the phone app

1. **Uninstall the app the normal Android way** — long-press its icon, choose
   Uninstall, or use Settings → Apps → Pi Companion → Uninstall.
   - **What you lose:** anything the app stored only on the phone (its own
     settings, cached view of past conversations). Standard for any Android
     app — uninstalling always clears an app's own storage.
   - **What you keep:** everything on the daemon side. The phone app never
     writes anything to your laptop's data directory — it only talks to the
     daemon over the network. Uninstalling the app cannot touch your laptop at
     all.
   - Command-line equivalent, from a computer with the phone connected:
     `adb uninstall sh.picompanion` (expected output: `Success`).

There is nothing else to roll back on the phone — no separate "old version" to
restore, because there is no working older release of this product to go back
to. If a new install misbehaves, uninstalling removes it cleanly.

#### Rolling back the laptop daemon and CLI

2. **Check whether a daemon is actually running before you touch anything.**
   This matters more than it sounds like it should: this product's daemon
   listens on port 6767 by default, and if you (or this laptop's owner) also
   run an older, separately-installed version of the same underlying project
   under its original name, **that daemon uses the exact same default port and
   the exact same data directory.** The two are not automatically
   distinguishable from the port number alone. Before stopping anything:

   ```
   paseo daemon status
   ```

   This prints, among other things, a version number and a process id for
   whatever daemon answers on the default port. **If you are not certain which
   daemon that is, stop here and ask, rather than guessing.** Stopping the
   wrong daemon can interrupt someone else's work session.

3. **Stop the daemon, if one from this product is running and you've confirmed
   it's the right one:**

   ```
   paseo daemon stop
   ```

   Expected output: confirmation that it stopped. If nothing was running, it
   says so and does nothing else.

4. **Uninstall the command-line tool:**

   ```
   npm uninstall -g @picompanion/cli
   ```

   - **What this removes:** the `paseo` command and the program files behind
     it. After this, `paseo --version` goes back to "command not found".
   - **What this does NOT remove, and why that's usually what you want:**
     your data directory (by default `~/.paseo`, or wherever the `PASEO_HOME`
     environment variable points) is never touched by this command. Anything
     the daemon ever wrote there — its configuration, its identity file, its
     log, a record of the process id it last ran as — is left exactly as it
     was. **This is deliberate**: uninstalling the program should not be the
     same thing as deleting your data. See §B.4 and §B.5 for exactly which
     files that is and the evidence behind this claim — it is not simply
     assumed.

5. **Only if you specifically want to remove the leftover data too** (most
   people should stop at step 4): the files left behind live in one folder —
   by default `~/.paseo` on the machine that ran the daemon (check the
   `PASEO_HOME` environment variable first; if it is set, that path is used
   instead). **Do not delete this folder if any other installation of this
   project — old or new, this one or a differently-branded one that shares the
   same data format — still uses it.** It is shared, compatible storage by
   design, not exclusively this install's own scratch space. If you are sure
   nothing else needs it, deleting the folder removes: the saved
   configuration, the CLI's own client identity, the daemon's own identity
   file, its log, and its process-id bookkeeping. It does not remove anything
   from your phone, and it does not remove the `paseo`/`@picompanion/cli`
   program itself (that's step 4).

**In short:** step 4 alone is a safe, reversible rollback — you get your
command-line tool back to "not installed" without risking your daemon's saved
configuration or your agent session history. Step 5 is a separate, one-way
decision that only makes sense once you're sure nothing else reads that data.

### A.5 If this is the machine that already runs a production daemon

This is the specific situation this document was written to protect against,
so it gets its own short section. If a real daemon for this project is
already running on this laptop before you do anything above:

- **Do not run a bare `paseo`** (no other words after it). It starts a setup
  wizard whose entire purpose is getting a daemon running, and by default it
  targets the exact same port (6767) and the exact same data folder the
  existing daemon already uses.
- **Do not run `paseo daemon stop`** unless step 2 above already told you,
  with certainty, that the thing listening on that port is one you intend to
  stop.
- If you need to try this install alongside an existing daemon rather than
  instead of it, every command that talks to a daemon accepts a different
  target: `--port <a different number>` on the commands that start one, and a
  `PASEO_HOME=<a different folder>` environment variable to keep its data
  completely separate from the existing installation's. Neither is set by
  default — you have to choose them yourself.

### A.6 Support — common problems and what they mean

| What you see                                                                 | What it means                                                                         | What to do                                                                                                                                                                       |
| ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `'paseo' is not recognized` / `command not found`                            | npm's global bin folder isn't on your `PATH`                                          | Run `npm config get prefix`, add that folder (its `bin` subfolder on Mac/Linux) to `PATH`, open a new terminal                                                                   |
| `paseo daemon status` shows nothing responding                               | No daemon is running                                                                  | Only start one deliberately (see §A.5 if this machine might already run one)                                                                                                     |
| A daemon won't start, and the terminal mentions the port is already in use   | Something (possibly another daemon) already owns that port                            | Do not force it. Run `paseo daemon status` first to see if it's actually this project's own daemon already running — if so, you don't need to start a second one                 |
| `INSTALL_FAILED_VERSION_DOWNGRADE` installing the app                        | Every build currently reports the same internal version (a known, filed issue — §B.6) | Uninstall the existing app first, then install the new one                                                                                                                       |
| The app shows connected but nothing happens when you send a message          | Usually a daemon-reachability problem, not an app bug                                 | Confirm `paseo daemon status` shows the daemon reachable from the same laptop; confirm the phone is on the same network or paired the way the app's own connect screen describes |
| Uninstalling the CLI, then reinstalling it, seems to "remember" old settings | Expected — see §A.4 step 4. Your data directory was never removed                     | Only delete it (§A.4 step 5) if you're sure nothing else needs it                                                                                                                |

---

## Part B — provenance and verification (for reviewers and future agents)

Measured against this tree at commit `059358f14e0cb1b23e7697530fbebc95ab70825e`
(`git rev-parse HEAD` — never the harness's own `gitStatus` snapshot, per this
repository's CLAUDE.md). Every command below is meant to be re-run by the
reader, not trusted from this page.

**No daemon was started, no socket was opened to port 6767 or 6768 or anywhere
else, no APK was installed, and `npm install`/`npm ci`/`npm install -g`/
`npm publish` were never run**, per this task's hard constraints. Everything
in Part A about running commands is written as an owner-executable
checklist with predicted output derived from reading the source, not as a
record of something this task did. The one packaging command this task did
run, `npm pack --dry-run --workspace=@picompanion/cli` (read-only, explicitly
permitted — it inspects what would ship without publishing or installing
anything), is cited in §B.1.

### B.1 What actually ships — measured, not assumed

`packages/cli/package.json`'s `"files"` field claims `["bin", "dist",
"!dist/**/*.map"]`. Confirmed against the real tarball contents:

```
npm pack --dry-run --workspace=@picompanion/cli
```

At this commit that reports **238 total files, 98.9 kB packed / 452.4 kB
unpacked**, and the listing includes `bin/paseo` (76 B) and `package.json`
(1.5 kB) alongside the `dist/` tree. **These figures describe what ships in
the tarball, which is not the same question as what an install places on
disk:** `packages/cli/package.json` declares eleven direct runtime
dependencies and no `bundledDependencies`, and this tarball vendors no
`node_modules`, so npm resolves the whole dependency closure from the registry
at install time — a few hundred packages, per §A.2. Grep the command's own
output for
`bin/paseo`, `.map`, and `package.json` to confirm: zero `.map` files appear
(the `"!dist/**/*.map"` exclusion holds), and `bin/paseo` and `package.json`
are both present as the manifest claims. `npm pack` always runs the
package's `prepack` script first (`npm run build:clean`, which rebuilds
`protocol`, `client`, `server`, then this package) — that is normal `npm
pack` behavior, not a side effect this task introduced, and it never touches
`$PASEO_HOME`, the network, or any file outside this repository's own
`packages/*/dist`. `git status --porcelain` was empty (no leftover `.tgz`,
`dist/` is gitignored) after running it.

No other workspace declares a `bin` field —
`grep -rn '"bin"' packages/*/package.json apps/*/package.json` matches only
`packages/cli/package.json`. There is exactly one installable binary in this
product.

### B.2 `bin/paseo` — what it actually executes

The file is two lines:

```
#!/usr/bin/env -S node --disable-warning=DEP0040
import '../dist/index.js'
```

`dist/index.js` (compiled from `packages/cli/src/index.ts`) runs
`runCli(process.argv.slice(2), ...)` from `packages/cli/src/run.ts`. That
function's own logic is what §A.2's "do not run a bare `paseo`" warning is
built on:

```ts
if (invocation.argv.length === 0) {
  cliArgv = ["onboard"];
}
```

(`packages/cli/src/run.ts`) — confirmed by reading the file directly. A
completely bare invocation (zero arguments) is rewritten to `onboard` before
the command parser ever sees it. `paseo --version` and `paseo --help` have
one argument each, so this branch is never reached for them —
`createCliParseArgv`'s `argv.length === 0` check (`packages/cli/src/run.ts:30`)
is the only gate.

(CORRECTED at the P9-W6 merge gate: this named `classifyInvocation`. That
function lives in `packages/cli/src/classify.ts` and has no length check — its
own early return is `if (!firstArg)`. The length check runs one level up, on
the invocation `classifyInvocation` returns.)

`packages/cli/src/commands/onboard.ts`'s default port is 6767 (
`.option("--port <port>", "Port to listen on (default: 6767)")`), matching
`packages/cli/src/utils/client.ts`'s `DEFAULT_HOST = "localhost:6767"` and
`packages/cli/src/commands/daemon/start.ts`'s identical default. Onboarding
calls `startLocalDaemonDetached`, which spawns a **second** Node process —
not another copy of `paseo`, but a plain `node <path>` invocation of
`@picompanion/server`'s own daemon runner script, resolved at runtime via
`require.resolve("@picompanion/server")` (`resolveDaemonRunnerEntry` in
`packages/cli/src/commands/daemon/local-daemon.ts`). That second process is
the one that actually binds the listening port and reads/writes
`$PASEO_HOME`.

`paseo daemon status` is not a purely passive check either: it calls
`connectToDaemon` (`packages/cli/src/commands/daemon/status.ts`), which
opens a real, timed (1500 ms) probe connection to whatever the resolved host
and port currently are — the default host/port again being
`localhost:6767`. This is why this task never ran it: on this machine, an
unqualified `paseo daemon status` would probe the production daemon's own
port. §A.6 tells the reader to run it as a diagnostic, correctly, because a
short-lived, read-style probe connection to a daemon the reader owns is the
tool's intended purpose — but this task itself does not get to make that
connection on this machine (CLAUDE.md's hard rule), so it is documented from
source, not from a run.

### B.3 Why this could not be "verified end to end" here, and what was verified instead

The daemon half cannot be run here because doing so means either binding or
connecting to port 6767 (this machine's live production daemon's port) or
writing into `$PASEO_HOME` (this machine's live production data directory) —
both are hard-blocked for this task, correctly, since this laptop is not a
clean machine. **What this task instead verified is everything derivable
without executing the program**: the exact package contents (§B.1), the
exact code path a bare invocation takes (§B.2), and the exact read/write
behavior against `$PASEO_HOME` (§B.4). Every claim in Part A about what a
command does or prints is derived from reading the source that command runs,
not from observing a run.

The Android half is blocked twice over, independently:

1. **No APK exists.** Producing one needs an `EXPO_TOKEN` repository secret
   and Android signing credentials held by Expo's build service, both
   owner-supplied and both absent — `docs/android-apk-release.md` §4 is the
   exact, numbered checklist for whoever can supply them. This task never
   pushes, fetches, or dispatches a workflow (CLAUDE.md), so it could not
   trigger a build even if the secret existed.
2. **Even with an APK, a second install over a first would fail today** —
   see §B.6.

Any sentence anywhere in this repository claiming this task installed an
APK, ran a daemon, or verified either end to end is false; if you find one,
it is a defect in this document, not a record of something that happened.

### B.4 The read-versus-write question about `$PASEO_HOME` — answered, not restated

**`$PASEO_HOME` is not fully untouched by "installing this product," and the
distinction that matters is install versus first run, not read versus
write in the abstract.**

`grep -rln "PASEO_HOME" packages/*/src apps/*/src` finds it referenced in
`packages/cli` (four production files) and `packages/protocol`,
`packages/server` (two production files: `paseo-home.ts`, `server-id.ts`).
Read every one of those call sites, not just the grep:

- **`npm install -g @picompanion/cli` itself never touches `$PASEO_HOME`.**
  `packages/cli/package.json` declares no `preinstall`/`install`/
  `postinstall` lifecycle script (confirmed:
  `node -pe "JSON.stringify(require('./packages/cli/package.json').scripts)"`
  lists `clean`, `build`, `build:clean`, `prepack`, `typecheck`, `test*` —
  nothing install-related), so the install step only ever copies files into
  npm's own global package directory. This is the true, checked basis for
  §A.2's claim.
- **Resolving the home path is not free of side effects, even for a "read".**
  `packages/server/src/server/paseo-home.ts`'s `resolvePaseoHome()` —
  called by nearly everything else in this list, including
  `packages/cli/src/commands/daemon/local-daemon.ts`'s
  `resolveLocalDaemonState` (used by `paseo daemon status`) — unconditionally
  calls `ensurePrivateDirectory(resolved)`
  (`packages/server/src/server/private-files.ts`), which runs
  `mkdirSync(directoryPath, { recursive: true, mode: 0o700 })` and then a
  best-effort `chmodSync`. On an existing directory (which `$PASEO_HOME` is,
  on any machine that has ever run this daemon before) `mkdirSync` with
  `recursive: true` is a documented no-op — it neither errors nor changes an
  existing directory's permissions, since `mode` only applies at creation —
  and `chmodBestEffort` is a hard no-op on `process.platform === "win32"`
  (both read directly from `private-files.ts`). So on THIS machine, on
  Windows, with `$PASEO_HOME` already present: every call to
  `resolvePaseoHome()` is content-safe today, but it is not accurately
  described as "read-only" — it is a mkdir attempt that happens to be inert
  against an existing directory on this platform. On a genuinely fresh
  install (no `~/.paseo` yet) or a non-Windows host, that same call is the
  first thing that WRITES `$PASEO_HOME` into existence, before any daemon
  ever starts.
- **Several real writes are one command away, none of them behind
  `npm install`:**
  - `packages/cli/src/utils/client-id.ts`'s `getOrCreateCliClientId()` reads
    `$PASEO_HOME/cli-client-id` first and only writes it if missing
    (`ENOENT` branch) — reached by `packages/cli/src/utils/client.ts`, i.e.
    any command that connects to a daemon at all.
  - `packages/cli/src/commands/onboard.ts`'s `savePersistedConfig()` writes
    `$PASEO_HOME/config.json` unconditionally, every time onboarding
    completes a step that calls it.
  - The daemon process itself (spawned by `startLocalDaemonDetached`, §B.2)
    writes `$PASEO_HOME/paseo.pid` and `$PASEO_HOME/daemon.log`
    (`DAEMON_PID_FILENAME` / `DAEMON_LOG_FILENAME` in
    `packages/cli/src/commands/daemon/local-daemon.ts`) and
    `$PASEO_HOME/server-id` (`packages/server/src/server/server-id.ts`,
    `SERVER_ID_FILENAME`), plus whatever session/agent data the daemon
    itself manages once it is actually running (out of this task's Owns
    line to enumerate exhaustively — `packages/server`'s own docs are the
    source of truth for the daemon's full on-disk format).

**Stated plainly, since a criterion that says "untouched" needs this
distinguished rather than smoothed over:** the _install_ step
(`npm install -g @picompanion/cli`) genuinely touches nothing under
`$PASEO_HOME` — that half of the claim holds and is the one this task can
state with confidence. But the moment the installed tool is actually RUN —
even a status check, even before any daemon is deliberately started — it can
create the directory (on a fresh machine) and will, for several ordinary
commands, write specific named files into it. None of those writes ever
delete or overwrite another installation's existing session/config data;
they only add the files named above if absent. This is why §A.4's rollback
procedure treats "uninstall the program" (step 4, which is the true,
verified no-touch operation) and "delete the leftover data" (step 5, a
separate, one-way, opt-in choice) as two different steps rather than one.

### B.5 Rollback claims, checked against the same call sites

`npm uninstall -g @picompanion/cli` removes only what `npm install -g` put in
place — the package's own files under npm's global package directory (no
uninstall lifecycle script either; same `scripts` listing as §B.4). It has no
code path that reads an environment variable, resolves a home directory, or
touches a file outside npm's own bookkeeping. This is the standard behavior
of `npm uninstall` for any package with no uninstall hook, and this package
has none — confirmed by the same `scripts` field checked above. Everything
§B.4 lists as written under `$PASEO_HOME` is therefore left in place by an
uninstall, which is exactly what §A.4 step 4 states.

### B.6 The Android second-install collision (T235) — named here, not discovered later

`apps/android/app.config.ts` sets `android.versionCode` from its own semver
`version` through `computeVersionCodeFromSemver`, so two releases carrying
different `version` strings build different `versionCode`s and install over
one another. No profile in `apps/android/eas.json` sets `"autoIncrement"`,
and that is deliberate rather than an omission — see §3.2 of
`docs/android-apk-release.md` for why that route cannot durably increment
under `"appVersionSource": "local"`.

One collision remains, and this is the place to stand for it: `versionCode`
is derived from `version`, not from the git tag, and nothing fails a release
that tags `v0.2.0` while `app.config.ts` still declares `0.1.0`. That build
reproduces the previous `versionCode`, and Android's package manager refuses
an APK whose `versionCode` is not strictly greater than the one already on
the device — the `INSTALL_FAILED_VERSION_DOWNGRADE` failure §A.3 and §A.6
describe. Bump `version` in the same commit that you tag.

**CORRECTED at the P9-A merge gate.** This said there was "no
`android.versionCode` anywhere in that file (`grep -n "versionCode"
apps/android/app.config.ts` — no match, confirmed at this commit)", that
"every tagged release therefore ships the same `versionCode`", and that T235
was "unfixed as of this commit — confirmed by reading both files directly".
All three were true when written and were falsified by T235, which landed in
the P9-A wave — including the clause advertising that the claim had been
checked by direct reading rather than trusted from the ledger.

### B.7 The `paseo` naming — checked against both plan.md and the reference checkout, not assumed

`packages/cli/package.json` publishes its one binary as `paseo`, not
`picompanion` or any `pi-*` name, and its default host, default port
(6767), and default data directory (`$PASEO_HOME` / `~/.paseo`) all use the
same legacy name. Whether that is deliberate compatibility or naming that
leaked was checked, not assumed, against two sources:

- `plan.md` §1.1's identity boundary table is explicit that `$PASEO_HOME`
  and every `PASEO_*` environment variable are **kept for compatibility**
  deliberately — "preserving them keeps existing daemon data, relay keys,
  and wire contracts working" — while `@picompanion/*` package names,
  `sh.picompanion`, and `picompanion://` are the **new** identity. The table
  does not mention the CLI's executable name either way.
- The read-only reference checkout at `D:\paseo` (never modified — see
  CLAUDE.md) already ships this exact split, unchanged: its root
  `package.json` names the product `"paseo"` (`homepage: "https://paseo.sh"`)
  while its own `description` field and its `README.md`'s own top-level
  heading already read "Pi Companion" — and `D:\paseo\packages\cli\
package.json`'s `"bin"` field is **already** `{ "paseo": "bin/paseo" }`,
  identical to this repository's. `D:\paseo\packages\protocol\package.json`,
  `packages/client`, and `packages/server` are likewise already named
  `@picompanion/*` there. In other words, the reference project had already
  begun exactly this split — new package identity, kept operational
  identity — before this repository's own T02 port ever copied it, and the
  port carried that split forward unchanged rather than introducing it.

**Conclusion: this reads as the same deliberate pattern plan.md states for
`$PASEO_HOME`, extended by the reference project itself to the CLI's
executable name, default port, and default host — not as an accident of the
port.** It is not, however, a line plan.md itself states in so many words for
the binary name specifically; that is an inference from the same
documented rationale, not a literal citation. This task does not change it
either way — `Owns: docs/` only, and renaming a published binary is a
product decision, not a docs fix. If a future task does rename it, this
section (and the operational hazard this whole document exists to describe)
should be revisited in the same commit.

### B.8 Version story

`@picompanion/cli` is `0.3.0-beta.2`. Checked across every workspace
(`for f in packages/*/package.json apps/*/package.json; do node -pe
"require('./$f').version"; done`): the packages ported from the reference
checkout under AGPL provenance (`cli`, `client`, `expo-two-way-audio`,
`highlight`, `protocol`, `relay`, `server`) all agree at `0.3.0-beta.2`; the
packages and apps built new for this product (`design-tokens`,
`frontend-core`, `pi-bridge`, `apps/android`, `apps/web`) all agree at
`0.1.0`. This is a deliberate two-tier scheme, not drift. The reason is
provenance: `0.3.0-beta.2` is the version of the read-only Paseo reference
checkout the backend was ported from, recorded in `docs/T02-provenance.md`,
`docs/T03-provenance.md`, `docs/T04-provenance.md` and
`docs/T18-provenance.md`; the packages built new for this product started at
`0.1.0`. `scripts/ci/guard-version-drift.mjs` **passes** on this split, which
is the check that matters, but it neither documents nor enforces the split
itself — it compares each declared pin against its own target's `version`
and is agnostic about whether two packages share a number. Run it:

(CORRECTED at the P9-W6 merge gate: this said the split was "confirmed by
reading `scripts/ci/guard-version-drift.mjs`'s own header comment, which
documents this exact choice". That header documents a different deliberate
choice — that consumers pin `@picompanion/*` with exact version strings — and
says nothing about the two-tier split. The conclusion was right; the citation
pointed at a source that does not support it.)

```
node scripts/ci/run-guard-version-drift.mjs
```

At this commit: `OK` on all three of its checks (every declared
`@picompanion/*` dependency pin across 12 manifests matches its target's own
`version`; the daemon/client wire hello version literals agree; the
protocol/relay wire version literals agree), plus a `NOTE` line the guard
prints itself, listing what it does not check (third-party SemVer ranges,
the Android SDK pin, and the daemon's own runtime-reported version). The
daemon's self-reported version (`resolveDaemonVersion`,
`packages/server/src/server/daemon-version.ts`) and the CLI's own
(`resolveCliVersion`, `packages/cli/src/version.ts`) each read their own
package's `package.json` live at runtime, so neither can drift from its own
manifest by construction — matching that guard's own NOTE line exactly.
This guard already covers everything this task's brief asked it to check;
nothing new needed adding here.

### B.9 Baselines this task confirmed itself

```
node --test scripts/ci/*.test.mjs
```

All pass (measured at this commit; do not restate the count here — see
CLAUDE.md's own standing instruction on why a pinned test count in this file
would go stale).

```
./node_modules/.bin/oxfmt --check .
```

Clean (the pinned binary, not `npx oxfmt`, per this repository's own
lesson about running it — after this task's own edits, run last).

```
node scripts/ci/run-guard-run-guard-wiring.mjs
```

OK — this task added no new guard runner, so nothing new needed wiring; the
existing wiring is unaffected by a docs-only change.

```
node scripts/ci/run-guard-signing-material.mjs
node scripts/ci/run-guard-secret-scan.mjs
```

Both exit 0. This document's own PEM-shaped and `INSTALL_FAILED_*`-shaped
text never assembles a contiguous secret-shaped literal — there is no actual
key material anywhere in this file to split, unlike `docs/android-apk-
release.md` §2.3 and `docs/security-and-version-drift.md` §3.1, which
demonstrate real guard fixtures and do need that treatment.

```
node scripts/ci/run-guard-version-drift.mjs
node scripts/ci/run-guard-clean-working-tree.mjs
```

Both OK / exit 0, the latter confirmed immediately before this task's final
commit.

```
npm run typecheck --workspaces --if-present
```

This task touched no `packages/*/src` or `apps/*/src` file — only new and
edited files under `docs/`. Run to completion regardless, per this
repository's own warning that a clean typecheck can mean nothing relevant
ran: exit code `2`, with the only failing workspace being
`@picompanion/android`, showing the same 18 `TS2307: Cannot find module
'expo-router'` errors `docs/android-apk-release.md` §6 already documents as
a standing, local-workstation-only fact (T200's correction: `expo-router` is
declared in `apps/android/package.json` but genuinely absent from
`apps/android/node_modules` on this machine — `ls apps/android/node_modules
| grep '^expo-router$'` confirms, and a clean CI `npm ci` checkout does not
have this problem). This is the same pre-existing, out-of-scope failure that
task's own baseline already recorded, not something this task introduced or
could affect — nothing under `docs/` participates in module resolution for
`apps/android/src`.
