import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * `thinking-row.tsx` imports `react-native`/`react-native-reanimated`
 * (via `../../ui/recipes`'s `ThinkingSection`), which cannot be rendered
 * under this workspace's plain `vitest` setup — see
 * `./transcript-accessibility.test.ts`'s doc comment for the identical
 * constraint and the `readCode()` pattern this file copies, and
 * `./message-row.test.ts` for the same shape applied to the sibling row.
 * All real logic (`summaryFor`, `bodyFor`, `formatElapsedDuration`,
 * `shouldAnimateShimmer`, `areThinkingRowPropsEqual`) already has
 * render-free proof in `./thinking-row-model.test.ts`; this file only
 * proves the .tsx actually wires that logic into the render tree — the
 * live-caption gate, the shimmer gate, and the `memo` boundary — rather
 * than silently duplicating or dropping it.
 *
 * Every assertion below was mutation-checked by hand (delete the real
 * construct in `thinking-row.tsx`, re-run this file, confirm the specific
 * `it` fails, restore byte-identically from a backup kept outside the
 * repo, `diff` the restore against the original). See this task's report
 * for the run log; the checked-in file is always the restored original.
 */
function readSource(): string {
  return readFileSync(fileURLToPath(new URL("./thinking-row.tsx", import.meta.url)), "utf8");
}

function readCode(): string {
  return readSource()
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");
}

describe("thinking-row.tsx: composes ThinkingSection from the model's mapping, not a private one", () => {
  it("passes summaryFor(entry, live) as the summary prop", () => {
    expect(readCode()).toMatch(/summary=\{summaryFor\(entry, live\)\}/);
  });

  it("passes bodyFor(entry) as the body prop", () => {
    expect(readCode()).toMatch(/body=\{bodyFor\(entry\)\}/);
  });

  it("passes the ticked durationLabel through", () => {
    expect(readCode()).toMatch(/durationLabel=\{durationLabel\}/);
  });
});

describe("thinking-row.tsx: memoized on the model's comparator", () => {
  it("wraps the row in memo(..., areThinkingRowPropsEqual) — never a bare memo() with default shallow-prop comparison", () => {
    expect(readCode()).toMatch(
      /export const TranscriptThinkingRow = memo\(\s*TranscriptThinkingRowImpl,\s*areThinkingRowPropsEqual,?\s*\)/,
    );
  });
});

describe("thinking-row.tsx: live shimmer treatment", () => {
  it("gates the Reanimated shimmer loop on shouldAnimateShimmer(live, reduceMotion), never on live alone", () => {
    expect(readCode()).toMatch(/shouldAnimateShimmer\(live, reduceMotion\)/);
  });

  it("only renders the live caption while `live` is true — reduced motion changes whether it animates, never whether it exists", () => {
    expect(readCode()).toMatch(/\{live \? \(/);
    expect(readCode()).toMatch(/Still thinking/);
  });

  it("drives the shimmer from react-native-reanimated's interpolateColor/withRepeat, not a CSS-only or one-shot effect", () => {
    const code = readCode();
    expect(code).toMatch(/from "react-native-reanimated"/);
    expect(code).toMatch(/interpolateColor\(/);
    expect(code).toMatch(/withRepeat\(/);
  });

  it("resets the shared value instead of leaving a stale loop running when the gate turns off", () => {
    expect(readCode()).toMatch(/if \(!animate\) \{\s*shimmer\.value = 0;/);
  });
});
