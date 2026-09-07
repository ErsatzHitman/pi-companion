# Android TalkBack pass — procedure and status

`plan.md` §10.5: "Android receives a manual TalkBack pass for every release candidate."
Task T44A2's acceptance criterion: "An Android TalkBack pass is recorded for the release
candidate."

## Status today: no pass has been run. This is a recorded procedure, not a recorded result.

A TalkBack pass needs a real Android device or emulator with TalkBack switched on, and an
installed build to run it against. Neither exists in this environment:

- **No device or emulator.** `apps/android/maestro/README.md`'s "What T37D proved, and what it
  did not" has said since Phase 5 that this repository's agent environment has never had an
  emulator, a device, or the Maestro CLI installed. Nothing changed that for this task.
- **No release-candidate build to test against yet.** `docs/issues-from-plan.md`'s wave table
  runs T44A2 (this task, `P9-W2`) _before_ T44B1 ("Produce the signed APK", `P9-W5`) — the task
  that actually produces "the release candidate" this criterion names. A TalkBack pass "for the
  release candidate" cannot honestly be recorded before that candidate exists. This procedure is
  written now so the pass itself is a checklist, not a design exercise, whenever both T208
  (below) and T44B1 have landed.
- **The blocker is already filed and owner-gated, not something this task can clear.**
  `docs/issues-from-plan.md`'s T208 ("Owner-gated: configure `EXPO_TOKEN` and confirm the
  emulator action boots here") is explicit that this "cannot be cleared by an agent" — it needs
  an Expo account with EAS build access and a real dispatched run of
  `.github/workflows/android-maestro-e2e.yml` to learn whether GitHub's `ubuntu-latest` runners
  even have KVM support for `reactivecircus/android-emulator-runner`. Until T208 closes, that
  workflow (and `android-apk-release.yml`, which the T44B1 signed APK depends on) dry-runs with a
  logged notice instead of executing.

No Maestro flow, no unit test, and no contract test anywhere in this repository is a substitute
for this. The rest of this document is split into (1) what a human running an actual TalkBack
pass should do once a build and a device exist, and (2) what is already checked automatically,
without a device, today.

## Part 1 — the manual pass, to run against each release candidate

### Prerequisites

1. A physical Android device or emulator with TalkBack installed (built into stock Android;
   enable it under Settings → Accessibility → TalkBack).
2. The release-candidate build under test — the signed APK T44B1 produces, or (for an interim
   check before a signing pipeline exists) `sh.picompanion.debug` built per
   `apps/android/maestro/README.md`'s prerequisites (`npm run android:development
