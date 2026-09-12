import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * `work-group-row.tsx` imports `react-native`, which cannot be rendered under
 * this workspace's plain `vitest` setup — see `./transcript-accessibility.test.ts`
 * for the identical constraint and `./thinking-row.test.ts` for the
 * `readCode()` pattern this file copies.
 *
 * All the real logic (label, status suffix, announced name, which runs become
 * groups at all) already has render-free proof in `packages/frontend-core`'s
 * `work-groups.test.ts`; this file only proves the .tsx actually wires that
 * shared core into the render tree — the disclosure semantics, the 48dp touch
 * floor, the failure tone, and the `memo` boundary — rather than
 * reimplementing any of it privately.
 */
function readCode(): string {
  return readFileSync(fileURLToPath(new URL("./work-group-row.tsx", import.meta.url)), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");
}

describe("work-group-row.tsx: disclosure semantics", () => {
  it("is a button whose expanded state is the inverse of `collapsed`", () => {
    const code = readCode();
    expect(code).toMatch(/accessibilityRole="button"/);
    expect(code).toMatch(/accessibilityState=\{\{ expanded: !collapsed \}\}/);
    expect(code).toMatch(/onPress=\{\(\) => onToggle\(group\.id\)\}/);
  });

  it("announces the shared core's label, never a locally assembled string", () => {
    const code = readCode();
    expect(code).toMatch(/accessibilityLabel=\{timeline\.workGroupAccessibilityLabel\(group\)\}/);
    expect(code).toMatch(/\{timeline\.formatWorkGroupMeta\(group\)\}/);
  });

  it("reports a failure in the danger tone rather than hiding it behind a neutral head", () => {
    expect(readCode()).toMatch(
      /group\.hasFailure \? theme\.colors\.red : theme\.colors\["ink-2"\]/,
    );
  });
});

describe("work-group-row.tsx: 48dp touch floor", () => {
  it("declares the floor as a module-level integer literal the touch audit can resolve", () => {
    // `ui/primitives/touch-targets.test.ts` reads this file from source and
    // cannot resolve `theme.spacing[...]`; a named integer constant is the
    // one form it proves. Both halves are pinned so a future edit cannot
    // shrink the number or smuggle it back into a theme expression.
    const code = readCode();
    expect(code).toMatch(/const WORK_GROUP_HEAD_MIN_HEIGHT = 48;/);
    expect(code).toMatch(/minHeight: WORK_GROUP_HEAD_MIN_HEIGHT,/);
    expect(code).not.toMatch(/minHeight: theme\.spacing/);
  });
});

describe("work-group-row.tsx: memo boundary", () => {
  it("is memoized so a settled group head does not re-render with the transcript", () => {
    expect(readCode()).toMatch(
      /export const TranscriptWorkGroupHead = memo\(TranscriptWorkGroupHeadImpl\)/,
    );
  });
});
