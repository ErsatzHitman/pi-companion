# Beautiful UI — visual language reference

Extracted 2026-09-01 from the live site's published CSS. This is the authoritative
description of the visual language the whole product must match (plan §10).

## Source and licence

- Canonical source: **https://www.beautifului.dev/** — "Beautiful UI — Crafted primitives
  for AI-native interfaces". Built by Turbo (https://turbodesign.co/).
- Self-described as "a small library of extremely crafted, copy-paste components for chat
  agents, thinking states, human-in-the-loop approvals".
- Stack observed: Next.js + Tailwind CSS v4.3.3, Inter (sans) + Geist Mono (mono).
- **Licence: MIT, Copyright (c) 2026 Shane Levine** (https://www.beautifului.dev/license).
  MIT is compatible with this project's AGPL-3.0-or-later; adapted code may be incorporated
  **provided the MIT notice is retained**. The verbatim notice is recorded in
  `THIRD_PARTY_NOTICES.md` §2. Any file containing adapted Beautiful UI code must carry an
  attribution header and a row in that file.
- Historical correction: `THIRD_PARTY_NOTICES.md` previously aimed the Beautiful gate at
  `D:\paseo\packages\app\src\ui\beautiful\` — the abandoned fork's derivative copy — and
  asserted it was "not an external third-party design library". That was wrong on both
  counts and has been replaced.

## What the plan already got right

`plan.md` §10.4 names eleven recipes that map one-to-one onto this library's components, and
its "do not rebuild" list (CRM tables, recommendation cards, insight dashboards, context
stacks) is exactly components 12, 09, 17 and 10. Component SELECTION was captured correctly.
Only the visual language was missing.

## The 20 components

01 Loading State · 02 Thinking · 03 Streaming Text · 04 Approval Card · 05 Tool Chips ·
06 Task Rows · 07 Chat · 08 Prompt Bar · 09 Recommendation Card · 10 Context Cards ·
11 Diff Table · 12 Records Table · 13 Filter Table · 14 Sidebar Nav · 15 Search ·
16 Flowchart · 17 Insight Cards · 18 Code Block · 19 Fine-tune Card · 20 Selection Actions

Note component **14 Sidebar Nav** — directly relevant to our left rail, and not currently
named in plan §10.4.

## Tokens — the real values

Semantic names are meaningful and should be adopted verbatim, replacing our numeric neutral
ramp. Surfaces stack `page → canvas → surface → inset → field`; text ramps `ink → ink-2 → ink-3`.

### Dark theme (the default; `.dark` class, defaults on)

| token                 | oklch                     | hex         |
| --------------------- | ------------------------- | ----------- |
| page                  | oklch(20.9% .004 264.477) | `#17181a`   |
| canvas                | oklch(23.1% .004 264.487) | `#1c1d1f`   |
| surface               | oklch(26% .006 271.191)   | `#232427`   |
| inset                 | oklch(24.3% .004 264.492) | `#1f2022`   |
| hover                 | oklch(28.9% .006 271.22)  | `#2a2b2e`   |
| hover-2               | oklch(31.8% .007 274.747) | `#313236`   |
| field                 | oklch(29.3% .006 271.223) | `#2b2c2f`   |
| ink                   | oklch(96.4% .002 247.839) | `#f2f3f4`   |
| ink-2                 | oklch(73.1% .008 260.731) | `#a5a8ad`   |
| ink-3                 | oklch(54.1% .01 264.484)  | `#6c6f75`   |
| line                  | oklch(30.8% .006 258.354) | `#2e3033`   |
| line-strong           | oklch(35.6% .007 264.474) | `#3a3c40`   |
| line-soft             | oklch(27.8% .006 258.354) | `#27282b`   |
| accent                | oklch(68% .173 253.301)   | `#3d9aff`   |
| accent-ink            | oklch(78.8% .113 248.33)  | `#7ec0ff`   |
| accent-tint           | accent @16% alpha         | —           |
| green                 | oklch(70.5% .154 153.814) | `#3cbb72`   |
| orange                | oklch(74.6% .156 55.642)  | `#f68f3c`   |
| red                   | oklch(66.6% .18 21.433)   | `#ee5c61`   |
| green/orange/red-tint | same hue @14% alpha       | —           |
| tooltip-bg            | oklch(18.2% .004 264.459) | `#111214`   |
| tooltip-fg            | oklch(96.4% .002 247.839) | `#f2f3f4`   |
| tooltip-muted         | oklch(73.1% .008 260.731) | `#a5a8ad`   |
| tooltip-border        | oklch(30.8% .006 258.354) | `#2e3033`   |
| stripe                | oklch(100% 0 0/.055)      | white @5.5% |
| stripe-bg             | oklch(22.6% .004 264.485) | `#1b1c1e`   |

### Light theme

| token          | oklch                     | hex        |
| -------------- | ------------------------- | ---------- |
| page           | oklch(98.5% .001 286.376) | `#fafafb`  |
| canvas         | oklch(96.1% .002 247.84)  | `#f1f2f3`  |
| surface        | oklch(100% 0 0)           | `#ffffff`  |
| inset          | oklch(97.9% .002 247.839) | `#f7f8f9`  |
| hover          | oklch(97% .002 247.839)   | `#f4f5f6`  |
| hover-2        | oklch(93.3% .003 247.86)  | `#e7e9eb`  |
| field          | oklch(96.1% .001 286.375) | `#f2f2f3`  |
| ink            | oklch(24.7% .006 258.361) | `#1f2124`  |
| ink-2          | oklch(50.6% .01 264.477)  | `#62656b`  |
| ink-3          | oklch(69.5% .009 264.505) | `#9a9da3`  |
| line           | oklch(94.6% .003 264.542) | `#ecedef`  |
| line-strong    | oklch(91.2% .005 258.326) | `#e0e2e5`  |
| line-soft      | oklch(96.6% .002 264.542) | `#f3f4f5`  |
| accent         | oklch(62.6% .205 254.947) | `#0285ff`  |
| accent-ink     | oklch(55.6% .187 255.617) | `#0070dd`  |
| accent-tint    | oklch(96% .019 252.878)   | `#e9f3ff`  |
| green          | oklch(60.3% .155 150.883) | `#199a4d`  |
| green-tint     | oklch(95.8% .017 159.118) | `#e8f5ed`  |
| orange         | oklch(68.9% .179 49.902)  | `#ef720d`  |
| orange-tint    | oklch(96.4% .021 67.581)  | `#fdf1e5`  |
| red            | oklch(62.1% .192 23.042)  | `#e3474c`  |
| red-tint       | oklch(95.6% .017 17.462)  | `#fcecec`  |
| tooltip-bg     | oklch(27.2% .008 264.435) | `#25272b`  |
| tooltip-fg     | oklch(97.6% .002 247.839) | `#f6f7f8`  |
| tooltip-muted  | oklch(73.1% .008 260.731) | `#a5a8ad`  |
| tooltip-border | oklch(35.6% .007 264.474) | `#3a3c40`  |
| stripe         | oklch(40.5% 0 0/.075)     | grey @7.5% |
| stripe-bg      | oklch(97% 0 0)            | `#f5f5f5`  |

Note the structural difference between the themes: **light tints are near-white solid fills,
dark tints are alpha overlays of their own hue** (accent-tint @16%, status tints @14%).

> Every role above is an extracted published value, for both themes. An earlier revision of
> this document listed only a subset of the light theme and described the remainder
> qualitatively; the Phase 3.5 exit verifier correctly flagged that those roles were being
> implemented as approximations. They are now recovered from source and must be applied.

**Key correction to our original tokens:** our dark background was `#05070a` (near black).
Beautiful UI's is `#17181a` — a warm charcoal, significantly lighter, with surfaces stepping
UP to `#232427`. The original palette was too contrasty and too blue-black.

## Shape, shadow, type, motion

- **Radii:** chip 6px · control 8px · card 10px · window 14px · pills fully round.
- **Shadows are rings, not blurs.** `--shadow-hairline: 0 0 0 1px var(--line)` is the
  workhorse, identical in both themes.
  - Dark: `--shadow-btn: 0 0 0 1px oklch(100% 0 0/.1), 0 1px 2px oklch(0% 0 0/.3)`;
    `--shadow-card: 0 0 0 1px white/.11, 0 1px 2px black/.2, 0 2px 6px black/.2`;
    `--shadow-raised: 0 0 0 1px white/.13, 0 2px 10px black/.22`;
    `--shadow-overlay: 0 0 0 1px white/.15, 0 8px 28px black/.34`;
    `--shadow-inset-field: inset 0 1px 2px black/.4`.
  - Light composes the same ring with Tailwind's default blur scale:
    `--shadow-btn: 0 0 0 1px var(--line-strong), var(--shadow-xs)`;
    `--shadow-card: 0 0 0 1px var(--line), var(--shadow-sm)`;
    `--shadow-raised: 0 0 0 1px var(--line), var(--shadow-md)`;
    `--shadow-overlay: 0 0 0 1px var(--line), var(--shadow-lg)`;
    `--shadow-inset-field: inset 0 1px 2px oklch(0% 0 0/.12)`.
- **Fonts:** Inter for UI, **Geist Mono** for all numerals, paths, keys and log lines,
  with `tabular-nums` on counters and timers. Both must be **self-hosted and bundled** —
  naming them in the token layer is not enough, since neither ships with Windows, macOS or
  Android, and the UI then silently falls back to a system face. Both are OFL licensed and
  need a `THIRD_PARTY_NOTICES.md` row when vendored.
- **Type scale is small:** 10.5, 11, 11.5, 12, 12.5, 13px dominate; section titles 13px/600;
  page heading 21px/600 with `tracking-[-0.02em]`. Body line-height relaxed (1.625).
- **Motion:** signature easing `cubic-bezier(.23,1,.32,1)` (`ease-out-strong`); also
  `(.77,0,.175,1)` and link ease `(.16,1,.3,1)`. Durations 100/150/200/300/400ms;
  section entrance `fade-up 600ms`. Buttons `active:scale-[0.96]`.

## Signature traits to reproduce

1. **Dashed hairline dividers** (`border-dashed border-line`) between sections — the single
   most recognisable trait.
2. **1px ring outlines** instead of drop shadows on nearly every surface.
3. **Shimmer-gradient text** for live states: a moving
   `linear-gradient(90deg, ink-3 35%, ink 50%, ink-3 65%)` clipped to text, 1.4s linear —
   used on "Thinking" and "Churning".
4. **Pixel-grid loader:** 3×3 grid of 4px squares, 1.5px gaps, each blinking on a staggered
   650ms cycle, with a mono elapsed-time readout beside it.
5. **Segmented pill toggles:** `bg-field` track, `bg-surface` + `shadow-btn` thumb sliding
   with the signature easing.
6. **Mono ordinals** — small `01`, `02` numbers in Geist Mono with tabular figures.
7. **Very tight control sizes:** 24–28px icon buttons, 13–15px icons, 6–8px padding.
8. **Hover affordances fade in** rather than appearing instantly.
9. **Animated underline** on links rather than a static underline.
10. **Restraint:** no gradients on surfaces, no glow, no glass/blur in the main components.

## The standing consistency rule

This library defines the visual language for **the entire product**, not only for the
components it happens to ship. Any component we build that has no Beautiful UI counterpart —
the session rail, the right-hand Pi extension rail, the context-window meter, settings, the
terminal chrome — must still read as though it came from the same library: same surface
stack, same hairline rings, same dashed dividers, same type scale, same easing.

## Re-skin work (Phase 3.5 tasks)

- **T13B — retoken.** Rewrite `packages/design-tokens` to this semantic structure and these
  values, both themes, keeping the existing web CSS-variable and native theme-object outputs.
  Map old names to new so nothing silently breaks.
- **T25C — web conformance.** Restyle every primitive and recipe in `apps/web/src/ui` to the
  new tokens: ring shadows, dashed dividers, small type, Geist Mono numerals, the easing.
  Also clears the three raw hex values still in `apps/web/src/styles/global.css` and the one
  in `apps/web/src/features/connection/connection-status.tsx` (Phase 3 exit criterion that
  was not met).
- **T26C — Android conformance.** Same for `apps/android`, honouring the 48dp touch minimum.
  Their web control sizes (24–28px) are too small for touch: scale the touch target up while
  keeping the visual size and language intact.

## WCAG AA contrast pass (T54A1)

Beautiful UI's published palette above is the reference this product re-skinned to (T13B/T13C).
A real-browser axe run in Phase 4 batch F found it fails WCAG AA (4.5:1 for normal text) — jsdom
axe never caught this because jsdom does not compute real contrast. **User decision, 2026-09-03:
accessibility wins over byte-exact fidelity to Beautiful UI.** T54A1 nudges the smallest possible
set of token values off the published hex to clear AA everywhere a color is actually painted as
text, keeping hue and saturation unchanged and adjusting lightness only. `packages/design-tokens`
is the single source of truth for both `apps/web` and `apps/android`, so this table is the
complete deviation from the tables above — nowhere else in the product carries a raw hex product
color.

Every ratio below is the standard WCAG relative-luminance contrast formula
(https://www.w3.org/TR/WCAG21/#dfn-relative-luminance), asserted programmatically by
`packages/design-tokens/src/contrast.test.ts` against every background the token is actually
painted on in `apps/web`/`apps/android` (not only the pairs the first axe run happened to
render): the `page → canvas → surface → inset` content backdrops, the `field` and `hover`
interactive-state fills, each status tone's own tint (chip/toast/badge text — dark theme tints are
alpha overlays, composited over the backdrop before measuring, since that's what a browser
renders), the solid `accent`/`red` fills under primary/danger button text, and `tooltip-bg`.

`field` and `hover` were excluded from the first pass of this audit on the belief that only `ink`
is ever painted on them. That was wrong, and it let dark `ink-3` ship at 4.08:1: the Android text
primitives pass `theme.colors["ink-3"]` as `placeholderTextColor` on an input whose background is
`theme.colors.field` (`TextField.tsx`, `TextArea.tsx`, `SearchField.tsx`,
`CommandSearch.tsx`, `PromptBar.tsx`, all via their `placeholderTextColor` prop). The matrix now covers every role against every
backdrop it can be painted on. `hover-2` is the sole exclusion, because nothing is painted on it
at all — `grep -rn "hover-2" apps/web/src apps/android/src` returns nothing.

### Dark theme

| token             | old (published) | new       | worst-case ratio, old                                                      | worst-case ratio, new    | why                                                                                                       |
| ----------------- | --------------- | --------- | -------------------------------------------------------------------------- | ------------------------ | --------------------------------------------------------------------------------------------------------- |
| `ink-3`           | `#6c6f75`       | `#92959b` | 2.77:1 (text on `field`)                                                   | 4.65:1 (text on `field`) | axe measured 3.53:1 on `page`; auditing every backdrop found `field` far worse (Android placeholder text) |
| `accent`          | `#3d9aff`       | `#4da3ff` | 4.20:1 (own 16%-alpha tint, composited over `surface`, as chip/toast text) | 4.54:1                   | not caught by axe at all — only found by compositing the alpha tint over every realistic backdrop         |
| `red`             | `#ee5c61`       | `#f17579` | 3.93:1 (own 14%-alpha tint, composited over `surface`, as chip/toast text) | 4.53:1                   | same as `accent`, for the danger tone                                                                     |
| `green`, `orange` | unchanged       | unchanged | 4.97:1 / 5.15:1 (composited tint over `surface`, the worst case)           | —                        | already clear AA everywhere audited; no change                                                            |

Dark theme's solid-fill button text (`accentContrast`/`textInverse`, used by the primary button's
`accent` background and Android's danger button's `red` background) was axe-measured at 2.72:1
(white-on-accent) and computed at 3.12:1 (white-on-red) — both fail. Lightening `accent`/`red`
further to fix this would have fought the (opposite-direction) fix the alpha-tint text above
needed, so instead the dark theme's on-fill text switched from near-white to `page` (`#17181a`,
already in the palette — no new hex): `page`-on-`accent` measures 6.77:1 and `page`-on-`red`
measures 6.40:1, both comfortably clearing AA without moving the fills at all. `green`/`orange`
aren't used as solid-fill backgrounds anywhere in the product, so they didn't need this.

