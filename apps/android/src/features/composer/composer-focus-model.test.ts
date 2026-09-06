import { describe, expect, it } from "vitest";

import {
  COMPOSER_LAYOUT_CONTRACT,
  INITIAL_COMPOSER_FOCUS_STATE,
  blurComposer,
  closeSheet,
  focusComposer,
  openSheet,
  resolveFocusOwner,
  rotate,
  type ComposerFocusState,
} from "./composer-focus-model";

/**
 * T33B4: plan.md §9.3's "the composer must retain keyboard ownership
 * when an extension sheet opens", proved as transitions of the RN-free
 * `composer-focus-model.ts` (this task's brief: vitest cannot render
 * `.tsx` reaching `react-native`, so the real IME/`Modal`/`Portal`
 * behaviour is out of reach here and is named for T37/T59 instead — see
 * that module's doc comment).
 */

const PORTRAIT = { width: 360, height: 800 };
const LANDSCAPE = { width: 800, height: 360 };

describe("composer-focus-model: initial state", () => {
  it("starts with nobody focused", () => {
    expect(resolveFocusOwner(INITIAL_COMPOSER_FOCUS_STATE)).toBe("none");
  });
});

describe("composer-focus-model: sheet open does not steal composer focus", () => {
  it("a focused composer keeps ownership across an extension sheet opening", () => {
    const focused = focusComposer(INITIAL_COMPOSER_FOCUS_STATE);
    expect(resolveFocusOwner(focused)).toBe("composer");

    const withSheetOpen = openSheet(focused, "extension");
    expect(withSheetOpen.composerFocused).toBe(true);
    expect(resolveFocusOwner(withSheetOpen)).toBe("composer");
  });

  it("an unfocused composer is not forced into focus by an extension sheet opening either", () => {
    const withSheetOpen = openSheet(INITIAL_COMPOSER_FOCUS_STATE, "extension");
    expect(withSheetOpen.composerFocused).toBe(false);
    expect(resolveFocusOwner(withSheetOpen)).toBe("none");
  });
});

describe("composer-focus-model: sheet close leaves focus exactly as it was", () => {
  it("closing a sheet does not change composerFocused, whichever way it was set", () => {
    const focusedThenOpened = openSheet(focusComposer(INITIAL_COMPOSER_FOCUS_STATE), "extension");
    const focusedThenClosed = closeSheet(focusedThenOpened);
    expect(focusedThenClosed.sheetOpen).toBe(false);
    expect(focusedThenClosed.sheetKind).toBe("none");
    expect(resolveFocusOwner(focusedThenClosed)).toBe("composer");

    const unfocusedThenOpened = openSheet(INITIAL_COMPOSER_FOCUS_STATE, "extension");
    const unfocusedThenClosed = closeSheet(unfocusedThenOpened);
    expect(resolveFocusOwner(unfocusedThenClosed)).toBe("none");
  });
});

describe("composer-focus-model: rotation is a dimension change, not a separate lifecycle", () => {
  it("rotating while a sheet is open and the composer is focused never moves ownership", () => {
    let state: ComposerFocusState = focusComposer(INITIAL_COMPOSER_FOCUS_STATE);
    state = rotate(state, PORTRAIT);
    state = openSheet(state, "extension");
    expect(resolveFocusOwner(state)).toBe("composer");

    state = rotate(state, LANDSCAPE);
    expect(state.dimensions).toEqual(LANDSCAPE);
    expect(state.composerFocused).toBe(true);
    expect(state.sheetOpen).toBe(true);
    expect(resolveFocusOwner(state)).toBe("composer");
  });

  it("rotating with nothing focused and no sheet open stays at 'none'", () => {
    const rotated = rotate(INITIAL_COMPOSER_FOCUS_STATE, LANDSCAPE);
    expect(resolveFocusOwner(rotated)).toBe("none");
  });
});

describe("composer-focus-model: full open -> rotate -> close -> blur sequence", () => {
  it("tracks ownership correctly at every step", () => {
    let state: ComposerFocusState = INITIAL_COMPOSER_FOCUS_STATE;

    state = focusComposer(state);
    expect(resolveFocusOwner(state)).toBe("composer");

    state = openSheet(state, "extension");
    expect(resolveFocusOwner(state)).toBe("composer");

    state = rotate(state, LANDSCAPE);
    expect(resolveFocusOwner(state)).toBe("composer");

    state = closeSheet(state);
    expect(resolveFocusOwner(state)).toBe("composer");

    state = blurComposer(state);
    expect(resolveFocusOwner(state)).toBe("none");
  });
});

describe("composer-focus-model: the composer's own blur is respected, not overridden", () => {
  it("the model never forces the composer back into focus on its own — it only refuses to let a sheet steal it", () => {
    let state: ComposerFocusState = focusComposer(INITIAL_COMPOSER_FOCUS_STATE);
    state = openSheet(state, "extension");
    state = blurComposer(state); // e.g. the user genuinely navigated away
    expect(resolveFocusOwner(state)).toBe("none");
  });
});

describe("composer-focus-model: layout contract", () => {
  it("declares the composer reserves its own height, consumes the keyboard inset, and never renders in a Modal", () => {
    expect(COMPOSER_LAYOUT_CONTRACT).toEqual({
      reservesOwnHeight: true,
      consumesKeyboardInset: true,
      rendersInModal: false,
    });
  });
});
