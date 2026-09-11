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
  // CORRECTED (T358): this pinned `code={diffLines.text}` on a
  // `CodeBlock`. That was true, and T358 replaced the block with the
  // redesign's own `.dl` bands. The claim the pin existed to protect —
  // that what is drawn is the BOUNDED slice and never the raw diff —
  // is unchanged and is re-anchored below rather than dropped:
  // `diffLineInputsFor` is built on `diffLinesFor`, so there is still
  // exactly one cap, and `tool-call-row-model.test.ts` proves it holds
  // by execution.
  it("draws the bounded slice, not the raw diff", () => {
    const source = readCode();
    expect(source).toMatch(/const bands = pairChangedLines\(diffLineInputsFor\(tool\)\);/);
    expect(source).toMatch(/<DiffLines\s+lines=\{bands\}/);
    // The raw field the cap exists to keep off the screen.
    expect(source).not.toMatch(/\{tool\.unifiedDiff\}/);
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

describe("tool-call-row.tsx: the redesign's tool surfaces (T356)", () => {
  it("takes the card's fill from the shared block table, never from a colour written here", () => {
    const code = readCode();
    expect(code).toMatch(/blockSurface\(kind\)/);
    expect(code).toMatch(/blockOutline\(kind\)/);
    expect(code).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  });

  it("maps a finished call to tool-ok and a failed one to tool-error", () => {
    const code = readCode();
    expect(code).toMatch(/if \(status === "completed"\) return "tool-ok";/);
    expect(code).toMatch(/if \(status === "failed"\) return "tool-error";/);
  });

  it("leaves a still-running call on the neutral card, because it has no outcome to colour", () => {
    // `toolBlockKind` returns `null` for everything that is not finished,
    // and `useToolCardStyle` turns that into no style override at all —
    // so a running call keeps `Card`'s own surface.
    const code = readCode();
    expect(code).toMatch(/if \(kind === null\) return undefined;/);
  });

  it("applies the override to BOTH cards, so a generic tool is coloured like a known one", () => {
    const code = readCode();
    const matches = code.match(/<Card style=\{cardStyle\} testID=\{testId\}>/g) ?? [];
    expect(matches).toHaveLength(2);
  });

  it("keeps the status in words beside the fill, so colour is never the only signal", () => {
    expect(readCode()).toMatch(/statusText=\{statusTextFor\(tool\.status\)\}/);
  });
});

describe("tool-call-row.tsx: the shell call is the artifact's .bash (T359)", () => {
  it("draws BashBlock rather than the two stacked CodeBlocks it used to", () => {
    const code = readCode();
    expect(code).toMatch(/<BashBlock\s+command=\{tool\.command\}/);
    expect(code).not.toMatch(/<CodeBlock code=\{tool\.command\} language="bash" \/>/);
  });

  it("bounds the output before handing it over, the same way the old block did", () => {
    expect(readCode()).toMatch(
      /output=\{tool\.output === undefined \? undefined : truncateBody\(tool\.output\)\}/,
    );
  });

  it("names this platform's own stop control, only while the command is running", () => {
    const code = readCode();
    expect(code).toMatch(/cancelHint=\{running \? ABORT_ACTION_LABEL : undefined\}/);
    // The artifact's desktop-only keyboard hint, which Android cannot
    // honour and therefore must not print.
    expect(code).not.toMatch(/esc to cancel/);
  });

  it("takes the dim variant from the model, not from an inline status check", () => {
    expect(readCode()).toMatch(/dimmed=\{shellBlockIsDimmed\(tool\.status\)\}/);
  });

  it("gates the shimmer on reduced motion at the call site, where the theme is", () => {
    const code = readCode();
    expect(code).toMatch(/shimmer=\{running && !reduceMotion\}/);
  });

  it("keeps the exit code and the cwd as plain text beside the block", () => {
    // Both are facts about the call rather than part of the terminal
    // output, and the artifact's `.bash` has nowhere to put them.
    const code = readCode();
    expect(code).toMatch(/`cwd: \$\{tool\.cwd\}`/);
    expect(code).toMatch(/`Exit code: \$\{tool\.exitCode \?\? "—"\}`/);
  });
});
