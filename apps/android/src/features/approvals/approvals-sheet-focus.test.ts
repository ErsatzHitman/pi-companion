import { describe, expect, it } from "vitest";

import {
  INITIAL_COMPOSER_FOCUS_STATE,
  closeSheet,
  focusComposer,
  openSheet,
  resolveFocusOwner,
} from "../composer/composer-focus-model.js";

/**
 * T33B5 criterion 3: "Sheets respect the keyboard ownership rules,
 * proven against `resolveFocusOwner` rather than by inspection."
 *
 * `ApprovalsHost.tsx` renders its panel through `ui/primitives/Sheet.tsx`
 * (T32S5's Portal-backed sheet, not a detached `Modal` — see that file's
 * own doc comment), and — because `composer-focus-model.ts`'s
 * `SheetKind` union names exactly one non-`"none"` kind today,
 * `"extension"` (see that module's doc comment: "kept as a union ... so
 * a future sheet kind that legitimately wants its own focus is a
 * deliberate addition here, not an accidental one") — the approvals
 * sheet is, like every other sheet in this app this wave, an
 * `"extension"`-kind sheet as far as `resolveFocusOwner` is concerned.
 * `features/composer/` is unowned this wave (do not edit; import only),
 * so this proves the *composition* — an approvals sheet opening and
 * closing driven through the exact same `openSheet`/`closeSheet`/
 * `resolveFocusOwner` calls `Composer.tsx` itself uses — rather than
 * adding a new kind.
 *
 * This is a model-level proof, not a rendered one: like every other
 * `*-model.ts` test in this app, `resolveFocusOwner` is a pure function
 * over plain data, so no `.tsx`/`react-native` render is needed or
 * possible under this workspace's vitest (see this app's own "VITEST
 * LIMITATION" note). What a real mount still owes — an emulator or
 * device actually keeping the IME up while this sheet opens — is T37E
 * (Maestro) and T59 (real device), never claimed here.
 *
 * **Portal host** (corrected by the P5-W10 merge gate; this file was
 * written while T32S6 was still in flight and said the opposite):
 * `<PortalHost>` **is** mounted, wrapping `<Stack>` in
 * `../../app-shell/navigation-shell.tsx` (T32S6, commit `fe6d221`), so
 * this sheet takes `Sheet.tsx`'s real Portal path rather than its inline
 * fallback. That changes nothing this test asserts — focus ownership is
 * identical on both paths — but the inline-fallback caveat below it no
 * longer applies. What a real mount still owes is on-device proof
 * (T37E/T59), not a host.
 */

describe("the approvals sheet never steals composer keyboard focus", () => {
  it("a focused composer keeps ownership across the approvals sheet opening and closing", () => {
    const composerFocused = focusComposer(INITIAL_COMPOSER_FOCUS_STATE);
    expect(resolveFocusOwner(composerFocused)).toBe("composer");

    const approvalsOpened = openSheet(composerFocused, "extension");
    expect(approvalsOpened.composerFocused).toBe(true);
    expect(resolveFocusOwner(approvalsOpened)).toBe("composer");

    const approvalsClosed = closeSheet(approvalsOpened);
    expect(resolveFocusOwner(approvalsClosed)).toBe("composer");
  });

  it("the approvals sheet does not claim focus for itself when the composer did not already hold it", () => {
    const approvalsOpened = openSheet(INITIAL_COMPOSER_FOCUS_STATE, "extension");
    expect(approvalsOpened.composerFocused).toBe(false);
    expect(resolveFocusOwner(approvalsOpened)).toBe("none");

    const approvalsClosed = closeSheet(approvalsOpened);
    expect(resolveFocusOwner(approvalsClosed)).toBe("none");
  });

  it("a second approval arriving (queue advances, sheet stays open) is still a no-op on focus ownership", () => {
    // Models the queue-advance case: the sheet never actually closes
    // between requests (`ApprovalsHost` re-keys onto the next `current`
    // while `open` stays true) — proving the invariant holds across an
    // open -> open transition too, not only open -> close.
    const composerFocused = focusComposer(INITIAL_COMPOSER_FOCUS_STATE);
    const firstOpen = openSheet(composerFocused, "extension");
    const stillOpenForNext = openSheet(firstOpen, "extension");
    expect(resolveFocusOwner(stillOpenForNext)).toBe("composer");
  });
});
