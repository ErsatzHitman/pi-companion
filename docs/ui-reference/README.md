# UI reference mockups

Two self-contained HTML pages showing what the Companion's two surfaces look
like and how they move. Open either one directly in a browser — no build step,
no server, and no network beyond Google Fonts.

| File                                               | Surface | Screens                                                                                  |
| -------------------------------------------------- | ------- | ---------------------------------------------------------------------------------------- |
| [`pi-companion-app.html`](./pi-companion-app.html) | Android | Chat, Sessions, Live, Settings, plus the five extension detail screens Settings links to |
| [`pi-companion-web.html`](./pi-companion-web.html) | Web     | One desktop console with Sessions, the transcript and Live visible together              |

## What these are, and what they are not

**They are a picture of the intended UI, not a second implementation of it.**
Nothing here is imported, bundled, tested, or served. `apps/android` and
`apps/web` are the product; when one of them and a page here disagree, the app
is right and the page is stale. Never cite a file in this directory as
authority for how a screen behaves — read the component, or `plan.md`.

They exist because a still screenshot cannot carry motion, and most of what
distinguishes these two surfaces is motion: how a turn arrives, how a tool
block resolves, how the todo ring fills, how the context ring reacts to a
compaction. A reviewer can watch a whole turn play instead of imagining one.

## What they are faithful to

- **Colour** is `packages/design-tokens/src/tokens.ts` — `beautifulLight` and
  `beautifulDark`, including both shadow sets, copied value for value. Both
  pages honour all three theme states (explicit light, explicit dark, and the
  unstamped default that follows the OS).
- **Motion** follows the same sources the Android surface does: text streams at
  2 characters every 9ms with a 6-character blur tail and a solid caret while
  streaming, and trace rows arrive on `fade-up 320ms cubic-bezier(.23,1,.32,1)`
  staggered 120ms.
- **The composer carries the owner's amendment**: there are no mode, model,
  effort or context pills above the prompt bar. A context ring sits immediately
  right of the attachment button, fills with the window in use, and opens the
  Mode, Model & effort, Queue and Context controls — the same four groups
  `apps/android/src/features/composer/PromptControlsMenu.tsx` ships.

## The session data is invented

Every session, subagent, file path, diff and test count in these pages is made
up for the mockup. `phase3/t25a — web primitives`, `ui-implementer`,
`packages/ui/src/Button.tsx` and the rest name nothing in this repository. They
are written to read like a real session because a mockup full of placeholder
text shows nothing; they are not a record of anything that happened.

## Two conventions a future audit should not re-litigate

- **`Badge.tsx:14:` and `-38`/`+38` inside these pages are not citations.**
  They are rendered grep output and diff hunk content — the display a tool
  block produces — which is the fixture-content class `CLAUDE.md`'s T272
  section separates from real line-number citations. The rule against citing
  shipped source by line number applies to prose a reader trusts as true
  today; it does not reach a mockup of a terminal showing a line number.
- **These two files are exempt from `oxfmt`**, named in `.oxfmtrc.json`'s
  `ignorePatterns` as `docs/ui-reference/*.html`. This is not a convenience.
  Transcript lines are `white-space: pre-wrap`, because a mockup of a terminal
  has to keep the runner's own indentation (`  Test Files  1 passed (1)`), and
  the formatter reindents the static lines on the extension screens — which
  `pre-wrap` then renders as visible leading space. Formatting these files
  changes what they show, so they are not formatted. Every other file in the
  repository still is.
- **These pages are inside `guard-capability-prose`'s denial scan**, because
  `isAppSourcePath` admits `docs/**`. Anything written here asserting that a
  shipped capability is missing is a defect the guard will catch, the same as
  in any other document. Keep the copy descriptive.
