import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * `tool-call-row.tsx` imports `react-native` (via `../../ui/recipes` and
 * `../../ui/primitives`), which cannot be rendered under this workspace's
 * plain `vitest` setup — see `./transcript-accessibility.test.ts`'s doc
 * comment for the identical constraint and the `readCode()` pattern this
 * file copies. All real logic (redaction, status text, diff derivation,
 * duration formatting) already has render-free proof in
 * `./tool-call-row-model.test.ts`; this file only proves the .tsx
 * actually wires that logic into the render tree — in particular, that
 * the safe generic card renders the *redacted* summaries and not the raw
 * `collapsibleInput`/`result`/`rawError` fields — rather than silently
 * duplicating or bypassing it.
 *
 * Every assertion below is positive (the wiring is present), never
 * negative (a string is absent) — per this repository's standing lesson
 * that a negative source-text assertion can pin an unfinished construct
 * shut. This file's own test suite is proof the positive assertions are
 * not vacuous: this task's report records deleting each wired call in
 * turn (while leaving every comment above intact) and confirming the
 * matching assertion fails, then restoring byte-identically.
 */
function readSource(): string {
  return readFileSync(fileURLToPath(new URL("./tool-call-row.tsx", import.meta.url)), "utf8");
}

function readCode(): string {
  return readSource()
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");
}

describe("tool-call-row.tsx: the safe generic card renders redacted, bounded summaries", () => {
  it("renders the Input panel from genericInputSummary(tool)", () => {
    expect(readCode()).toMatch(/code=\{genericInputSummary\(tool\)\}/);
  });

  it("renders the Result/Error panel from genericResultSummary(tool)", () => {
    expect(readCode()).toMatch(/code=\{genericResultSummary\(tool\)\}/);
  });

  it("names the unrecognized tool via unrecognizedToolMeta(tool)", () => {
    expect(readCode()).toMatch(/unrecognizedToolMeta\(tool\)/);
  });
});

describe("tool-call-row.tsx: tool status is wired as visible text, not colour alone", () => {
  it("passes statusTextFor(tool.status) as StatusIndicator's statusText prop", () => {
    expect(readCode()).toMatch(/statusText=\{statusTextFor\(tool\.status\)\}/);
  });

  it("also passes a tone (the colour half) from the model's STATUS_TONE map", () => {
    expect(readCode()).toMatch(/tone=\{STATUS_TONE\[tool\.status\]\}/);
  });
});

describe("tool-call-row.tsx: T33A5 edit-diff rendering uses the bounded, counted model", () => {
  it("renders the CodeBlock's code from diffLines.text (the bounded slice), not the raw diff", () => {
    expect(readCode()).toMatch(/code=\{diffLines\.text\}/);
  });

  it("renders DiffSummary's mono tabular figures from diffCounts(tool)", () => {
    const source = readCode();
    expect(source).toMatch(/const \{ added, removed \} = diffCounts\(tool\)/);
    expect(source).toMatch(
      /<DiffSummary path=\{tool\.filePath\} added=\{added\} removed=\{removed\}/,
    );
  });

  it("renders a visible, named truncation notice when diffLines.truncatedNotice is set", () => {
    const source = readCode();
    expect(source).toMatch(/diffLines\?\.truncatedNotice \?/);
    expect(source).toMatch(/\{diffLines\.truncatedNotice\}/);
  });
});

describe("tool-call-row.tsx: card selection follows the model, not a private switch", () => {
  it("selects the known-vs-generic card via isKnownToolCall(tool)", () => {
    expect(readCode()).toMatch(/isKnownToolCall\(tool\)/);
  });
});

describe("tool-call-row.tsx: memoized on the model's comparator", () => {
  it("wraps the row in memo with areToolCallRowPropsEqual", () => {
    expect(readCode()).toMatch(/memo\(TranscriptToolCallRowImpl,\s*areToolCallRowPropsEqual\)/);
  });
});
