/**
 * Keyboard/focus-ownership model for the composer (T33B4; plan.md §9.3:
 * "The composer must retain keyboard ownership when an extension sheet
 * opens; use Portal rather than a detached Modal where required").
 *
 * RN-free for the same reason as `composer-model.ts` (see its doc
 * comment): vitest cannot render `.tsx` that reaches `react-native` (a
 * RolldownError on react-native's own Flow-typed `index.js` header, hit
 * seven times across this codebase already), so the *decision* — which
 * surface owns keyboard focus given the composer's own focus state, an
 * open/closed sheet, and a dimension (rotation) change — lives here as
 * plain data and pure transitions, independent of any TextInput ref or
 * `Modal`/`Portal` component. `Composer.tsx` is the (currently partial —
 * see its own doc comment) view over this; the real IME behaviour this
 * decides about is proven on T37 (Maestro) and T59 (real device), never
 * claimed here.
 *
 * **The rule this encodes:** an `"extension"`-kind sheet never claims
 * keyboard ownership, in either direction. It does not steal focus away
 * from a composer that already held it, and it does not hand focus to
 * itself when the composer did not already hold it. Opening, closing, or
 * rotating around such a sheet is therefore a no-op for
 * `resolveFocusOwner` — see this file's test for the open/close/rotate
 * transitions that prove that invariance.
 *
 * **Two known gaps this model cannot close by itself** (out of this
 * task's `Owns` grant — see T33B4's report):
 * 1. `ui/primitives/Sheet.tsx` renders its panel inside React Native's
 *    `Modal`, which opens a separate native Android window and *does*
 *    take the OS's IME focus away from whatever `TextInput` was focused
 *    underneath it — the exact failure plan.md §9.3 says to avoid with
 *    "use Portal rather than a detached Modal". Fixing that belongs in
 *    the sheet primitive, not here.
 * 2. `ui/recipes/PromptBar.tsx`'s `TextInput` exposes no `onFocus`/
 *    `onBlur`, so `Composer.tsx` cannot observe real focus/blur events
 *    from its own input today; `composerFocused` below is therefore an
 *    input this model takes, not (yet) a value `Composer.tsx` can derive
 *    from a live event.
 */

/** The only sheet kind plan.md §9.3 names. Kept as a union (not a bare boolean) so a future sheet kind that legitimately wants its own focus is a deliberate addition here, not an accidental one. */
export type SheetKind = "none" | "extension";

/** A surface capable of holding keyboard/input focus for this feature. */
export type FocusOwner = "composer" | "none";

export interface Dimensions {
  width: number;
  height: number;
}

export interface ComposerFocusState {
  /** Whether the composer's own `TextInput` currently holds focus. */
  composerFocused: boolean;
  /** Whether a sheet is currently open above the composer. */
  sheetOpen: boolean;
  /** What kind of sheet is open; always `"none"` when `sheetOpen` is `false`. */
  sheetKind: SheetKind;
  /** Current viewport dimensions. A rotation is a change to this value (see `rotate`), not a separate lifecycle. */
  dimensions: Dimensions;
}

export const INITIAL_COMPOSER_FOCUS_STATE: ComposerFocusState = {
  composerFocused: false,
  sheetOpen: false,
  sheetKind: "none",
  dimensions: { width: 0, height: 0 },
};

/** The composer's `TextInput` gaining focus. */
export function focusComposer(state: ComposerFocusState): ComposerFocusState {
  return { ...state, composerFocused: true };
}

/** The composer's `TextInput` losing focus (e.g. the user tapped elsewhere in real, non-sheet content). */
export function blurComposer(state: ComposerFocusState): ComposerFocusState {
  return { ...state, composerFocused: false };
}

/**
 * Opens a sheet of the given kind. Deliberately never touches
 * `composerFocused` itself — that is the whole rule this module exists
 * to encode. `resolveFocusOwner` is what turns "sheet is open" into an
 * ownership decision.
 */
