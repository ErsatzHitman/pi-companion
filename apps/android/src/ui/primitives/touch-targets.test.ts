import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * T26A touch-target coverage (plan.md T26A "Touch targets are at least
 * 48dp"). Runs as a source-level check for the same reason
 * `../dev/component-lab.test.ts` does: `react-native` component modules
 * can't be rendered under this workspace's plain `vitest` setup, so this
 * asserts the static contract every interactive primitive makes instead
 * — a literal `48` dp minimum dimension (`minHeight`/`minWidth`) on the
 * element's own resolved style, or a `hitSlop` on that same element when
 * it declares no minimum dimension at all — which is what a rendered
 * layout-measurement assertion would otherwise check.
 *
 * MUTATION-CHECKED (P5-W16/T57B), per-element not per-file: the previous
 * version of this file scanned each primitive's *entire* file text for
 * any `minHeight`/`minWidth` >= 48 or any `hitSlop`, so (a) a
 * non-interactive container's `minHeight` (e.g. `Banner`'s outer `View`)
 * counted as touch-target evidence for the actual touchable inside it,
 * and (b) one element's `hitSlop` masked every other element's — and
 * even its *own* — insufficient `minHeight` in an OR across the whole
 * file. Proven on `Banner.tsx`: shrinking both its `minHeight: 48`
 * values to `40` left the old test green, because the surviving
 * `hitSlop={8}` on the `action` `Pressable` satisfied the file-wide OR
 * regardless of which style actually belonged to a touchable element.
 *
 * This version walks each interactive JSX tag in the file (a `Pressable`/
 * `Touchable*` that declares a semantic `accessibilityRole`, so a
 * non-actionable element like `Select`'s full-screen dismiss scrim is
 * correctly excluded, or any `TextInput`), resolves *that tag's own*
 * `style` prop back to the named entries in the file's
 * `StyleSheet.create`, and asserts *that element* independently:
 *   - if the resolved style (or an inline literal in the `style` prop)
 *     declares a `minHeight`/`minWidth` at all, that declared value must
 *     itself be >= 48 — a `hitSlop` on the same tag no longer rescues an
 *     insufficient declared minimum;
 *   - only when the element declares no minimum dimension whatsoever
 *     does its own `hitSlop` stand in for one (the legitimate pattern
 *     `Chip`/`Link` use: a visually tight control widened by touch-area
 *     padding instead of an inflated `minHeight`).
 *
 * Mutation re-run after the fix: shrinking only `Banner.tsx`'s `action`
 * style's `minHeight: 48` to `40` (its `hitSlop={8}` left untouched)
 * fails the `Banner element 1` case below, because a declared minimum
 * dimension is now checked on its own merit. Restored byte-identical
 * afterward (diffed against a backup kept outside the repo).
 *
 * T81: the loop used to read `./${name}.tsx` relative to this file's own
 * directory (`ui/primitives/`), so nothing outside that directory could
 * ever join the audited set — `composer-icon-action.tsx`
 * (`features/composer/`) had to prove its own 48dp target in a separate,
 * one-off contract test (`composer-accessibility.test.ts`) instead of
 * living in this shared audit. Each entry now carries an explicit
 * `path`, resolved relative to this file via `import.meta.url`, so any
 * interactive primitive anywhere in `apps/android/src` can be added here
 * regardless of which directory owns it.
 *
 * T85 — two loose ends the P5-W21 gate's strict-AND fix left recorded
 * only in a commit message, closed here instead:
 *
 * 1. RECORDED DECISION, TESTED: the `||` this predicate replaced had been
 *    in place for all 11 components above, not only the one T81 added,
 *    and today all 23 assertions in this file pass under the strict
 *    `elementMeetsTouchTarget` unchanged — no existing primitive was ever
 *    relying on a 48-on-one-axis-only pass. That is not merely observed;
 *    it is mutation-tested per component that declares both a minHeight
 *    and a minWidth (only those components can distinguish the old `||`
 *    from the new `&&`): shrinking `IconButton.tsx`'s `touchArea.minWidth`
 *    (inside this directory) from 48 to 40, minHeight left at 48, fails
 *    "IconButton declares a 48dp (or hitSlop-padded) touch target"; the
 *    same shrink on `../../features/composer/composer-icon-action.tsx`'s
 *    `touchArea.minHeight` (outside this directory, T81's addition) fails
 *    "ComposerIconAction declares a 48dp (or hitSlop-padded) touch
 *    target". `Toggle.tsx`'s `touchArea` (`minHeight: 48, minWidth: 48`)
 *    carries the same two-axis shape and is covered by the identical
 *    per-element logic, not a component-specific branch. Both mutations
 *    were reverted byte-identical afterward; every other audited
 *    component declares at most one axis, so for it the strict `&&` and
 *    the old `||` were always equivalent.
 * 2. `composer-accessibility.test.ts` carried its own looser check — a
 *    whole-file `minDimensions.some((value) => value >= 48)` regex scan,
 *    an OR not scoped to any one element — that duplicated this shared
 *    loop for `composer-icon-action.tsx` once T81 added it here. Two
 *    predicates for one rule is exactly how a loose one survives a strict
 *    fix elsewhere, so that duplicate was deleted outright, not relaxed;
 *    `ComposerIconAction`'s 48dp guarantee is now proven only by this
 *    file's shared loop.
 *
 * T90 — the `hitSlop` fallback branch used to be `/hitSlop=\{?\d/`, a
 * PRESENCE check that never read the number: `Chip.tsx` is the only
 * audited component that declares no `minHeight`/`minWidth` anywhere on
 * its interactive tag, so its entire 48dp guarantee rested on that unread
 * value, and `hitSlop={14} -> hitSlop={1}` still passed 23/23 (deleting
 * `hitSlop` outright failed by name, 22/23 — absence was caught, magnitude
 * never was). `elementMeetsTouchTarget` now parses `hitSlop`'s own numeric
 * value and checks it against the element's REAL resolved content size,
 * not a magic number: `hitSlop` pads symmetrically (RN applies it on every
 * side), so the effective target is `content + 2 * hitSlop`. `Chip`'s
 * removable `Pressable` carries no `style` of its own — it shrink-wraps to
 * its `Animated.View` child, whose `chip.height: 24` is that content size
 * — so passing requires `24 + 2 * hitSlop >= 48`, i.e. `hitSlop >= 12`;
 * `hitSlop={14}` (52dp effective) passes, `hitSlop={1}` (26dp effective)
 * correctly fails. A `hitSlop`-only element with no resolvable content
 * size on any axis (own tag, then first JSX child) fails outright rather
 * than passing on the number's bare presence, closing the same hole for
 * any future component that lands in this branch. The strict-AND
 * `minHeight`/`minWidth` branch above is untouched by this fix — `hitSlop`
 * never entered its calculation before T90 and still doesn't.
 */
interface AuditedComponent {
  /** Display name used in test titles. */
  name: string;
  /** Source file path, resolved relative to this file (`import.meta.url`). */
  path: string;
}

const CRITICAL_INTERACTIVE_PRIMITIVES: AuditedComponent[] = [
  { name: "Button", path: "./Button.tsx" },
  { name: "IconButton", path: "./IconButton.tsx" },
  { name: "Link", path: "./Link.tsx" },
  { name: "Toggle", path: "./Toggle.tsx" },
  { name: "Chip", path: "./Chip.tsx" },
  { name: "SearchField", path: "./SearchField.tsx" },
  { name: "TextField", path: "./TextField.tsx" },
  { name: "TextArea", path: "./TextArea.tsx" },
  { name: "Select", path: "./Select.tsx" },
  { name: "Banner", path: "./Banner.tsx" },
  // T81: composer-icon-action.tsx lives under features/composer/, not
  // ui/primitives/ — this is the component the loop previously could not
  // reach without a path.
  { name: "ComposerIconAction", path: "../../features/composer/composer-icon-action.tsx" },
  // T350: the redesign's shared top bar draws a 36dp circle inside a
  // 48dp Pressable, the same split IconButton above already uses.
  { name: "ScreenBar", path: "../recipes/ScreenBar.tsx" },
  // T376: six feature-level components that declare interactive elements
  // of their own and were outside this audit until the resolver could
  // read a dimension written as a named constant, and a style declared
  // in a file's second `StyleSheet.create`. Every one of them is a
  // control a user taps on a redesigned screen.
  { name: "ContextRing", path: "../../features/composer/ContextRing.tsx" },
  { name: "ThinkingSection", path: "../recipes/ThinkingSection.tsx" },
  { name: "SessionsScreen", path: "../../features/sessions/sessions-screen.tsx" },
  { name: "SettingsScreen", path: "../../features/settings/SettingsScreen.tsx" },
  { name: "SessionTreeSheet", path: "../../features/sessions/session-tree-sheet.tsx" },
  { name: "FilesScreen", path: "../../features/files/files-screen.tsx" },
];

/**
 * T362: the leading `(?<![\w$])` is what keeps a TYPE from being read
 * as an element. `SearchField.tsx` declares `ref?: Ref<TextInput>`,
 * and without the lookbehind that annotation's own opening bracket
 * matched here — the audit then reported a second, phantom
 * `TextInput` element for that file, resolved no dimensions for it (a
 * type has no `style` prop) and failed the component by name over a
 * control that does not exist. A real JSX open tag is never preceded
 * by an identifier character; a generic argument always is.
 */
const INTERACTIVE_TAG_PATTERN =
  /(?<![\w$])<(Pressable|TouchableOpacity|TouchableHighlight|TouchableWithoutFeedback|TextInput)\b/g;

/** Strips block and line comments so a doc comment can never satisfy a source-text assertion. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

/**
 * Scans `text` from `openIndex` (which must hold `openChar`) forward,
 * tracking nesting depth and skipping string/template literals, and
 * returns the index of the matching `closeChar`, or -1 if unbalanced.
 */
function findBalancedEnd(
  text: string,
  openIndex: number,
  openChar: string,
  closeChar: string,
): number {
  let depth = 0;
  let inString: string | null = null;
  for (let i = openIndex; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (ch === "\\") {
        i++;
        continue;
      }
      if (ch === inString) inString = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      inString = ch;
      continue;
    }
    if (ch === openChar) depth++;
    else if (ch === closeChar) {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/** Finds the end (`>`, possibly `/>`'s `>`) of a JSX opening tag starting at `startIndex`, honouring nested `{}` and strings. */
function findTagEnd(text: string, startIndex: number): number {
  let depth = 0;
  let inString: string | null = null;
  for (let i = startIndex; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (ch === "\\") {
        i++;
        continue;
      }
      if (ch === inString) inString = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      inString = ch;
      continue;
    }
    if (ch === "{") depth++;
    else if (ch === "}") depth--;
    else if (ch === ">" && depth === 0) return i;
  }
  return -1;
}

/**
 * Parses EVERY `StyleSheet.create({ key: {...}, ... })` in a file into
 * `{ key: "{...}" }`.
 *
 * T376: this used to take `code.indexOf("StyleSheet.create(")` and stop,
 * so a file with a second sheet had every style in it invisible. That is
 * not a rare shape here — `SettingsScreen.tsx` declares `createStyles`
 * and `createNavRowStyles`, and its nav row's own `touchArea`
 * (`minHeight: 48`) lives in the second one — and the failure mode was
 * the bad kind: the element resolved to NO dimensions and was reported
 * as a 48dp violation, against a control that is exactly 48dp. Worse in
 * principle, a key present in both sheets resolved silently to the first
 * sheet's copy, so the audit could have checked numbers belonging to a
 * different element.
 *
 * Later sheets win on a duplicate key, and `duplicateStyleKeys` below
 * reports the collision so an element resolved through an ambiguous key
 * fails loudly rather than being judged on whichever copy happened to
 * be picked.
 */
function parseStyleSheet(code: string): Record<string, string> {
  const map: Record<string, string> = {};
  let searchFrom = 0;
  for (;;) {
    const marker = code.indexOf("StyleSheet.create(", searchFrom);
    if (marker === -1) break;
    searchFrom = marker + "StyleSheet.create(".length;
    const braceStart = code.indexOf("{", marker);
    if (braceStart === -1) break;
    const braceEnd = findBalancedEnd(code, braceStart, "{", "}");
    if (braceEnd === -1) break;
    searchFrom = braceEnd + 1;
    const body = code.slice(braceStart + 1, braceEnd);
    const keyPattern = /(['"]?)([\w$]+)\1\s*:\s*\{/g;
    let match: RegExpExecArray | null;
    while ((match = keyPattern.exec(body))) {
      const key = match[2];
      const openIdx = match.index + match[0].length - 1;
      const closeIdx = findBalancedEnd(body, openIdx, "{", "}");
      if (closeIdx === -1) break;
      map[key] = body.slice(openIdx, closeIdx + 1);
      keyPattern.lastIndex = closeIdx + 1;
    }
  }
  return map;
}

/** Style keys declared by more than one `StyleSheet.create` in the same file, with differing bodies — an element resolving through one of these is unjudgeable, so it fails rather than passing on the wrong numbers. */
function duplicateStyleKeys(code: string): Set<string> {
  const seen = new Map<string, string>();
  const duplicates = new Set<string>();
  let searchFrom = 0;
  for (;;) {
    const marker = code.indexOf("StyleSheet.create(", searchFrom);
    if (marker === -1) break;
    searchFrom = marker + "StyleSheet.create(".length;
    const braceStart = code.indexOf("{", marker);
    if (braceStart === -1) break;
    const braceEnd = findBalancedEnd(code, braceStart, "{", "}");
    if (braceEnd === -1) break;
    searchFrom = braceEnd + 1;
    const body = code.slice(braceStart + 1, braceEnd);
    const keyPattern = /(['"]?)([\w$]+)\1\s*:\s*\{/g;
    let match: RegExpExecArray | null;
    while ((match = keyPattern.exec(body))) {
      const key = match[2];
      const openIdx = match.index + match[0].length - 1;
      const closeIdx = findBalancedEnd(body, openIdx, "{", "}");
      if (closeIdx === -1) break;
      const text = body.slice(openIdx, closeIdx + 1);
      const previous = seen.get(key);
      if (previous !== undefined && previous !== text) duplicates.add(key);
      seen.set(key, text);
      keyPattern.lastIndex = closeIdx + 1;
    }
  }
  return duplicates;
}

/**
 * Module-level `const NAME = <integer>;` declarations, so a dimension
 * written as a named constant resolves to its number.
 *
 * T376: without this, `minHeight: ACTION_BUTTON_SIZE` read as no
 * declared minimum at all. Every dimension in `sessions-screen.tsx` is
 * written that way (`ACTION_BUTTON_SIZE = 48`, `FILTER_CHIP_HEIGHT =
 * 30`), which is better style than a scattered literal and which this
 * audit punished: three compliant controls reported as violations, and —
 * the direction that matters — a control shrunk from 48 to 40 through
 * its constant would have been reported as declaring nothing rather than
 * as declaring too little.
 *
 * Deliberately integers only: a computed expression
 * (`SIZE * 2`, `theme.spacing[3]`) stays unresolved, which leaves the
 * element judged exactly as it is today rather than on a guess.
 */
function parseNumericConstants(code: string): Record<string, number> {
  const constants: Record<string, number> = {};
  for (const match of code.matchAll(/(?:^|\n)\s*const\s+([A-Za-z_$][\w$]*)\s*=\s*(\d+)\s*;/g)) {
    constants[match[1]] = Number(match[2]);
  }
  return constants;
}

interface InteractiveElement {
  tagName: string;
  tagText: string;
  /** Index in the file's (comment-stripped) source of the `>` that ends this tag's opening (or self-closing) bracket — lets `elementMeetsTouchTarget` look past the tag for a child to size a bare-`hitSlop` element against. */
  tagEnd: number;
}

/** Finds every touchable/typeable JSX tag; a `Pressable`/`Touchable*` only counts when it declares a semantic `accessibilityRole` (excludes e.g. `Select`'s dismiss scrim). */
function extractInteractiveElements(code: string): InteractiveElement[] {
  const elements: InteractiveElement[] = [];
  INTERACTIVE_TAG_PATTERN.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = INTERACTIVE_TAG_PATTERN.exec(code))) {
    const tagName = match[1];
    const endIdx = findTagEnd(code, match.index);
    if (endIdx === -1) continue;
    const tagText = code.slice(match.index, endIdx + 1);
    const hasRole = /accessibilityRole=/.test(tagText);
    if (tagName !== "TextInput" && !hasRole) {
      INTERACTIVE_TAG_PATTERN.lastIndex = endIdx + 1;
      continue;
    }
    elements.push({ tagName, tagText, tagEnd: endIdx });
    INTERACTIVE_TAG_PATTERN.lastIndex = endIdx + 1;
  }
  return elements;
}

/** Last match of `pattern` in `text`, as a number — resolving a bare identifier through `constants` (T376), and yielding `null` for anything else (a computed expression stays unresolved rather than guessed). */
function lastNumber(
  pattern: RegExp,
  text: string,
  constants: Record<string, number> = {},
): number | null {
  const matches = [...text.matchAll(pattern)];
  if (matches.length === 0) return null;
  const token = matches[matches.length - 1][1];
  if (/^\d+$/.test(token)) return Number(token);
  return Object.hasOwn(constants, token) ? constants[token] : null;
}

interface DeclaredDimensions {
  minHeight: number | null;
  minWidth: number | null;
  /** A plain (non-`min`) `height`/`width` — for an element with no style of its own that shrink-wraps a single styled child (`Chip`'s `Pressable`), this is the child's fixed size, which is exactly what the parent resolves to. */
  height: number | null;
  width: number | null;
}

/**
 * Reads every `minHeight`/`minWidth`/`height`/`width` declared on `tagText`'s
 * own `style` prop, resolving `styles.foo` references against `styleMap`
 * (a bare inline literal wins over a referenced style, matching
 * `elementMeetsTouchTarget`'s pre-T90 resolution order).
 */
function resolveStyleDimensions(
  tagText: string,
  styleMap: Record<string, string>,
  constants: Record<string, number> = {},
): DeclaredDimensions {
  const result: DeclaredDimensions = { minHeight: null, minWidth: null, height: null, width: null };
  const styleAttr = /style=\{/.exec(tagText);
  if (!styleAttr) return result;
  const openIdx = tagText.indexOf("{", styleAttr.index);
  const closeIdx = findBalancedEnd(tagText, openIdx, "{", "}");
  const styleText = closeIdx === -1 ? tagText.slice(openIdx) : tagText.slice(openIdx, closeIdx + 1);
  const refs = [...styleText.matchAll(/styles\.(\w+)\b/g)].map((m) => m[1]);
  const orderedSegments = [styleText, ...refs.map((ref) => styleMap[ref] ?? "")];
  // T376: the capture is `([\w$]+)`, not `(\d+)` — a dimension written
  // as a named constant has to reach `lastNumber`, which resolves it (or
  // returns null for an expression) rather than never matching at all.
  for (const segment of orderedSegments) {
    const mh = lastNumber(/minHeight:\s*([\w$]+)/g, segment, constants);
    if (mh !== null) result.minHeight = mh;
    const mw = lastNumber(/minWidth:\s*([\w$]+)/g, segment, constants);
    if (mw !== null) result.minWidth = mw;
    // `\bheight`/`\bwidth` (no `min`) intentionally can't match inside
    // `minHeight`/`minWidth`: those are single camelCase identifiers with
    // no word boundary before their capital `H`/`W`.
    const h = lastNumber(/\bheight:\s*([\w$]+)/g, segment, constants);
    if (h !== null) result.height = h;
    const w = lastNumber(/\bwidth:\s*([\w$]+)/g, segment, constants);
    if (w !== null) result.width = w;
  }
  return result;
}

/**
 * A `Pressable`/`Touchable*` with no style of its own shrink-wraps to its
 * content, so an element relying purely on `hitSlop` (no `minHeight`/
 * `minWidth` anywhere on the tag itself) is really padding outward from
 * its first JSX child's own declared size — `Chip`'s removable `Pressable`
 * has no `style` prop at all; its rendered 24dp height comes entirely from
 * the `Animated.View` child's `chip.height: 24`. This walks forward from
 * the parent's `>` to that first child tag's own opening bracket (skipping
 * the parent's closing tag, which means "no element child") and returns
 * its tag text so its style can be resolved the same way as any other.
 */
function findFirstChildTagText(code: string, parentTagEnd: number): string | null {
  if (code[parentTagEnd - 1] === "/") return null; // parent is self-closing: no children
  for (let i = parentTagEnd + 1; i < code.length; i++) {
    if (code[i] !== "<") continue;
    if (code[i + 1] === "/") return null; // hit the parent's own closing tag first
    if (!/[A-Za-z]/.test(code[i + 1] ?? "")) continue;
    const end = findTagEnd(code, i);
    return end === -1 ? null : code.slice(i, end + 1);
  }
  return null;
}

/**
 * Resolves one interactive element's own touch-target guarantee.
 *
 * If the element's own tag declares a `minHeight`/`minWidth` at all, that
 * declared value must itself reach 48 on every axis it constrains (T81/T85
 * strict-AND, unchanged by T90) — `hitSlop` plays no part in this branch.
 *
 * Otherwise (T90: previously a bare presence check, `/hitSlop=\{?\d/`,
 * that a `hitSlop={1}` satisfied as readily as `hitSlop={14}`) the element's
 * `hitSlop` is read as a NUMBER and checked against its actual resolved
 * content size: `hitSlop` pads symmetrically on each axis (RN applies it
 * on both sides), so the effective target is `ownDimension + 2 * hitSlop`,
 * where `ownDimension` is a plain `height`/`width` on the element itself if
 * it has one, else its first child's own declared size (see
 * `findFirstChildTagText`). An axis with no resolvable size at all (no min,
 * no plain height/width anywhere found) is left unconstrained — same rule
 * as the strict-AND branch's undeclared axis — but if NEITHER axis resolves
 * to anything, there is nothing to pad from and the element fails by name
 * rather than passing on `hitSlop`'s bare presence.
 */
function elementMeetsTouchTarget(
  element: InteractiveElement,
  styleMap: Record<string, string>,
  code: string,
  constants: Record<string, number> = {},
  ambiguousStyleKeys: ReadonlySet<string> = new Set(),
): boolean {
  // T376: a style key two sheets in the same file both declare, with
  // different bodies, cannot be attributed to this element -- fail
  // rather than judge it on whichever copy won the merge.
  for (const ref of element.tagText.matchAll(/styles\.(\w+)/g)) {
    if (ambiguousStyleKeys.has(ref[1])) return false;
  }
  const own = resolveStyleDimensions(element.tagText, styleMap, constants);
  const dimensionDeclared = own.minHeight !== null || own.minWidth !== null;
  if (dimensionDeclared) {
    // T81 follow-up: EVERY declared minimum must itself reach 48 (this
    // function's own doc comment above says exactly that), not merely one
    // of them. The previous `||` accepted a 48x40 control, which satisfies
    // neither Android's 48dp guidance nor WCAG 2.5.5. An undeclared
    // dimension stays unconstrained: a full-width control legitimately
    // declares only `minHeight`.
    return (
      (own.minHeight === null || own.minHeight >= 48) &&
      (own.minWidth === null || own.minWidth >= 48)
    );
  }

  const hitSlopMatch = /hitSlop=\{(\d+)\}/.exec(element.tagText);
  if (!hitSlopMatch) return false; // no minimum, no hitSlop at all: nothing pads this element

  const hitSlop = Number(hitSlopMatch[1]);
  let contentHeight = own.height;
  let contentWidth = own.width;
  if (contentHeight === null && contentWidth === null) {
    const childTagText = findFirstChildTagText(code, element.tagEnd);
    if (childTagText) {
      const child = resolveStyleDimensions(childTagText, styleMap, constants);
      // A child's own `minHeight`/`minWidth` also fixes the parent's
      // shrink-wrapped extent from below, same as a plain `height`/`width`.
      contentHeight = child.height ?? child.minHeight;
      contentWidth = child.width ?? child.minWidth;
    }
  }

  if (contentHeight === null && contentWidth === null) {
    // A bare `hitSlop` with no discoverable content size on either axis
    // proves nothing — this is exactly the presence-only hole T90 closes,
    // so it fails loudly instead of passing on the number's mere presence.
    return false;
  }

  const heightOk = contentHeight === null || contentHeight + 2 * hitSlop >= 48;
  const widthOk = contentWidth === null || contentWidth + 2 * hitSlop >= 48;
  return heightOk && widthOk;
}

describe("48dp touch targets", () => {
  for (const { name, path } of CRITICAL_INTERACTIVE_PRIMITIVES) {
    // A path that fails to resolve must fail loudly and by name, not be
    // silently dropped from the audited set (T81). Reading eagerly here
    // (rather than inside an `it`) would crash the whole file's
    // collection on one bad path, burying every other component's
    // results in an unrelated stack trace — so the read is attempted up
    // front only to decide which branch to take, and any failure is
    // reported as its own named, failing test for exactly this
    // component instead.
    let source: string | null = null;
    let readError: unknown = null;
    try {
      source = readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");
    } catch (error) {
      readError = error;
    }

    if (source === null) {
      it(`${name}'s audited path (${path}) resolves to a readable file`, () => {
        throw new Error(
          `Touch-target audit path for "${name}" (${path}) did not resolve: ${String(readError)}`,
        );
      });
      continue;
    }

    const code = stripComments(source);
    const styleMap = parseStyleSheet(code);
    const constants = parseNumericConstants(code);
    const ambiguousStyleKeys = duplicateStyleKeys(code);
    const elements = extractInteractiveElements(code);

    it(`${name} has at least one interactive touch element to check`, () => {
      expect(elements.length).toBeGreaterThan(0);
    });

    elements.forEach((element, index) => {
      const label =
        elements.length > 1 ? `${name} element ${index + 1} (${element.tagName})` : name;
      it(`${label} declares a 48dp (or hitSlop-padded) touch target`, () => {
        expect(
          elementMeetsTouchTarget(element, styleMap, code, constants, ambiguousStyleKeys),
        ).toBe(true);
      });
    });
  }
});

describe("the audit reads elements, not type annotations (T362)", () => {
  it("ignores a generic argument that happens to name an audited tag", () => {
    // `SearchField.tsx`'s own `ref?: Ref<TextInput>` is the real case
    // this closes: it was counted as a second TextInput, resolved to no
    // dimensions, and failed the component over a control that is not
    // there.
    const code = "export interface P { ref?: Ref<TextInput>; onPress?: Ref<Pressable> }";
    expect(extractInteractiveElements(code)).toEqual([]);
  });

  it("still finds a real open tag in every position JSX puts one in", () => {
    const code = [
      "return (",
      "  <TextInput style={styles.a} />",
      ");",
      'const b = cond ? <Pressable accessibilityRole="button" style={styles.a} /> : null;',
      'const c = <><Pressable accessibilityRole="button" style={styles.a} /></>;',
    ].join("\n");
    expect(extractInteractiveElements(code).map((element) => element.tagName)).toEqual([
      "TextInput",
      "Pressable",
      "Pressable",
    ]);
  });
});

/**
 * T376 — the two things this audit could not read, pinned at the
 * fixture level so a future simplification of the resolver fails here
 * rather than silently in the component list above.
 *
 * Both were found by trying to ADD six real components and watching
 * compliant ones fail: `sessions-screen.tsx` writes every dimension as
 * a named constant, and `SettingsScreen.tsx` keeps its nav row's
 * `touchArea` in a second `StyleSheet.create`. In both cases the audit
 * resolved NO dimension and reported a 48dp violation against a control
 * that meets it — and, in the direction that actually matters, a
 * control shrunk below 48 through either shape would have been reported
 * the same way as one declaring nothing, which is a check that cannot
 * tell a violation from a blind spot.
 */
describe("the audit resolves a dimension however it is written (T376)", () => {
  const pressable = (styleRef: string) =>
    `<Pressable accessibilityRole="button" style={${styleRef}}><Text /></Pressable>`;

  function judge(code: string): boolean {
    const elements = extractInteractiveElements(code);
    expect(elements).toHaveLength(1);
    return elementMeetsTouchTarget(
      elements[0],
      parseStyleSheet(code),
      code,
      parseNumericConstants(code),
      duplicateStyleKeys(code),
    );
  }

  it("reads a minimum written as a named constant, and fails it when the constant is too small", () => {
    const tooSmall = [
      "const ACTION_BUTTON_SIZE = 40;",
      "const styles = StyleSheet.create({ action: { minHeight: ACTION_BUTTON_SIZE } });",
      pressable("styles.action"),
    ].join("\n");
    expect(judge(tooSmall)).toBe(false);

    const bigEnough = tooSmall.replace("= 40;", "= 48;");
    expect(judge(bigEnough)).toBe(true);
  });

  it("reads a style declared in a file's SECOND StyleSheet.create", () => {
    const code = [
      "const styles = StyleSheet.create({ screen: { padding: 8 } });",
      "const navRowStyles = StyleSheet.create({ touchArea: { minHeight: 48 } });",
      pressable("styles.touchArea"),
    ].join("\n");
    expect(judge(code)).toBe(true);

    // And it is the real value being read, not the mere presence of a
    // second sheet: the same shape at 40 fails.
    expect(judge(code.replace("minHeight: 48", "minHeight: 40"))).toBe(false);
  });

  it("refuses to judge a style key two sheets declare differently", () => {
    // Resolution merges sheets, so one copy would win silently and the
    // element would be judged on numbers that may belong to the other
    // component entirely. Failing is the honest answer; renaming one key
    // is the fix.
    const code = [
      "const a = StyleSheet.create({ touchArea: { minHeight: 48 } });",
      "const b = StyleSheet.create({ touchArea: { minHeight: 24 } });",
      pressable("styles.touchArea"),
    ].join("\n");
    expect(duplicateStyleKeys(code).has("touchArea")).toBe(true);
    expect(judge(code)).toBe(false);

    // Identical bodies are not a collision -- nothing is ambiguous.
    const same = code.replace("minHeight: 24", "minHeight: 48");
    expect(duplicateStyleKeys(same).has("touchArea")).toBe(false);
    expect(judge(same)).toBe(true);
  });

  it("leaves a computed dimension unresolved rather than guessing at it", () => {
    // `minHeight: theme.spacing[3]` is not a number this file can read,
    // and inventing one would be worse than reading none: the element
    // falls through to the hitSlop branch exactly as it did before, and
    // fails there for want of a discoverable content size (T90).
    const code = [
      "const styles = StyleSheet.create({ action: { minHeight: theme.spacing[3] } });",
      pressable("styles.action"),
    ].join("\n");
    expect(judge(code)).toBe(false);
    expect(parseNumericConstants(code)).toEqual({});
  });

  it("reads only module-level integer constants, not every assignment", () => {
    const code = [
      "const SIZE = 48;",
      "const LABEL = 'forty-eight';",
      "const COMPUTED = SIZE * 2;",
      "const RATIO = 0.32;",
    ].join("\n");
    expect(parseNumericConstants(code)).toEqual({ SIZE: 48 });
  });
});
