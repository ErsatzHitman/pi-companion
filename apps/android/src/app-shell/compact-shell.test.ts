import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { COMPACT_SHELL_SLOT_ORDER } from "./compact-shell-slots";

/**
 * T32S1 `CompactSessionShell` coverage (plan.md §9.2 "The shell renders
 * with empty slots").
 *
 * `apps/android`'s plain `vitest` setup can't render a `react-native`
 * component tree (see `../app/dev/component-lab.test.ts`'s doc comment for
 * why, and the precedent every other Android component test in this
 * workspace already follows), so — same as those — this is a
 * source-level contract test: it asserts the structural promises a
 * render assertion would otherwise check, against the actual source
 * text.
 */
describe("CompactSessionShell source", () => {
  const source = readFileSync(
    fileURLToPath(new URL("./compact-shell.tsx", import.meta.url)),
    "utf8",
  );

  // Comment-stripped before matching (P5-W16 merge gate, applying the
  // pattern T57B filed against this file): an assertion run against raw
  // source can be satisfied -- or falsely tripped -- by prose in a doc
  // comment rather than by the real code it names.
  const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

  it("gives every slot a default of null, so the shell renders with empty slots", () => {
    for (const slot of COMPACT_SHELL_SLOT_ORDER) {
      expect(code).toMatch(new RegExp(`\\b${slot}\\s*=\\s*null\\b`));
    }
  });

  it("renders every §9.2 slot region with a stable testID, in §9.2's declared order", () => {
    const testIds = COMPACT_SHELL_SLOT_ORDER.map(
      (slot) => `compact-shell-${slot.replace(/([A-Z])/g, "-$1").toLowerCase()}`,
    );
    const positions = testIds.map((testId) => {
      const index = code.indexOf(`testID="${testId}"`);
      expect(index, `expected to find testID="${testId}"`).toBeGreaterThan(-1);
      return index;
    });
    const sorted = [...positions].sort((a, b) => a - b);
    expect(positions).toEqual(sorted);
  });

  it("makes the transcript region the one flexible slot", () => {
    // A rough but effective structural check: the `transcript` style
    // block is the region declared `flex: 1` besides the shell
    // container itself, so it — not the header/status/composer chrome —
    // is what grows to fill remaining height.
    const transcriptStyleBlock = code.slice(code.indexOf("transcript: {"));
    expect(transcriptStyleBlock.slice(0, transcriptStyleBlock.indexOf("}"))).toMatch(/flex:\s*1/);
  });

  it("collapses the live-extension region away instead of reserving empty space when idle", () => {
    expect(code).toMatch(/liveExtension\s*!==\s*null/);
  });

  it('contains no raw hex colour literal (plan.md §10 "no raw hex" rule)', () => {
    expect(code).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  });

  it("T329: pads its own bottom by the live keyboard inset, since edge-to-edge never resizes the window around the IME", () => {
    expect(code).toMatch(/const keyboardInset = useKeyboardInset\(\);/);
    expect(code).toMatch(
      /<View style=\{\[styles\.shell, \{ paddingBottom: keyboardInset \}\]\} testID="compact-shell">/,
    );
  });

  it("resolves every colour through useTheme()", () => {
    expect(code).toMatch(/useTheme\(\)/);
    expect(code).toMatch(/theme\.colors\./);
  });
});