export function openSheet(
  state: ComposerFocusState,
  kind: Exclude<SheetKind, "none">,
): ComposerFocusState {
  return { ...state, sheetOpen: true, sheetKind: kind };
}

/** Closes whatever sheet is open. A no-op on `composerFocused`, same as `openSheet`. */
export function closeSheet(state: ComposerFocusState): ComposerFocusState {
  return { ...state, sheetOpen: false, sheetKind: "none" };
}

/**
 * Applies a dimension change. Rotation is not a distinct lifecycle event
 * in this model — it is exactly this function, called with the new
 * `width`/`height` — and, like `openSheet`/`closeSheet`, it never touches
 * `composerFocused` or `sheetOpen`/`sheetKind`.
 */
export function rotate(state: ComposerFocusState, dimensions: Dimensions): ComposerFocusState {
  return { ...state, dimensions };
}

/**
 * Decides which surface owns keyboard focus for one state snapshot.
 *
 * Today this reduces to `composerFocused` alone: with only `"none"` and
 * `"extension"` as sheet kinds, and an `"extension"` sheet never
 * claiming ownership (this module's doc comment), no other field can
 * move the answer away from whatever `composerFocused` already says —
 * which *is* plan.md §9.3's rule, not an oversight. See this file's test
 * for that invariance proven across sheet open/close and rotation.
 */
export function resolveFocusOwner(state: ComposerFocusState): FocusOwner {
  return state.composerFocused ? "composer" : "none";
}

/** The layout contract `Composer.tsx`'s root container builds to (plan.md §9.3 "the composer must ... remain visible above the IME", read together with §9.2's "bottom composer"). */
export interface ComposerLayoutContract {
  /**
   * The composer's prompt bar — its input and send button — never shrinks
   * to make room for a sheet or the IME: it reserves its own height, and
   * the controls above it scroll instead.
   *
   * CORRECTED at T338: this said "the composer's own container never
   * shrinks". An un-shrinkable container is exactly what pushed the send
   * button under the keyboard in Maestro run 34470287372; the height
   * worth reserving is the prompt bar's.
   *
   * T343 made that reservation literal: `Composer.tsx` measures its
   * heading and its prompt bar and applies their sum, plus the section's
   * gaps, as the root's `minHeight` (`composer-min-height-model.ts`), so
   * a shrinkable pinned area above gives way before the prompt bar does
   * (run 34493338438). (CORRECTED at T344: this said it "measures its
   * section and its scrolling controls and applies the difference" — the
   * two readings arrive separately, and a fresh section paired with a
   * stale squeezed scroll view froze the composer at full height in run
   * 34497459568.)
   */
  reservesOwnHeight: true;
  /**
   * The keyboard inset is consumed by the layout, not ignored: the
   * session shell (`app-shell/compact-shell.tsx`) pads its own bottom by
   * the live keyboard height from `app-shell/keyboard-inset.ts`, so the
   * composer is never drawn underneath the IME.
   *
   * CORRECTED at T329: this said the composer "relies on the OS resizing
   * the window around the IME (Android's `windowSoftInputMode=
   * "adjustResize"`)". Under edge-to-edge, mandatory for this app's target
   * SDK, the window is never resized around the IME; run 34444464068
   * measured the composer's input and send button under the keyboard on
   * every session-screen flow, which is why the shell now consumes the
   * inset itself.
   */
  consumesKeyboardInset: true;
  /** The composer is never itself rendered inside a detached `Modal` (see `composer-accessibility.test.ts`'s "no <Modal>" check), so it can never be pushed into a separate native window that competes with an open sheet's window for the IME. */
  rendersInModal: false;
}

export const COMPOSER_LAYOUT_CONTRACT: ComposerLayoutContract = {
  reservesOwnHeight: true,
  consumesKeyboardInset: true,
  rendersInModal: false,
};