--workspace=@picompanion/android`).
3. `adb devices` lists exactly one device in the `device` state.

### Screens and controls to walk, and what a pass means for each

This list mirrors the same critical-control set `apps/android/maestro/accessibility-audit.yaml`
(T37E10) already samples mechanically (see Part 2) — the manual pass is that same walk, done by
a human with TalkBack actually speaking, which is the one thing nothing in this repository can
simulate.

| Screen / control                                     | What to do                                         | Pass criterion                                                                                                                                                                        |
| ---------------------------------------------------- | -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Onboarding — welcome step                            | Swipe to the "Get started" button                  | TalkBack announces "Get started, button" (or platform-equivalent phrasing) — never silence, never just "button"                                                                       |
| Onboarding — permissions step                        | Swipe to the "Continue" button                     | Same: a real, specific spoken label                                                                                                                                                   |
| Connect form — address field                         | Swipe to the host-address field, then submit empty | The field's label is announced; after the validation error, TalkBack announces the field's label _and_ the new error text (a live update, not a silent visual-only change)            |
| Connect form — submit button                         | Swipe to "Add host" / "Connect"                    | Announced by its visible label                                                                                                                                                        |
| Composer — message input                             | Swipe to the message field                         | Announced as "Message" (or "Message <agent>")                                                                                                                                         |
| Composer — mic button                                | Swipe to the microphone icon                       | Announced as "Record voice message" — this control's glyph is icon-only, so this is the ONLY way its purpose reaches a screen-reader user                                             |
| Composer — attach button                             | Swipe to the attachment icon                       | Announced as "Add attachment", same reasoning as the mic button                                                                                                                       |
| Composer — send, and the turn's status after sending | Send a message, then swipe to the transcript entry | The entry's status (e.g. "Failed", "Sent") is announced as text, not conveyed by color alone; a live region announces the status change without the user needing to re-find the entry |
| Session rail rows / session list                     | Swipe through the list of sessions                 | Each row announces a real, distinguishing label (not "button" repeated identically for every row)                                                                                     |
| Any screen reachable from the tab bar / navigation   | Swipe through the full navigation                  | Every destination announces a real name; nothing is silent or generically "tab"                                                                                                       |

For each row above, record: pass / fail, the exact phrase TalkBack spoke (or "silent" if it said
nothing), and the OS/TalkBack version used.

### What counts as a failure

- A control TalkBack never lands on when swiping through in reading order (it is not in the
  accessibility tree at all).
- A control that is reachable but announced with no meaningful label ("button", "image", or
  nothing).
- A status or state change (turn failed/sent, form validation error, connection lost) that is
  only conveyed visually (color, icon change) with nothing spoken.
- A touch target TalkBack's focus rectangle renders substantially smaller than the visible
  control — a proxy for the 48dp minimum plan.md §10.5 requires, not a replacement for measuring
  it directly if a discrepancy is suspected.

### Where to record the result

Append a dated entry to this file (below, in "Pass log"), naming: the git commit / release tag
tested, the device or emulator and its Android + TalkBack version, the table above filled in,
and any failures filed as new tasks (never silently worked around here).

## Part 2 — what is already checked automatically, without a device, today

Automatable ≠ a TalkBack pass. Everything below is real, existing, already-committed coverage —
none of it is new work by this task — and every one of it stops short of actually driving
TalkBack's speech engine, which is exactly why Part 1 still exists.

- **`apps/android/maestro/accessibility-audit.yaml` (T37E10).** A Maestro flow that walks the
  same screens/controls as the table above and asserts (via `assertVisible: { text: "..." }`)
  that each critical control's `content-desc` (an RN `accessibilityLabel` compiles to exactly
  this attribute) carries the expected string — real proof the label reaches the accessibility
  tree TalkBack reads from, though not proof of what TalkBack's synthesizer actually says. Like
  every other flow in that directory, it has never been run against a device (same T208 blocker
  as above).
- **`apps/android/e2e/flows/accessibility-audit.contract.test.ts` and
  `accessibility-audit-contract.ts` (T37E10).** Runs today, with `node --test`-free `vitest`, no
  device needed. Proves the Maestro flow above is not aspirational: every `testId`/label string
  the flow names is matched, comment-stripped and anchored, against the real component source
  that declares it (`Composer.tsx`, `composer-icon-action.tsx`, `Button.tsx`, `TextField.tsx`,
  `OnboardingGate.tsx`, `ConnectForm.tsx`, and the RN-free `composer-model.ts`/
  `connect-form-model.ts` functions called directly). This is the accepted "static-contract"
  substitute this repository uses everywhere a real device is unavailable — see that test file's
  own doc comment for the full mechanism and its disclosed gaps (what is NOT sampled: real voice
  capture, real attachment picking, share intent, the files screen's upload/download controls,
  and Pi UI panel elements — each named there with the specific reason it is unreachable today).
- **`apps/android/src/ui/primitives/touch-targets.test.ts`.** A standing audit that every shared
  primitive declares a `minHeight`/`minWidth` of at least 48 on its touchable element — the
  automatable half of the 48dp requirement, for every primitive this audit reaches. (It uses an
  OR of the two dimensions, not an AND — a control satisfying only one of the two still passes;
  that is this existing check's own predicate, unchanged by this task.)
- **Non-color status text.** Several features carry their own tests asserting a status is
  represented as real text, not color alone, including `apps/android/src/features/composer/
composer-accessibility.test.ts` and `composer-model.test.ts` (turn status labels),
  `apps/android/src/features/extensions/renderers/status-model.ts`/`tone.ts` (extension status
  tone mapped to a text label, not just a color), and `apps/android/src/features/sessions/
sessions-model.ts` (session status). None of these are new; they are cited here as the
  automatable evidence for that row of the manual-pass table.
- **Stable test identifiers.** Every control named in the manual-pass table above already
  carries a stable `testID` the Maestro flow and its contract test both key off of (e.g.
  `composer-input`, `composer-mic`, `composer-attach`, `connect-form-address-field`,
  `connect-form-submit-button`) — the plan.md §10.5 "stable test identifiers for critical flows"
  requirement, satisfied for exactly the controls this document's table covers.

None of the above exercises TalkBack's actual speech synthesis, its reading order on a real
device, or how it behaves across the specific OS/TalkBack version combinations real users run —
that is Part 1's job, and Part 1 has not been run.

## Pass log

_(Empty. No manual TalkBack pass has been recorded as of this writing. Add an entry above this
line, never below it, each time one is run.)_
