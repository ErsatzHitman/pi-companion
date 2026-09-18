/**
 * PAD-FADEUP — the android spec's list/settings-pad entrance
 * (`android-spec.html`):
 *
 * ```
 * .pad>.row,.pad>.card{animation:fade-up .3s cubic-bezier(.23,1,.32,1) both}
 * .pad>.row:nth-child(2),.pad>.card:nth-child(2){animation-delay:45ms}
 * .pad>.row:nth-child(3),.pad>.card:nth-child(3){animation-delay:90ms}
 * .pad>.row:nth-child(4),.pad>.card:nth-child(4){animation-delay:135ms}
 * .pad>.row:nth-child(5),.pad>.card:nth-child(5){animation-delay:180ms}
 * .pad>.row:nth-child(6),.pad>.card:nth-child(6){animation-delay:225ms}
 * .pad>.row:nth-child(7),.pad>.card:nth-child(7){animation-delay:270ms}
 * .pad>.row:nth-child(8),.pad>.card:nth-child(8){animation-delay:315ms}
 * ```
 * with `@keyframes fade-up{from{opacity:0;transform:translateY(8px)}
 * to{opacity:1;transform:none}}`.
 *
 * This module is the pure rule behind that CSS: every decision that can
 * be executed lives here, plain TypeScript with no `react-native`,
 * `react-native-reanimated`, or `react` import, so a real `vitest` run
 * can execute it directly rather than only asserting on source text (see
 * this package's `PadEntrance.test.ts` for why the `.tsx` sibling can
 * only do the latter — `react-native` cannot mount under this
 * workspace's plain vitest).
 *
 * ## Two things this CSS rule says that are easy to get backwards
 *
 * **1. The stagger index counts every direct child of `.pad`, not only
 * the animated ones.** `:nth-child(n)` is a raw CSS structural
 * pseudo-class: it counts every element sibling regardless of which
 * selector eventually matches it. A `.lbl` section label sitting first
 * inside `.pad` is still `nth-child(1)`; the `.row` right after it is
 * `nth-child(2)` and gets the spec's first non-zero delay, `45ms` — not
 * `nth-child(1)`'s `0ms`, and not a fresh count that ignores the label.
 * `padEntranceDelayMs` below takes the child's zero-based POSITION among
 * ALL siblings (animated or not) for exactly this reason; a caller that
 * only increments position for rows it means to animate would silently
 * shift every stagger delay on any pad that opens with a label, a search
 * bar, or a chip row before its first row or card — which is every pad
 * this rule actually applies to (`android-spec.html`'s `a1`/`a2`/`a3`
 * frames all open with at least one non-`.row`/`.card` sibling).
 *
 * **2. A child past the spec's last enumerated `nth-child` gets NO
 * delay — the CSS initial value, `0s` — and that is not a bug to clamp
 * away.** The spec enumerates exactly eight `nth-child` rules
 * (`PAD_ENTRANCE_LAST_STAGGERED_CHILD`, below). `nth-child(9)` and
 * beyond match no `animation-delay` rule at all, and CSS does not carry
 * the last matched rule's value forward — an unmatched property simply
 * sits at its initial value, which for `animation-delay` is `0s`. A
 * ninth-or-later row therefore animates with NO delay, entering at the
 * same instant as the very first child, not `315ms` (the eighth child's
 * delay) and not some interpolated further step. This is the literal
 * spec, kept deliberately un-clamped: the opposite choice
 * `packages/frontend-core/src/timeline/transcript-entrance.ts` makes for
 * the transcript's own `fade-up` stagger — that module explicitly CAPS
 * its delay at a measured ceiling
 * (`TRANSCRIPT_ENTRANCE_STAGGER_CAP_MS`) because its rows are keyed to a
 * batch position that can grow arbitrarily large and an uncapped delay
 * would leave a late-arriving turn invisible for the better part of a
 * second. A settings/list pad has no such unbounded growth — it is a
 * short, fixed screen, not a virtualized, ever-growing stream — so the
 * spec's own choice (no rule ⇒ no delay, not the previous rule held
 * open) is exactly what this module implements. Do not "fix" this into
 * a clamp at `PAD_ENTRANCE_STAGGER_MS * (PAD_ENTRANCE_LAST_STAGGERED_CHILD - 1)`;
 * that would match `transcript-entrance.ts`'s rule, not this one's.
 *
 * ## What is NOT this module's job
 *
 * Whether a given rendered child is a `.row`/`.card` kind at all (versus
 * a `.lbl`, a `.sbar`, or a filter-chip row, none of which the spec
 * animates) is answered by `isPadEntranceChildAnimated` below, given a
 * `PadEntranceChildKind` the CALLER assigns — this module has no notion
 * of React elements or JSX and cannot infer a kind from one. Reusing the
 * shared `EXPRESSIVE_FADE_UP_*` duration/easing/translate tokens
 * (`../theme/expressive-motion.ts`'s `EXPRESSIVE_FADE_UP_DURATION_MS.listRow`
 * is already this rule's own `.3s`) and building the actual Reanimated
 * `entering` animation is `./PadEntrance.tsx`'s job, not this file's —
 * this file stays RN-free.
 */

