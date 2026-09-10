/**
 * The redesign's diff line (`HANDOFF.md` §7.2's `.dl add|rem|ctx` plus
 * `.inv`), and the search hit it shares a treatment with (`mark.hit`).
 * T358.
 *
 * Every decision here is a pure function over strings, so the whole
 * recipe's behaviour is provable by execution rather than by a
 * source-regex pin — the same split `./PixelLoader.tsx` and
 * `../theme/block-shape.ts` use, and the reason this file has no React
 * Native import.
 *
 * ## What the artifact draws, and what this maps onto
 *
 * A changed line is a full-width band: radius 5, `padding: 0 6px`, the
 * tone's own text colour on a 12% wash of that tone. A context line is
 * the same geometry with no fill and `ink-2` text. Inside a changed
 * line, the WORDS that actually changed are drawn inverted — the band's
 * own colour becomes the background and the text becomes `surface`.
 *
 * The 12% wash is not written down here. `@picompanion/design-tokens`
 * already owns `green-tint` and `red-tint` for exactly this role, at
 * 14% in the dark theme and as near-white solids in the light one, and
 * those were contrast-checked when they were chosen. Re-deriving a 12%
 * overlay in this file would put a product colour outside the token
 * package and would silently lose the light theme, which does not use
 * alpha overlays at all. Two percentage points is not worth either.
 *
 * ## Why the inverted span is derived rather than delivered
 *
 * Nothing on the wire says which words inside a removed line were
 * replaced: a unified diff is line-granular. `changedSpans` recovers it
 * the way every diff viewer does — trim the common prefix and the
 * common suffix of the paired removed/added line, and what is left in
 * the middle is what changed. That is a heuristic and it is allowed to
 * be one, because it is decoration: the marker, the fill and the
 * accessible label all state add-versus-remove without it, so a pairing
 * this misjudges makes a line look busier, never wrong.
 *
 * The pairing itself is deliberately narrow (`pairChangedLines`): only a
 * single removed line immediately followed by a single added line is
 * treated as a replacement. A run of three removals followed by three
 * additions has no honest one-to-one reading — the second removal may
 * correspond to the third addition, or to nothing — and guessing there
 * would produce confident, wrong emphasis.
 */

/** The `.dl` radius. */
export const DIFF_LINE_RADIUS = 5;
/** `.dl`'s `padding: 0 6px`. */
export const DIFF_LINE_PADDING_HORIZONTAL = 6;
/** `mark.hit`'s and `.inv`'s shared corner. */
export const HIT_RADIUS = 3;
/** `mark.hit`'s `padding: 0 1px`. */
export const HIT_PADDING_HORIZONTAL = 1;
/** `.inv`'s `padding: 0 2px`. */
export const INVERTED_PADDING_HORIZONTAL = 2;

/** The artifact's own three `.dl` modifiers. */
export type DiffLineTone = "add" | "rem" | "ctx";

/** The `theme.colors` key a line's wash reads from, or `null` for the unfilled context line. */
export type DiffLineSurfaceToken = "green-tint" | "red-tint";

/** The `theme.colors` key a line's text reads from. */
export type DiffLineInkToken = "green" | "red" | "ink-2";

export function diffLineSurface(tone: DiffLineTone): DiffLineSurfaceToken | null {
  if (tone === "add") return "green-tint";
  if (tone === "rem") return "red-tint";
  return null;
}

export function diffLineInk(tone: DiffLineTone): DiffLineInkToken {
  if (tone === "add") return "green";
  if (tone === "rem") return "red";
  return "ink-2";
}

/** The word a screen reader hears instead of the colour. */
export function diffLineAnnouncement(tone: DiffLineTone): string {
  if (tone === "add") return "Added";
  if (tone === "rem") return "Removed";
  return "Context";
}

/** One run of a line's text: `inverted` runs are the `.inv` spans. */
export interface DiffLineSpan {
  readonly text: string;
  readonly inverted: boolean;
}

/**
 * The parser's own kinds (`../../features/extensions/renderers/diff-model.ts`'s
 * `PiUiDiffLineKind`) narrowed to the three the artifact draws. `hunk`
 * and `meta` are not diff CONTENT — they are the `@@` and `---`/`+++`
 * headers — and giving them a tone would colour a file path as though
 * it were a deletion.
 */
export function toneForDiffKind(
  kind: "add" | "remove" | "context" | "hunk" | "meta",
): DiffLineTone | null {
  if (kind === "add") return "add";
  if (kind === "remove") return "rem";
  if (kind === "context") return "ctx";
  return null;
}