### Light theme

| token        | old (published) | new       | worst-case ratio, old                                                                                     | worst-case ratio, new                                                                                       | why                                                                                                                                |
| ------------ | --------------- | --------- | --------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `ink-3`      | `#9a9da3`       | `#6b6f76` | 2.61:1 (text on `page`), 2.72:1 (text on `surface`)                                                       | 4.50:1 (text on `canvas`, the worst of the four content backdrops)                                          | axe-measured; confirmed the worst backdrop across `page`/`canvas`/`surface`/`inset` is `canvas`                                    |
| `accent`     | `#0285ff`       | `#006dd3` | 3.62:1 (white text on this as the primary button's fill; symmetric with accent-as-link-text on `surface`) | 4.54:1 (`canvas`, worst content backdrop) / 4.78:1 (white-on-fill)                                          | axe-measured 3.62:1 white-on-accent; auditing found `accent` also fails as plain link text (3.23–3.62:1 across all four backdrops) |
| `accent-ink` | `#0070dd`       | `#005aaf` | 4.30:1 (link-hover text on `canvas`)                                                                      | 6.08:1 (`canvas`)                                                                                           | not caught by axe (hover-only state); darkened further than `accent` to preserve the original hover ramp's relative darkness       |
| `green`      | `#199a4d`       | `#157f40` | 3.25:1 (text on `canvas`)                                                                                 | 4.52:1 (`canvas`)                                                                                           | not caught by axe; found auditing every status tone as direct text (field/placeholder error labels)                                |
| `orange`     | `#ef720d`       | `#b1540a` | 2.65:1 (text on `canvas`)                                                                                 | 4.52:1 (`canvas`)                                                                                           | same audit as `green`                                                                                                              |
| `red`        | `#e3474c`       | `#d52026` | 3.98:1 (axe: white-on-red); 3.48:1 (red-on-its-own-tint, chip/toast text)                                 | 4.77:1 (white-on-fill); 4.52:1 (on `red-tint`, the binding constraint — very slightly darker than `canvas`) | axe-measured white-on-red; auditing found the tighter constraint is the tone's own tint, not `canvas`                              |

Light theme's solid-fill button text (`accentContrast`/`textInverse`) stayed the near-white
`#f7f8f9` it always was: once `accent`/`red` are darkened as above, `#f7f8f9` reaches 4.78:1 and
4.77:1 against them respectively, both clearing AA without a further change.

### What was verified and what was deliberately left alone

- **Every token pair actually used as text-on-background, both themes**, was computed
  programmatically (not sampled) — see `contrast.test.ts`'s module comment for the exact
  call-site grep this table is derived from.
- **3:1 (not 4.5:1) was treated as sufficient**, and no change was made, for pairs that are
  non-text UI (hairline rings, focus rings, chip/border strokes, the message-cursor blink, the
  progress-bar fill) — `line`/`line-strong`/`border`/`focusRing` all resolve to values already
  well past 3:1 against every content backdrop and were not touched by this task.
  `hover`/`hover-2`/`field` were confirmed to only ever hold `ink` as text (4.5:1+ margin in both
  themes, unaffected by this pass) — no chip, badge, or status color is painted on them.
- **High-contrast theme variants** (`lightHighContrastTheme`/`darkHighContrastTheme`) were not
  touched: their overrides (pure black/white ink, boosted borders) already exceed AA by a wide
  margin and don't derive from the roles nudged above.
- **Shadows, radii, typography, motion, spacing** are unaffected — this is a color-only pass.