/**
 * `45` — the spec's own per-child delay step (`45ms`, `90ms`, `135ms`, ...
 * — a flat arithmetic progression, confirmed directly against every one
 * of the spec's eight `nth-child` rules above rather than assumed from
 * the first two).
 */
export const PAD_ENTRANCE_STAGGER_MS = 45;

/**
 * `8` — the last `nth-child` the spec enumerates a delay for
 * (`nth-child(8)` → `315ms`). Zero-based child POSITION `7` (the eighth
 * child) is the last one this rule staggers; position `8` and beyond
 * match no rule and fall back to the CSS initial value, `0s` — see this
 * module's own doc comment, section 2, for why that is deliberate and
 * must never be clamped to this constant's own delay.
 */
export const PAD_ENTRANCE_LAST_STAGGERED_CHILD = 8;

/**
 * The two kinds of direct `.pad` child this rule cares about telling
 * apart: `"row"`/`"card"` are the spec's own `.pad>.row,.pad>.card`
 * selector (animated); `"unanimated"` is every other direct child the
 * spec draws inside a `.pad` — a `.lbl` section label, the `.sbar`
 * search bar, or the bare filter-chip row — none of which carries the
 * `fade-up` animation, but all of which still occupy a sibling position
 * and must still be counted (see this module's doc comment, section 1).
 *
 * Deliberately not split into `"row"` vs `"card"` beyond this: the spec
 * gives both identical treatment (same selector, same delay schedule),
 * so a caller has no decision to make between them that this module
 * needs to expose.
 */
export type PadEntranceChildKind = "row" | "card" | "unanimated";

/**
 * Whether a child of this kind carries the `fade-up` entrance at all —
 * the caller-facing guard this module exists to force: a caller handed
 * only a raw position, with no reminder that a `.lbl`/`.sbar`/chip-row
 * child consumes a position without animating, could easily "forget"
 * that and either skip counting it (shifting every later delay) or
 * animate it (something the spec never does to a label or a search
 * bar).
 */
export function isPadEntranceChildAnimated(kind: PadEntranceChildKind): boolean {
  return kind === "row" || kind === "card";
}

/**
 * The spec's own `animation-delay`, in milliseconds, for the child at
 * zero-based sibling `position` — counting every direct `.pad` child,
 * animated or not (see this module's doc comment, section 1). Position
 * `0` is `nth-child(1)` (no delay rule ⇒ `0`), position `1` is
 * `nth-child(2)` (`45`), ... position `7` is `nth-child(8)` (`315`), and
 * position `8` and beyond match no rule at all and answer `0` — the CSS
 * initial value, not a clamp to `315` (see this module's doc comment,
 * section 2).
 *
 * This answers a delay for ANY position, including one whose
 * `PadEntranceChildKind` is `"unanimated"` — that is intentional and
 * harmless (an unanimated child never plays any entrance, so its own
 * delay number is simply unused), and keeps this function a pure
 * position → delay mapping with no `PadEntranceChildKind` parameter of
 * its own. A caller that wants "the delay to actually apply" should
 * gate on `isPadEntranceChildAnimated` first — see
 * `padEntranceDelayForChild` below, which does both.
 */
export function padEntranceDelayMs(position: number): number {
  if (position < 0 || position >= PAD_ENTRANCE_LAST_STAGGERED_CHILD) {
    return 0;
  }
  return position * PAD_ENTRANCE_STAGGER_MS;
}

/**
 * `padEntranceDelayMs` gated on `isPadEntranceChildAnimated`: the delay
 * to actually use for a child of the given `kind` at zero-based sibling
 * `position`, or `null` when that kind never animates at all — so a
 * caller can never confuse "not entering, no delay to speak of" with
 * "entering with a zero delay" (the same distinction
 * `transcript-entrance.ts`'s own `transcriptEntranceDelayMs` draws for
 * the identical reason, cited in this module's header comment).
 */
export function padEntranceDelayForChild(
  kind: PadEntranceChildKind,
  position: number,
): number | null {
  return isPadEntranceChildAnimated(kind) ? padEntranceDelayMs(position) : null;
}