function commonPrefixLength(a: string, b: string): number {
  const max = Math.min(a.length, b.length);
  let index = 0;
  while (index < max && a[index] === b[index]) index += 1;
  return index;
}

function commonSuffixLength(a: string, b: string, floor: number): number {
  const max = Math.min(a.length, b.length) - floor;
  let index = 0;
  while (index < max && a[a.length - 1 - index] === b[b.length - 1 - index]) index += 1;
  return index;
}

/**
 * Splits `text` into runs, marking as `inverted` the middle that
 * differs from `counterpart`. Returns a single un-inverted run when the
 * two are identical, when either is empty, or when the differing middle
 * is the whole line — inverting everything would draw a solid colour
 * bar and say less than the fill already does.
 */
export function changedSpans(text: string, counterpart: string | null): DiffLineSpan[] {
  if (counterpart === null || text.length === 0 || counterpart.length === 0) {
    return [{ text, inverted: false }];
  }
  const prefix = commonPrefixLength(text, counterpart);
  const suffix = commonSuffixLength(text, counterpart, prefix);
  const middle = text.slice(prefix, text.length - suffix);
  if (middle.length === 0 || middle.length === text.length) {
    return [{ text, inverted: false }];
  }
  const spans: DiffLineSpan[] = [];
  if (prefix > 0) spans.push({ text: text.slice(0, prefix), inverted: false });
  spans.push({ text: middle, inverted: true });
  if (suffix > 0) spans.push({ text: text.slice(text.length - suffix), inverted: false });
  return spans;
}

/** One line as the recipe renders it. */
export interface DiffLineItem {
  readonly key: string;
  readonly tone: DiffLineTone;
  /** The literal `+`/`-`/` ` the artifact keeps at the head of the band. */
  readonly marker: string;
  readonly spans: readonly DiffLineSpan[];
}

/** A line as the caller supplies it, before pairing. */
export interface DiffLineInput {
  readonly key: string;
  readonly tone: DiffLineTone;
  readonly marker: string;
  readonly content: string;
}

/**
 * Turns a flat list of classified lines into renderable ones, inverting
 * the changed middle of each isolated remove/add pair. See this
 * module's doc comment for why the pairing refuses to guess across
 * longer runs.
 */
export function pairChangedLines(lines: readonly DiffLineInput[]): DiffLineItem[] {
  return lines.map((line, index) => {
    let counterpart: string | null = null;
    const previous = lines[index - 1];
    const next = lines[index + 1];
    const after = lines[index + 2];
    const before = lines[index - 2];
    if (
      line.tone === "rem" &&
      next?.tone === "add" &&
      previous?.tone !== "rem" &&
      after?.tone !== "add"
    ) {
      counterpart = next.content;
    } else if (
      line.tone === "add" &&
      previous?.tone === "rem" &&
      next?.tone !== "add" &&
      before?.tone !== "rem"
    ) {
      counterpart = previous.content;
    }
    return {
      key: line.key,
      tone: line.tone,
      marker: line.marker,
      spans: changedSpans(line.content, counterpart),
    };
  });
}

/** One run of a matched line: `hit` runs are the `mark.hit` spans. */
export interface HitSpan {
  readonly text: string;
  readonly hit: boolean;
}

/**
 * Splits `text` on every case-insensitive occurrence of `query`, so a
 * search result can show WHERE it matched rather than only that it did
 * (`mark.hit`, drawn on `accent-highlight`).
 *
 * Case-insensitive because the daemon's search tools are not uniformly
 * case-sensitive and a highlight that disappears on a case-insensitive
 * match reads as a broken highlight rather than as a precise one. An
 * empty or whitespace-only query returns the line whole: highlighting
 * every character is the same as highlighting nothing, and splitting on
 * an empty needle does not terminate.
 */
export function highlightHits(text: string, query: string): HitSpan[] {
  const needle = query.trim();
  if (needle.length === 0 || text.length === 0) {
    return [{ text, hit: false }];
  }
  const haystack = text.toLowerCase();
  const lowered = needle.toLowerCase();
  const spans: HitSpan[] = [];
  let cursor = 0;
  for (;;) {
    const at = haystack.indexOf(lowered, cursor);
    if (at === -1) break;
    if (at > cursor) spans.push({ text: text.slice(cursor, at), hit: false });
    spans.push({ text: text.slice(at, at + needle.length), hit: true });
    cursor = at + needle.length;
  }
  if (spans.length === 0) return [{ text, hit: false }];
  if (cursor < text.length) spans.push({ text: text.slice(cursor), hit: false });
  return spans;
}
