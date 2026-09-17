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
  it("takes the card's fill, ring and outline from the shared block table, never from a colour written here", () => {
    const code = readCode();
    expect(code).toMatch(/blockSurface\(kind\)/);
    expect(code).toMatch(/blockRing\(kind\)/);
    expect(code).toMatch(/blockOutline\(kind\)/);
    expect(code).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  });

  it("maps a finished call to tool-ok and a failed one to tool-error", () => {
    const code = readCode();
    expect(code).toMatch(/if \(status === "completed"\) return "tool-ok";/);
    expect(code).toMatch(/if \(status === "failed"\) return "tool-error";/);
  });

  it("leaves a still-running call on the artifact's own `.blk` resting fill, because it has no outcome to colour", () => {
    // `toolBlockKind` returns `null` for everything that is not finished,
    // and `useToolBlockStyle` turns that into the artifact's default
    // `inset` fill, the `.blk` hairline, and no outcome tint.
    const code = readCode();
    expect(code).toMatch(/const kind = toolBlockKind\(status\);/);
    expect(code).toMatch(
      /const surface = kind === null \? "inset" : \(blockSurface\(kind\) \?\? "inset"\);/,
    );
  });

  it("applies the block frame to BOTH cards, so a generic tool is drawn like a known one", () => {
    const code = readCode();
    const matches =
      code.match(/<View style=\{\[styles\.block, blockStyle\]\} testID=\{testId\}>/g) ?? [];
    expect(matches).toHaveLength(2);
  });

  it("draws the artifact's `.blk` geometry rather than a Card's", () => {
    const code = readCode();
    expect(code).toMatch(/borderRadius: BLOCK_RADIUS/);
    expect(code).toMatch(/paddingVertical: BLOCK_PADDING_VERTICAL/);
    expect(code).toMatch(/paddingHorizontal: BLOCK_PADDING_HORIZONTAL/);
    expect(code).not.toMatch(/<Card\b/);
  });

  it("renders the header's `.tchip` from toolHeaderChipLabel, in `teal` on `surface` (A-TEAL)", () => {
    // android-spec.html: `.pa{color:var(--teal)}` — the chip text, not the
    // `.tchip` box (background/border stay as they were before A-TEAL).
    const code = readCode();
    expect(code).toMatch(/const chipLabel = toolHeaderChipLabel\(tool\);/);
    expect(code).toMatch(/\{chipLabel\}/);
    expect(code).toMatch(/color: theme\.colors\.teal/);
    expect(code).toMatch(/borderRadius: TOOL_CHIP_RADIUS/);
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

describe("tool-call-row.tsx: the `.xbtn` expand affordance (W4-TOOLBLOCK)", () => {
  it("pins android-spec.html's exact `.xbtn` geometry as literal RN constants", () => {
    // `.xbtn{right:8px;top:7px;width:26px;height:26px}`, and the
    // artifact's own `<svg width="11" height="11">` chevron. A test that
    // only matched the identifier, not its value, would pass against a
    // drifted number — see this file's own header comment on why every
    // assertion here is positive AND value-bearing.
    const code = readCode();
    expect(code).toMatch(/^const TOOL_XBTN_SIZE_DP = 26;$/m);
    expect(code).toMatch(/^const TOOL_XBTN_OFFSET_TOP_DP = 7;$/m);
    expect(code).toMatch(/^const TOOL_XBTN_OFFSET_RIGHT_DP = 8;$/m);
    expect(code).toMatch(/^const TOOL_XBTN_ICON_SIZE_DP = 11;$/m);
  });

  it("pads the 26dp button out to the 48dp touch floor with a literal hitSlop of 11", () => {
    // 26 + 2*11 = 48 — `ui/primitives/touch-targets.test.ts` only resolves
    // this prop as a bare digit literal, never an identifier (see the
    // constant this pattern replaces, named in this file's own comment
    // just above the prop).
    expect(readCode()).toMatch(/hitSlop=\{11\}/);
  });

  it("reserves `.blk.hasx>.ln:first-child{padding-right:34px}` on the header when the button is shown", () => {
    const code = readCode();
    expect(code).toMatch(/^const TOOL_XBTN_HEADER_RESERVE_DP = 34;$/m);
    expect(code).toMatch(/reserveExpandButton \? styles\.headerReserveExpandButton : null/);
  });

  it("shows the button on both cards, gated by toolCardHasExpandButton, never unconditionally", () => {
    const code = readCode();
    const matches = code.match(/hasExpandButton \? \(\s*<ExpandButton/g) ?? [];
    expect(matches).toHaveLength(2);
    expect(code).toMatch(/const hasExpandButton = toolCardHasExpandButton\(tool\);/g);
  });

  it("drives the rotation with the artifact's own 280ms overshoot spring, not the shared press spring", () => {
    const code = readCode();
    expect(code).toMatch(/duration: TOOL_XBTN_ROTATION_DURATION_MS,/);
    expect(code).toMatch(/easing: Easing\.bezier\(\.\.\.TOOL_XBTN_ROTATION_EASING\),/);
  });

  it("collapses the rotation to an instant jump under reduced motion, like every other themed animation here", () => {
    expect(readCode()).toMatch(
      /rotation\.value = reduceMotion\s*\? target\s*: withTiming\(target, \{/,
    );
  });

  it("announces Expand/Collapse and the expanded accessibility state, never colour or rotation alone", () => {
    const code = readCode();
    expect(code).toMatch(/accessibilityLabel=\{toolExpandButtonAccessibilityLabel\(expanded\)\}/);
    expect(code).toMatch(/accessibilityState=\{\{ expanded \}\}/);
    expect(code).toMatch(/accessibilityRole="button"/);
  });

  it("ports the hover step (9%\u219215% ink overlay) as the pressed state, since there is no :hover on Android", () => {
    const code = readCode();
    expect(code).toMatch(
      /pressed \? TOOL_XBTN_BACKGROUND_ALPHA_PRESSED : TOOL_XBTN_BACKGROUND_ALPHA_REST/,
    );
    expect(code).toMatch(/inkOverlayColor\(\s*theme\.colors\.ink,/);
  });
});

describe('tool-call-row.tsx: "renderResult returns \\"\\" unless expanded or errored" (W4-TOOLBLOCK)', () => {
  it("gates each family's Body, and the generic card's panels, behind bodyVisible — never unconditionally", () => {
    const code = readCode();
    const matches = code.match(/\{bodyVisible \? \(/g) ?? [];
    expect(matches).toHaveLength(2);
    expect(code).toMatch(/const bodyVisible = toolBodyIsVisible\(tool, expanded\);/g);
  });

  it("keeps the header-level one-liners (summary, failed errorText) OUTSIDE the gate", () => {
    // These sit beside the header as always-visible facts, not inside
    // "the rest" the button reveals.
    const code = readCode();
    expect(code).toMatch(
      /\{tool\.summary \? <Text style=\{styles\.meta\}>\{tool\.summary\}<\/Text> : null\}\s*\n\s*\{tool\.status === "failed" && tool\.errorText \?/,
    );
  });
});

describe("tool-call-row.tsx: the highlighted body (W4-TOOLBLOCK)", () => {
  it("renders a read call's content through the highlighter, not the plain CodeListing recipe", () => {
    const code = readCode();
    expect(code).toMatch(/<HighlightedFileBody\s+path=\{tool\.filePath\}/);
    expect(code).not.toMatch(/<CodeListing/);
  });

  it("bounds the body with capHighlightedLines before anything is tokenized", () => {
    const code = readCode();
    expect(code).toMatch(/const capped = capHighlightedLines\(code\.split\("\\n"\)\);/);
    // The cap is applied to the STRING handed to the tokenizer, not after
    // it — a 4000-line read must parse ten lines, not four thousand.
    expect(code).toMatch(/tokenizeFileContent\(capped\.visible\.join\("\\n"\), path\)/);
  });

  it("uses the highlighter this repository already ships, not a second one", () => {
    const code = readCode();
    // REWRITTEN at the P10-W4 merge gate. This said the body tokenizes
    // with `tokenizeHighlightLine` and colours from `HIGHLIGHT_ROLE_COLOR`
    // — a hand-rolled tokenizer and five hardcoded hexes this wave first
    // shipped, both since deleted. `@picompanion/highlight`'s Lezer build
    // was already this app's tokenizer for the file view, and the five
    // hexes failed AA on the light code surface (worst 1.47:1). See
    // `docs/issues-from-plan.md` P10-12.
    expect(code).toMatch(
      /import \{ syntaxColorKey, tokenizeFileContent \} from "\.\.\/files\/file-syntax-highlight";/,
    );
    expect(code).not.toMatch(/syntax-highlight-model/);
  });

  it("colours a token from the themed syntax palette only when it has a role", () => {
    const code = readCode();
    expect(code).toMatch(/const key = syntaxColorKey\(token\.style\);/);
    expect(code).toMatch(/color: theme\.colors\.code\.syntax\[key\]/);
    // The whole file, not just this one component: every colour in this
    // file is a theme or model token, never a raw hex product colour
    // (plan.md §10.2) — this test's own file-wide sibling above already
    // pins that for the block frame; this line pins it again for the
    // reader looking specifically at the new highlighted-body code.
    expect(code).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  });

  it("shows a visible, named truncation notice when the 10-line cap hides lines, never a silent cut", () => {
    expect(readCode()).toMatch(/\{capped\.truncatedNotice \? <Text/);
  });
});
