# UPDATED HANDOFF — Maestro is fully green; the S7 redesign is next

**Written:** 2026-09-11 · **At commit:** `af33662` · **Branch:** `main`

This supplements `HANDOFF.md`, it does not replace it. **Read `HANDOFF.md` first** — its §0
(owner's standing instructions), §2 (hard rules), §7 (the S7 / A1–A3 design spec) and §9
(task split) are all still current. Then read `CLAUDE.md`. This file records only what changed
since `HANDOFF.md` was written, and corrects the parts of it that turned out to be wrong.

---

## 1. Headline: Next Step 1 is DONE

`HANDOFF.md` §10 step 1 ("take shard-4 from red to green, dispatch until all five shards are
green") is complete.

| Run                   | Commit    | Result                                                  |
| --------------------- | --------- | ------------------------------------------------------- |
| Maestro `34522689648` | `b12b7f0` | **APK build ✓, packaged-app smoke ✓, shards 1–5 all ✓** |
| CI `34522609941`      | `b12b7f0` | success                                                 |
| CI `34525220309`      | `af33662` | was in progress at hand-off; check it                   |

The eleven "A dispatch in which …" acceptance boxes under T334 and T336–T347 are now ticked
(`af33662`), with the run id recorded on T334's box, which every other one points at.

**Deliberately still open**, do not tick these: T310's and T318's "gets past
`Build development APK on EAS`", and T314's "a real failing dispatch shows the reason in the CI
log". The EAS step no longer exists (T318/T330 moved the build onto the runner), so ticking the
first two would claim an EAS dispatch that never happened; T314's needs a _failing_ build to
prove its diagnostic fires.

---

## 2. What landed since `HANDOFF.md` (T346–T348)

| Task | Commit    | What it did                                                               |
| ---- | --------- | ------------------------------------------------------------------------- |
| T346 | `465c212` | Bounded the shell's composer slot: `app-shell/composer-slot-cap-model.ts` |
| T347 | `be5bf36` | Made a validation-blocked submit button pressable so it can say why       |
| T348 | `b12b7f0` | Re-synced `expo-linking`'s npm-audit baseline range                       |
| —    | `af33662` | Ticked the eleven dispatch boxes above                                    |

### 2.1 T346 — why shard-4 was really failing

`HANDOFF.md` §5 offered Option A (redesign) and Option B (a composer-slot cap). Option B was
taken, but **§5.1's diagnosis was incomplete** and worth correcting for the record: the panel
was not merely "below the fold of the pinned area". The Maestro hierarchy dump for the failing
step shows the `-sections` node **absent from the hierarchy entirely** — a node wholly outside
its scroll viewport is pruned, not reported zero-height. Measured from that dump (1080×2400
emulator, 2138px shell): header 297px, status strip 127px, transcript **0px**, pinned area
608px, composer **1106px**. The panel card was clipped at the pinned area's bottom edge
(y=1168) and `panel.tsx`'s `${testId}-sections` `ScrollView` begins ~25px below it.

Neither T343 nor T344 could have fixed this: both apply `resolveComposerMinHeight` to the
composer's own root, one level _inside_ the shell's composer slot, so the slot kept its full
natural height while the pinned slot absorbed every pixel of overflow.

T346 bounds the slot in **both** directions, because either bound alone is unsafe:

- `resolveComposerSlotMaxHeightDp` — 320dp or 0.32 of the window, whichever is smaller, applied
  **only while the pinned area is actually drawing**. An idle session keeps the old layout
  exactly, so no flow that drives the composer's controls with nothing pinned is affected.
- `resolveComposerSlotMinHeight` — lifts the composer's own measured floor (plus the slot's
  padding) onto the slot. This is what makes the cap safe at any value: Yoga resolves a
  `minHeight` that exceeds a `maxHeight` in favour of the `minHeight`, so the cap can never
  squeeze the prompt bar under the keyboard. That mattered: the same flow types and sends with
  both cards still pinned, and the green run proves it.

`Composer.tsx` gained an optional `onMinHeightChange`; the session route resolves the cap from
the live `useWindowDimensions().height` and the live `resolvePinnedAreaVisibility`.

### 2.2 T347 — the defect T346 uncovered one step later

With T346 in, shard-4 advanced seven steps and failed on
`assertVisible text: "Fix 1 field before submitting."`. `buildFormActionsModel` set
`disabled: pending || !gate.allowed`, so the submit button was inert in exactly the case
`form.tsx`'s press-to-reveal gate exists to explain. A disabled `Button` never fires `onPress`,
so the per-field errors and the summary were **unreachable code**, while the `blocked` flag the
model computed for the view was never read by it. `disabled` now means "a dispatch is in
flight" and nothing else. Android-only — `apps/web`'s form renderer has no submit gate at all.

### 2.3 T348 — an audit failure that was not ours

`guard / npm audit findings stay inside the documented baseline` went red on a commit that
touched no dependency. Upstream re-published the `expo-linking` advisory with its trailing
`58.0.0-canary-…` arm removed. The guard reports such a change twice in one run — as an
unbaselined advisory _and_ as a stale entry — which is the fingerprint of a re-published range,
not a new finding. **If you see that double-report, this is what it is.** A narrowing is safe
and needs no owner; a widening that starts covering the installed version is a new acceptance.

Left undone on purpose: the guard also NOTES that the `expo-audio` baseline entry is now stale.
Pruning it pulls in `docs/security-and-version-drift.md`'s counted prose ("35", "28 are the
Expo/React Native toolchain"), which is a separate change with its own risk of leaving a stale
figure behind. It belongs to a task that owns that document.

---

## 3. Process lessons — these cost a red CI run each

Also recorded in `memory.md`.

- **`npx vitest run apps/android/src/...` is NOT the CI gate.** CI runs
  `npm test --workspace=@picompanion/android`, which also covers
  `apps/android/e2e/flows/*.contract.test.ts`. T346 added a prop to the route's
  `<Composer …/>`; **three** tests pin that attribute list verbatim, and a `src/`-scoped run
  sees only one of them. Run the workspace script before pushing anything under `apps/android`.
- **Run `oxfmt` BEFORE the final test pass, never after.** A new source-regex test passed, then
  `oxfmt` reflowed the `usePiUiElements(` call it pinned across three lines, and the un-re-run
  test went red on CI. Write such pins tolerant of wrapping (`\s*` between arguments).
- **Maestro reports a tap on a DISABLED node as COMPLETED.** So a flow fails at the _assertion
  after_ the tap, not at the tap, and the tap step looks fine in the log. When an
  `assertVisible` fails right after a `tapOn`, read the tapped node's `enabled` attribute in the
  hierarchy dump before suspecting the assertion. That is exactly how T347 was found.
- **A node entirely outside its scroll viewport is PRUNED from the hierarchy**, not reported as
  zero-height. "id not visible" can mean "clipped", not "never rendered". Check the parent's
  bounds.
- **Read the hierarchy dump; it settles layout arguments in one step.** Download with
  `gh run download <run-id> -D <dir>`, then look in
  `maestro-debug-shard-N/.maestro/tests/<ts>/<flow>/screen-hierarchy/step-NNN-*.json`. Every
  node carries `bounds`, `enabled`, `clickable`. T346 was diagnosed from bounds arithmetic alone.

---

## 4. The design spec — the artifact's real CSS is now extracted

**`s7-spec.txt` (named in `HANDOFF.md` §11) does NOT contain the artifact's CSS** — its
`##### CSS (artifact <style>, lines 8-431)` section holds only the wrapper reset line. The
component stylesheet had to be pulled out of the raw artifact HTML. Two files now hold it:

- `…/scratchpad/s7-css.txt` — the full 35 KB stylesheet.
- `…/scratchpad/s7-css-core.txt` — 141 rules for the S7 components plus all 13 `@keyframes`.

Scratchpad root:
`C:\Users\aksha\AppData\Local\Temp\claude\D--pi-companion\7bcadfde-91e4-4fea-a456-fd9c785a50c4\scratchpad\`

If those are gone, regenerate from the raw artifact (the `<style>` blocks are JSON-escaped):

```bash
node -e "const fs=require('fs');let h=fs.readFileSync(process.argv[1],'utf8');
const m=h.match(/<style[^>]*>([\s\S]*?)<\/style>/g);
fs.writeFileSync('s7-css.txt', m.map(s=>s.replace(/<\/?style[^>]*>/g,'')).join('\n').replace(/\\\\n/g,'\n'));" \
"C:/Users/aksha/.claude/projects/D--pi-companion/7bcadfde-91e4-4fea-a456-fd9c785a50c4/tool-results/artifact-f8701c46-1788884434-107a.html"
```

**Token mapping is confirmed to line up with T345's work** (checked against the real CSS):
`--usr-bg` = `field`, `--tool-pend` = `inset`, `--tool-ok` = `tool-success-bg`,
`--tool-err` = `tool-error-bg`, `--ext-bg` = `extension-bg`, `--r-blk` = 14, `--r-full` = 9999.
The artifact's CSS px map 1:1 onto dp (its reference device is 412px wide).

**Use our tokens, not the artifact's raw values.** T54A1 deliberately moved `ink-3`, `accent`
and `red` off the artifact's figures to clear WCAG AA, and `plan.md` §10.2 forbids raw hex.

---

## 5. Next Step 2 — the UI work, with two ordering hazards found the hard way

`HANDOFF.md` §9's task table still stands, but renumber from **T349** (T346–T348 are used), and
mind these two hazards, neither of which is in `HANDOFF.md`:

### Hazard 1 — do not move Files/Terminal before the Live screen exists

`HANDOFF.md` decision #6 moves Files and Terminal into the Live (A2) screen.
`apps/android/maestro/files-and-terminal.yaml` (shard-5, currently green) reaches them via
`session-nav-actions-files` / `-terminal` **on the session screen**. Moving those testIDs to a
screen that does not exist yet breaks shard-5. Do the Live route, the relocation, the `⧉`
button and the flow + contract update **in one task**, or leave `SessionNavActions` where it is
until that task runs. For the same reason the app bar's `⧉` button has nowhere to navigate
until then.

### Hazard 2 — `testing.primitiveLabManifest` is shared by BOTH apps

`packages/frontend-core/src/testing/fixtures/primitive-lab.ts`'s `primitiveLabManifest` is
asserted by `apps/web/src/dev/component-lab.test.ts` **and**
`apps/android/src/dev/component-lab.test.ts`. Adding a name to it obliges a **web** twin to
exist. Nothing asserts the reverse direction, so an Android-only component may live in
`ui/primitives/` and stay out of the manifest — but say so in its doc comment, so the omission
reads as a decision rather than an oversight. Same shape for `recipeLabManifest`.

### Other constraints that still hold

- Every testID a Maestro flow or contract test names today must survive, attached to the new
  element playing the same role (`HANDOFF.md` decision #5). Change source and contract together.
- `Composer.tsx` must not import `Modal`; `composer-accessibility.test.ts` holds many
  source-regex pins; `touch-targets.test.ts` audits every pressable for 48dp.
- Register a `CAPABILITIES` entry per shipped capability and prove it fires
  (`HANDOFF.md` §9.1, `CLAUDE.md`'s T124 section). T346's entry is a worked example of the
  T168 same-file AND-group shape.
- The seven "Geist Mono" comments in `HANDOFF.md` §9.3 are still unfixed.

---

## 6. Working tree at hand-off — READ THIS BEFORE YOUR FIRST GATE

`git status` is **not clean**. Three files, none of them committed:

```
 M apps/android/package.json      # react-native-svg 15.12.1 pin, still uncommitted
 M package-lock.json              # ditto
?? apps/android/src/ui/primitives/StatusPill.tsx
```

- The **`react-native-svg` install** is the same pending change `HANDOFF.md` §1 describes.
  Nothing imports it yet. Commit it in the first commit that does (it is needed for the context
  ring, the sparkle, and the plus/mic/send icons). Until then, `git stash push -- apps/android/package.json package-lock.json`
  before running the T93 clean-tree guard, and `git stash pop` after — that is how every commit
  above was gated.
- **`StatusPill.tsx` is unfinished scaffolding from an abandoned T349.** It is written and
  believed correct (the artifact's 26dp pill: tinted background, tone-coloured text, optional
  6dp dot, no border, no pulse — with its reasoning in its own doc comment), but it is **not
  exported from `ui/primitives/index.ts`, not used by anything, and has no test**. Either
  finish it as part of the app-bar task or delete it. Do not leave it as-is.

The abandoned T349 was going to be: replace `TranscriptHeader`'s look with the artifact's
`.bar` (☰ → sessions, title `pi-companion`, mono subtitle, the pill keeping
`transcript-header-status-chip`), extend `header-model.ts` rather than add a parallel model
(it would orphan otherwise), and take the subtitle's cwd from a new `resolveAgentSnapshotClient`
in `app-shell/session-route-daemon-clients.ts` following the six existing resolvers there
exactly. No flow or contract pins the header today — checked — so it is free to restyle.

---

## 7. First actions for whoever picks this up

1. `git rev-parse --short HEAD`, `git status --short`, and read CI run `34525220309`.
2. Decide `StatusPill.tsx`: finish or delete. Get `git status` clean before any gate.
3. Start the S7 UI work from §5, renumbering from T349, one commit + ledger row + section per
   task, pushing and reading the real CI run each time.
4. Re-dispatch `android-maestro-e2e.yml` after the UI work and keep all five shards green.
   Never write code while a dispatch is in flight.
