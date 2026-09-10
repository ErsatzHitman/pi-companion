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

  it("T357: passes the ticked durationLabel through, and the headline the model builds", () => {
    const code = readCode();
    expect(code).toMatch(/durationLabel=\{label\}/);
    expect(code).toMatch(/headline=\{thinkingHeadline\(live, elapsedMs\)\}/);
  });

  it("T357: keeps the announced label richer than the head's two words", () => {
    // The head has room for "Thinking"; a screen reader gets the
    // reasoning preview `summaryFor` builds. Both flip on `live`.
    const code = readCode();
    expect(code).toMatch(/summary=\{summaryFor\(entry, live\)\}/);
  });

  it("T357: empties the mono readout once settled, so the duration is stated once", () => {
    // The headline carries "Thought for N seconds" from that point on.
    // Freezing the mono label as well would print the same number
    // twice, rounded two different ways.
    expect(readCode()).toMatch(/return \{ label: "", elapsedMs: frozenMsRef\.current \};/);
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

  // T357 moved the shimmer itself into `../../ui/recipes/
  // ThinkingSection.tsx`, where the design puts the treatment (on the
  // head's own words, not on a second caption beneath the
  // disclosure). The three cases that pinned the Reanimated mechanism
  // moved with it, to `ThinkingSection.test.ts`; what stays here is
  // the part that is still this row's decision — computing the gate
  // and handing it over.
  //
  // CORRECTED (T357): one of those cases asserted this file renders a
  // visible "Still thinking" caption. It did, and no longer does: the
  // head reads the literal word "Thinking", so the state still
  // survives with the animation off — the requirement the caption
  // existed to satisfy.
  it("T357: hands the recipe the computed gate, never the raw live flag", () => {
    const code = readCode();
    expect(code).toMatch(/shimmer=\{shouldAnimateShimmer\(live, reduceMotion\)\}/);
    expect(code).not.toMatch(/shimmer=\{live\}/);
  });

  it("T357: no longer renders a second caption beneath the disclosure", () => {
    expect(readCode()).not.toMatch(/Still thinking/);
  });
});
