import { describe, expect, it } from "vitest";

import { REWIND_SCOPE_OPTIONS, rewindScopeLabel, rewindScopeOption } from "./rewind-scopes";

/**
 * T395, Android half: the three scopes the daemon accepts (plan.md §4.2).
 *
 * The point of these assertions is that the sheet cannot invent a fourth
 * scope and cannot silently drop one: `AgentRewindModeSchema` is a closed
 * union of three, and each of the three restores something different.
 */
describe("T395 Android rewind scopes", () => {
  it("offers exactly the daemon's three modes, in the sheet's own order", () => {
    expect(REWIND_SCOPE_OPTIONS.map((option) => option.mode)).toEqual([
      "conversation",
      "files",
      "both",
    ]);
  });

  it("is total over the wire union, so a mode can never render as undefined", () => {
    for (const mode of ["conversation", "files", "both"] as const) {
      expect(rewindScopeOption(mode).mode).toBe(mode);
      expect(rewindScopeLabel(mode).length).toBeGreaterThan(0);
    }
  });

  it("says what each scope actually touches, because the three are not interchangeable", () => {
    expect(rewindScopeOption("conversation").description).toBe(
      "Rewinds the chat to this message. The files on disk are left exactly as they are.",
    );
    expect(rewindScopeOption("files").description).toBe(
      "Restores the workspace's files to how they were at this turn. The chat is left as it is.",
    );
    expect(rewindScopeOption("both").description).toBe(
      "Rewinds the chat and restores the files to this turn at the same time.",
    );
  });

  it("labels the scopes distinctly, so two rows can never read the same", () => {
    const labels = REWIND_SCOPE_OPTIONS.map((option) => option.label);
    expect(new Set(labels).size).toBe(labels.length);
  });
});
