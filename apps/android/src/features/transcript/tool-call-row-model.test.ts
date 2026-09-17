import { describe, expect, it } from "vitest";
import { tools } from "@picompanion/frontend-core";
import type { timeline } from "@picompanion/frontend-core";

const { KNOWN_TOOL_CALL_FAMILIES } = tools;

import {
  DIFF_LINE_CAP,
  MAX_PAYLOAD_CHARS,
  STATUS_TEXT,
  STATUS_TONE,
  areToolCallRowPropsEqual,
  boundedRedactedSummary,
  cardKindFor,
  SEARCH_MATCH_LINE_CAP,
  diffCounts,
  diffLineInputsFor,
  diffLinesFor,
  filterToolCallEntries,
  formatToolDuration,
  formatToolElapsedWithTenths,
  genericInputSummary,
  genericResultSummary,
  inkOverlayColor,
  isKnownToolCall,
  isToolCallEntry,
  redactValue,
  resolvedEdits,
  searchCountsLine,
  searchMatchLines,
  shellBlockIsDimmed,
  statusTextFor,
  HIGHLIGHT_LINE_CAP,
  capHighlightedLines,
  toolBodyIsVisible,
  toolCardHasExpandButton,
  toolElapsedMs,
  toolExpandButtonAccessibilityLabel,
  toolHeaderChipLabel,
  truncateBody,
  unrecognizedToolMeta,
  worktreeCommandStepStatus,
  TOOL_XBTN_BACKGROUND_ALPHA_PRESSED,
  TOOL_XBTN_BACKGROUND_ALPHA_REST,
  TOOL_XBTN_ROTATION_CLOSED_DEG,
  TOOL_XBTN_ROTATION_DURATION_MS,
  TOOL_XBTN_ROTATION_EASING,
  TOOL_XBTN_ROTATION_OPEN_DEG,
  type ToolCallTranscriptEntry,
} from "./tool-call-row-model";

function toolEntry(tool: tools.ToolCallViewModel): ToolCallTranscriptEntry {
  return {
    kind: "tool-call",
    id: "row-tc",
    epoch: "epoch-1",
    seqStart: 1,
    seqEnd: 1,
    timestamp: "2026-01-01T00:00:00.000Z",
    provider: "pi",
    pending: false,
    stale: false,
    tool,
  } as ToolCallTranscriptEntry;
}

const SHELL_TOOL: tools.ShellToolCallViewModel = {
  family: "shell",
  callId: "call-1",
  toolName: "bash",
  status: "completed",
  displayName: "Ran a shell command",
  updateCount: 1,
  command: "pnpm test",
};

const GENERIC_TOOL: tools.GenericToolCallViewModel = {
  family: "generic",
  callId: "call-2",
  toolName: "mcp.custom_future_tool",
  status: "completed",
  displayName: "mcp.custom_future_tool",
  updateCount: 1,
  source: "mcp",
  collapsibleInput: { note: "hello", nested: { depth: 1 } },
  result: { ok: true },
  copyPayload: '{"toolName":"mcp.custom_future_tool"}',
  reportPayload: {
    toolName: "mcp.custom_future_tool",
    callId: "call-2",
    status: "completed",
    reason: "Unrecognized detail.type from a newer protocol version.",
  },
};

describe("isToolCallEntry / filterToolCallEntries", () => {
  it("accepts only the tool-call kind", () => {
    const message: timeline.TranscriptEntry = {
      kind: "user-message",
      id: "row-1",
      epoch: "epoch-1",
      seqStart: 1,
      seqEnd: 1,
      timestamp: "2026-01-01T00:00:00.000Z",
      provider: "pi",
      pending: false,
      stale: false,
      text: "hi",
    };
    const call = toolEntry(SHELL_TOOL);
    expect(isToolCallEntry(call)).toBe(true);
    expect(isToolCallEntry(message)).toBe(false);
    expect(filterToolCallEntries([message, call])).toEqual([call]);
  });
});

describe("status text is present for every status, and distinct from mere tone", () => {
  it("gives every ToolCallViewStatus non-empty, distinct visible text", () => {
    const statuses: tools.ToolCallViewStatus[] = [
      "running",
      "blocked",
      "completed",
      "failed",
      "canceled",
    ];
    const texts = statuses.map((status) => statusTextFor(status));
    for (const text of texts) {
      expect(text.length).toBeGreaterThan(0);
    }
    // No two statuses collapse to the same visible word — a screen-reader
    // user (or a sighted user with colour vision deficiency) can always
    // tell them apart from the text alone.
    expect(new Set(texts).size).toBe(statuses.length);
    expect(STATUS_TEXT.blocked).toBe("Waiting for approval");
    expect(STATUS_TEXT.failed).toBe("Failed");
  });

  it("gives every status a tone distinct from STATUS_TEXT's own keys — colour and text are two separate carriers", () => {
    const tones = new Set(Object.values(STATUS_TONE));
    expect(tones.has("success")).toBe(true);
    expect(tones.has("danger")).toBe(true);
    expect(STATUS_TONE.blocked).toBe("warning");
  });
});

describe("formatToolDuration", () => {
  it("formats under a minute as seconds", () => {
    expect(formatToolDuration(4200)).toBe("4s");
    expect(formatToolDuration(0)).toBe("0s");
  });
  it("formats a minute or more as minutes and seconds", () => {
    expect(formatToolDuration(65_000)).toBe("1m 5s");
  });
});

describe("toolElapsedMs: the live-vs-frozen elapsed value (W10-ELAPSED)", () => {
  it("advances with nowMs for a running call, computed from startedAt", () => {
    const tool: tools.ToolCallViewModel = {
      ...SHELL_TOOL,
      status: "running",
      startedAt: 1_000,
      durationMs: undefined,
    };
    expect(toolElapsedMs(tool, 1_000)).toBe(0);
    expect(toolElapsedMs(tool, 5_200)).toBe(4_200);
  });

  it("stays at the stored durationMs for a finished call, ignoring nowMs entirely", () => {
    const tool: tools.ToolCallViewModel = {
      ...SHELL_TOOL,
      status: "completed",
      startedAt: 1_000,
      durationMs: 4_200,
    };
    expect(toolElapsedMs(tool, 1_000)).toBe(4_200);
    expect(toolElapsedMs(tool, 999_999)).toBe(4_200);
  });

  it("returns undefined when neither a live base (running, no startedAt) nor a stored duration is knowable", () => {
    const runningNoStart: tools.ToolCallViewModel = {
      ...SHELL_TOOL,
      status: "running",
      startedAt: undefined,
      durationMs: undefined,
    };
    expect(toolElapsedMs(runningNoStart, 5_000)).toBeUndefined();

    const blockedNoDuration: tools.ToolCallViewModel = {
      ...SHELL_TOOL,
      status: "blocked",
      startedAt: undefined,
      durationMs: undefined,
    };
    expect(toolElapsedMs(blockedNoDuration, 5_000)).toBeUndefined();
  });

  it("clamps a negative clock-skew delta to 0, never a negative duration", () => {
    const tool: tools.ToolCallViewModel = {
      ...SHELL_TOOL,
      status: "running",
      startedAt: 10_000,
      durationMs: undefined,
    };
    expect(toolElapsedMs(tool, 4_000)).toBe(0);
  });
});

describe("formatToolElapsedWithTenths: the spec's own tenths-below-60s readout", () => {
  it("formats a value under 60s with exactly one decimal", () => {
    expect(formatToolElapsedWithTenths(4_200)).toBe("4.2s");
  });

  it("formats a sub-second value the same way", () => {
    expect(formatToolElapsedWithTenths(400)).toBe("0.4s");
  });

  it("formats exactly 60s as 1m 0.0s, not 60.0s", () => {
    expect(formatToolElapsedWithTenths(60_000)).toBe("1m 0.0s");
  });

  it("formats a value above 60s as minutes plus a decimal-second remainder", () => {
    expect(formatToolElapsedWithTenths(65_000)).toBe("1m 5.0s");
  });
});

describe("truncateBody", () => {
  it("leaves short text untouched", () => {
    expect(truncateBody("hello")).toBe("hello");
  });
  it("bounds long text with a visible truncation suffix", () => {
    const long = "a".repeat(5000);
    const result = truncateBody(long, 100);
    expect(result.length).toBeLessThanOrEqual(100);
    expect(result).toContain("truncated for display");
  });
});

describe("card-selection: cardKindFor / isKnownToolCall track every KNOWN_TOOL_CALL_FAMILIES entry", () => {
  it("maps every known family to itself, and generic to generic", () => {
    for (const family of KNOWN_TOOL_CALL_FAMILIES) {
      const tool = { ...SHELL_TOOL, family } as unknown as tools.ToolCallViewModel;
      expect(cardKindFor(tool)).toBe(family);
      expect(isKnownToolCall(tool)).toBe(true);
    }
    expect(cardKindFor(GENERIC_TOOL)).toBe("generic");
    expect(isKnownToolCall(GENERIC_TOOL)).toBe(false);
  });
});

describe("edit family: diffCounts / diffTextFor / resolvedEdits", () => {
  const EDIT_TOOL: tools.EditToolCallViewModel = {
    family: "edit",
    callId: "call-3",
    toolName: "edit",
    status: "completed",
    displayName: "Edited index.ts",
    updateCount: 1,
    filePath: "/synthetic/index.ts",
    unifiedDiff: "--- a/index.ts\n+++ b/index.ts\n-const a = 1;\n+const a = 2;\n",
    isMultiEdit: false,
  };

  it("counts +/- lines from a unifiedDiff, ignoring the +++/--- header lines (via the shared T34B3 diff-model parser)", () => {
    expect(diffCounts(EDIT_TOOL)).toEqual({ added: 1, removed: 1 });
  });

  it("counts 0/0 for an edit tool with neither a unifiedDiff nor edits", () => {
    const empty: tools.EditToolCallViewModel = {
      ...EDIT_TOOL,
      unifiedDiff: undefined,
      oldString: undefined,
      newString: undefined,
      edits: undefined,
    };
    expect(resolvedEdits(empty)).toHaveLength(0);
    expect(diffCounts(empty)).toEqual({ added: 0, removed: 0 });
    expect(diffLinesFor(empty)).toBeUndefined();
  });

  it("synthesizes a diff and counts from edits when there is no unifiedDiff", () => {
    const multiEdit: tools.EditToolCallViewModel = {
      ...EDIT_TOOL,
      unifiedDiff: undefined,
      isMultiEdit: true,
      edits: [
        { oldString: "a\nb", newString: "a\nc" },
        { oldString: "x", newString: "y\nz" },
      ],
    };
    expect(resolvedEdits(multiEdit)).toHaveLength(2);
    // added: "a","c" (edit 1) + "y","z" (edit 2) = 4; removed: "a","b" (edit
    // 1) + "x" (edit 2) = 3 — same totals the old ad hoc reduce produced,
    // now computed by the shared `countDiffLines`/`parseUnifiedDiffLines`.
    expect(diffCounts(multiEdit)).toEqual({ added: 4, removed: 3 });
    const lines = diffLinesFor(multiEdit);
    expect(lines?.text).toContain("-a");
    expect(lines?.text).toContain("-b");
    expect(lines?.text).toContain("+y");
    expect(lines?.text).toContain("+z");
    expect(lines?.truncatedNotice).toBeUndefined();
  });

  it("does not truncate a diff at exactly DIFF_LINE_CAP lines (the boundary)", () => {
    const exactDiff = Array.from({ length: DIFF_LINE_CAP }, (_, i) => `+line ${i}`).join("\n");
    const tool: tools.EditToolCallViewModel = { ...EDIT_TOOL, unifiedDiff: exactDiff };
    const lines = diffLinesFor(tool);
    expect(lines).toBeDefined();
    expect(lines!.totalLines).toBe(DIFF_LINE_CAP);
    expect(lines!.visibleLines).toBe(DIFF_LINE_CAP);
    expect(lines!.hiddenLines).toBe(0);
    expect(lines!.truncatedNotice).toBeUndefined();
    expect(lines!.text).toBe(exactDiff);
  });

  it("truncates a diff one line past DIFF_LINE_CAP, with a visible named notice carrying the true total", () => {
    const overDiff = Array.from({ length: DIFF_LINE_CAP + 1 }, (_, i) => `+line ${i}`).join("\n");
    const tool: tools.EditToolCallViewModel = { ...EDIT_TOOL, unifiedDiff: overDiff };
    const lines = diffLinesFor(tool);
    expect(lines).toBeDefined();
    expect(lines!.totalLines).toBe(DIFF_LINE_CAP + 1);
    expect(lines!.visibleLines).toBe(DIFF_LINE_CAP);
    expect(lines!.hiddenLines).toBe(1);
    expect(lines!.truncatedNotice).toBe(
      `Showing first ${DIFF_LINE_CAP} of ${DIFF_LINE_CAP + 1} diff lines (1 more line hidden).`,
    );
    // the visible text itself is exactly the first DIFF_LINE_CAP lines —
    // never the whole, untruncated diff.
    expect(lines!.text.split("\n")).toHaveLength(DIFF_LINE_CAP);
    expect(lines!.text).not.toContain(`line ${DIFF_LINE_CAP}`);
    // counts are still computed over the FULL diff, not the visible slice.
    expect(diffCounts(tool)).toEqual({ added: DIFF_LINE_CAP + 1, removed: 0 });
  });

  it("bounds a huge (2000-line) diff far below DIFF_LINE_CAP, never returning it whole", () => {
    const hugeDiff = Array.from({ length: 2000 }, (_, i) => `+line ${i}`).join("\n");
    const tool: tools.EditToolCallViewModel = { ...EDIT_TOOL, unifiedDiff: hugeDiff };
    const lines = diffLinesFor(tool);
    expect(lines).toBeDefined();
    expect(lines!.text.length).toBeLessThan(hugeDiff.length);
    expect(lines!.hiddenLines).toBe(2000 - DIFF_LINE_CAP);
    expect(lines!.truncatedNotice).toContain(`${2000 - DIFF_LINE_CAP} more lines hidden`);
  });
});

describe("search family: searchCountsLine", () => {
  it("joins available counts and omits missing ones", () => {
    const tool: tools.SearchToolCallViewModel = {
      family: "search",
      callId: "call-4",
      toolName: "grep",
      status: "completed",
      displayName: "Searched",
      updateCount: 1,
      query: "TODO",
      numFiles: 3,
      numMatches: 7,
    };
    expect(searchCountsLine(tool)).toBe("3 files, 7 matches");
    expect(searchCountsLine({ ...tool, numFiles: undefined })).toBe("7 matches");
    expect(
      searchCountsLine({ ...tool, numFiles: undefined, numMatches: undefined }),
    ).toBeUndefined();
  });
});

describe("worktreeCommandStepStatus", () => {
  it("maps every wire status to a WorkflowSteps status", () => {
    expect(worktreeCommandStepStatus("running")).toBe("active");
    expect(worktreeCommandStepStatus("completed")).toBe("complete");
    expect(worktreeCommandStepStatus("failed")).toBe("error");
  });
});

describe("the safe generic card: redaction never surfaces the raw payload", () => {
  it("redacts a value under a secret-shaped key regardless of its value", () => {
    const redacted = redactValue({ apiKey: "not-a-known-shape-but-the-key-says-secret" }) as Record<
      string,
      unknown
    >;
    expect(redacted.apiKey).toBe("[redacted]");
  });

  it("redacts a secret-shaped value even under an innocuous key", () => {
    const ghToken = `ghp_${"a".repeat(36)}`;
    const redacted = redactValue({ value: ghToken }) as Record<string, unknown>;
    expect(redacted.value).toBe("[redacted]");
  });

  it("redacts nested and array-nested secrets", () => {
    const jwtLike =
      "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U";
    const redacted = redactValue({
      args: [{ headers: { Authorization: `Bearer ${jwtLike}` } }],
    }) as Record<string, unknown>;
    const args = redacted.args as Array<Record<string, unknown>>;
    const headers = args[0]!.headers as Record<string, unknown>;
    expect(headers.Authorization).toBe("[redacted]");
  });

  it("leaves ordinary, non-secret-shaped data untouched", () => {
    const redacted = redactValue({ note: "read the readme", count: 3, ok: true, nothing: null });
    expect(redacted).toEqual({ note: "read the readme", count: 3, ok: true, nothing: null });
  });

  // T60A regression: the pre-unification value patterns were
  // `^...$`-anchored, so a secret embedded in a longer string (exactly
  // the shape a shell-ish unknown tool call produces) survived
  // verbatim. Proven directly against `@picompanion/frontend-core`'s
  // `security.isSecretShapedValue` in `packages/frontend-core/src/
  // security/secret-shape.test.ts`; this proves the fix reaches this
  // call site's redaction too.
  it("redacts a Bearer token embedded inside a longer command string, not just a value that IS the token", () => {
    const payload = {
      command: "curl -H 'Authorization: Bearer sk-LIVEKEY1234567890' https://api.example.com",
    };
    const summary = genericInputSummary({ ...GENERIC_TOOL, collapsibleInput: payload });

    expect(summary).not.toContain("sk-LIVEKEY1234567890");
    expect(summary).not.toContain("Bearer sk-LIVEKEY1234567890");
    expect(summary).toContain("[redacted]");
  });

  it("bounds a payload containing something secret-shaped: proves neither the secret nor the raw payload ever appears", () => {
    const secretToken = `sk-${"x".repeat(48)}`;
    const payload = {
      toolName: "mystery_plugin_call",
      args: {
        apiKey: secretToken,
        password: "hunter2-but-also-secretly-long-enough-to-match",
        filePath: "/synthetic/workspace/notes.txt",
        payload: "x".repeat(10_000), // also proves the bound applies independent of redaction
      },
    };
    const summary = genericInputSummary({ ...GENERIC_TOOL, collapsibleInput: payload });

    expect(summary).not.toContain(secretToken);
    expect(summary).not.toContain("hunter2-but-also-secretly-long-enough-to-match");
    expect(summary).toContain("[redacted]");
    expect(summary).toContain("notes.txt"); // non-secret data still visible
    expect(summary.length).toBeLessThanOrEqual(MAX_PAYLOAD_CHARS);
  });

  it("genericResultSummary reads rawError when failed, result otherwise", () => {
    const failed: tools.GenericToolCallViewModel = {
      ...GENERIC_TOOL,
      status: "failed",
      result: undefined,
      rawError: { message: "boom", token: "sk-" + "z".repeat(40) },
    };
    expect(genericResultSummary(failed)).toContain("boom");
    expect(genericResultSummary(failed)).toContain("[redacted]");
    expect(genericResultSummary(GENERIC_TOOL)).toContain("ok");
  });

  it("bounds a self-referential value by depth rather than recursing forever or throwing", () => {
    const circular: Record<string, unknown> = { a: 1 };
    circular.self = circular;
    expect(() => boundedRedactedSummary(circular)).not.toThrow();
    expect(boundedRedactedSummary(circular)).toContain("[max depth exceeded]");
  });

  it("degrades to a placeholder, never throwing, when JSON.stringify itself cannot serialize the value", () => {
    // JSON.stringify throws a TypeError on a bigint anywhere in the tree —
    // this is the "unable to display" path, distinct from the
    // depth-bounded self-reference case above.
    const unserializable = { amount: 10n };
    expect(() => boundedRedactedSummary(unserializable)).not.toThrow();
    expect(boundedRedactedSummary(unserializable)).toBe("(unable to display this payload)");
  });

  it("boundedRedactedSummary reports '(none)' for undefined", () => {
    expect(boundedRedactedSummary(undefined)).toBe("(none)");
  });

  it("unrecognizedToolMeta names the tool and, when known, its source", () => {
    expect(unrecognizedToolMeta(GENERIC_TOOL)).toBe(
      "Unrecognized tool from mcp: mcp.custom_future_tool",
    );
    expect(unrecognizedToolMeta({ ...GENERIC_TOOL, source: undefined })).toBe(
      "Unrecognized tool: mcp.custom_future_tool",
    );
  });
});

describe("toolHeaderChipLabel: the one path or argument the header's `.tchip` names", () => {
  it("names the file for every file-family call", () => {
    for (const family of ["read", "write", "edit"] as const) {
      expect(
        toolHeaderChipLabel({
          family,
          callId: "c",
          toolName: family,
          status: "completed",
          displayName: family,
          updateCount: 1,
          filePath: "src/Button.tsx",
        } as tools.ToolCallViewModel),
      ).toBe("src/Button.tsx");
    }
  });

  it("names the query/url/command/branch for the families whose argument is the fact", () => {
    expect(toolHeaderChipLabel(SHELL_TOOL)).toBe("pnpm test");
    expect(
      toolHeaderChipLabel({
        family: "search",
        callId: "c",
        toolName: "grep",
        status: "completed",
        displayName: "Searched",
        updateCount: 1,
        query: "/variant/",
      } as tools.ToolCallViewModel),
    ).toBe("/variant/");
    expect(
      toolHeaderChipLabel({
        family: "fetch",
        callId: "c",
        toolName: "fetch",
        status: "completed",
        displayName: "Fetched",
        updateCount: 1,
        url: "https://example.com",
      } as tools.ToolCallViewModel),
    ).toBe("https://example.com");
    expect(
      toolHeaderChipLabel({
        family: "worktree_setup",
        callId: "c",
        toolName: "worktree",
        status: "completed",
        displayName: "Set up a worktree",
        updateCount: 1,
        worktreePath: "/tmp/wt",
        branchName: "phase3/t25a",
        log: "",
        commands: [],
      } as tools.ToolCallViewModel),
    ).toBe("phase3/t25a");
  });

  it("draws nothing for a family with no single such fact, rather than inventing one", () => {
    expect(toolHeaderChipLabel(GENERIC_TOOL)).toBeUndefined();
  });
});

describe("areToolCallRowPropsEqual", () => {
  it("treats an equivalent tool object as equal", () => {
    const entry = toolEntry(SHELL_TOOL);
    expect(
      areToolCallRowPropsEqual({ entry }, { entry: { ...entry, tool: { ...entry.tool } } }),
    ).toBe(true);
  });

  it("treats a status change as unequal", () => {
    const entry = toolEntry(SHELL_TOOL);
    expect(
      areToolCallRowPropsEqual(
        { entry },
        { entry: { ...entry, tool: { ...entry.tool, status: "failed" } } },
      ),
    ).toBe(false);
  });
});

function editToolWith(unifiedDiff?: string): tools.EditToolCallViewModel {
  return {
    family: "edit",
    callId: "call-358",
    toolName: "edit",
    status: "completed",
    displayName: "Edited Button.tsx",
    updateCount: 1,
    filePath: "/synthetic/Button.tsx",
    isMultiEdit: false,
    ...(unifiedDiff === undefined ? {} : { unifiedDiff }),
  };
}

describe("diffLineInputsFor: the .dl bands come from the same bounded slice (T358)", () => {
  it("classifies each line into the artifact's own three tones", () => {
    const tool = editToolWith(
      [
        "@@ -1,3 +1,3 @@",
        " const styles = {",
        "-  primary: blue,",
        "+  primary: accent,",
        " };",
      ].join("\n"),
    );
    expect(diffLineInputsFor(tool).map((line) => [line.tone, line.marker])).toEqual([
      ["ctx", " "],
      ["rem", "-"],
      ["add", "+"],
      ["ctx", " "],
    ]);
  });

  it("drops the hunk and file headers rather than colouring them", () => {
    const tool = editToolWith(
      ["diff --git a/x.ts b/x.ts", "--- a/x.ts", "+++ b/x.ts", "@@ -1 +1 @@", "+one"].join("\n"),
    );
    expect(diffLineInputsFor(tool)).toEqual([
      { key: "4", tone: "add", marker: "+", content: "one" },
    ]);
  });

  it("never exceeds the one cap diffLinesFor already applies", () => {
    const tool = editToolWith(Array.from({ length: DIFF_LINE_CAP + 40 }, () => "+x").join("\n"));
    expect(diffLineInputsFor(tool)).toHaveLength(DIFF_LINE_CAP);
    // Same bound, one owner: a second cap here would eventually
    // disagree with the truncation notice the card renders beside it.
    expect(diffLinesFor(tool)?.visibleLines).toBe(DIFF_LINE_CAP);
  });

  it("returns an empty list, not undefined, when the call carries no diff at all", () => {
    expect(diffLineInputsFor(editToolWith())).toEqual([]);
  });
});

describe("searchMatchLines: what a search card highlights (T358)", () => {
  it("splits the blob into lines and drops the blank ones", () => {
    expect(searchMatchLines("a.ts:1: hit\n\nb.ts:2: hit\n")).toEqual([
      "a.ts:1: hit",
      "b.ts:2: hit",
    ]);
  });

  it("trims trailing whitespace so a CRLF payload does not draw a ragged band", () => {
    expect(searchMatchLines("one   \r\ntwo\t\n")).toEqual(["one", "two"]);
  });

  it("caps the list, because truncateBody's character bound still allows hundreds of lines", () => {
    const many = Array.from({ length: SEARCH_MATCH_LINE_CAP + 25 }, (_, i) => `line ${i}`).join(
      "\n",
    );
    expect(searchMatchLines(many)).toHaveLength(SEARCH_MATCH_LINE_CAP);
    expect(searchMatchLines(many, 3)).toEqual(["line 0", "line 1", "line 2"]);
  });

  it("returns nothing for content that is only whitespace", () => {
    expect(searchMatchLines("\n \n\t\n")).toEqual([]);
  });
});

describe("shellBlockIsDimmed: which shell blocks lose their green (T359)", () => {
  it("dims a command that never ran", () => {
    expect(shellBlockIsDimmed("canceled")).toBe(true);
    expect(shellBlockIsDimmed("blocked")).toBe(true);
  });

  it("keeps a failed command green, because it ran and its output is the point", () => {
    // The card around it already carries `tool-error-bg` and a red
    // outline, so the failure is stated without dimming the one part
    // the reader came for.
    expect(shellBlockIsDimmed("failed")).toBe(false);
  });

  it("keeps a running and a finished command green", () => {
    expect(shellBlockIsDimmed("running")).toBe(false);
    expect(shellBlockIsDimmed("completed")).toBe(false);
  });
});

// W5-PEND: `toolCardHasExpandButton`/`toolBodyIsVisible` now take the whole
// tool (not a bare `status`), because whether a call HAS a collapsible
// result can no longer be read off its status word alone — see both
// functions' own doc comments in `tool-call-row-model.ts` for
// android-spec.html's exact frame count. `shellToolWith` below builds a
// fixture from the family this file already has (`SHELL_TOOL`) for every
// test in this section that is about the STATUS-only rules (finished /
// canceled / "no button means always visible"), which are unchanged from
// before this task for `shell` and every other family `foldableFamily
// AlreadyHasResult` does not name.
function shellToolWith(status: tools.ToolCallViewStatus): tools.ShellToolCallViewModel {
  return { ...SHELL_TOOL, status };
}

describe("toolCardHasExpandButton: android-spec.html's `.xbtn`, ported (W4-TOOLBLOCK / W5-PEND)", () => {
  it("shows the button once a call has finished, one way or the other", () => {
    expect(toolCardHasExpandButton(shellToolWith("completed"))).toBe(true);
    expect(toolCardHasExpandButton(shellToolWith("failed"))).toBe(true);
  });

  it("hides the button on a canceled call, the one finished status that produced nothing", () => {
    // android-spec.html's own "ctrl+c aborted" error frame — a call that
    // never got its result — also carries no `.xbtn`.
    expect(toolCardHasExpandButton(shellToolWith("canceled"))).toBe(false);
  });

  it("hides the button while running or blocked, for a family with no collapsible result of its own", () => {
    // `shell` never carries `data-r` in android-spec.html in ANY status —
    // see the function's own doc comment — so this stays `false` here
    // exactly as it was before this task, regardless of running/blocked.
    expect(toolCardHasExpandButton(shellToolWith("running"))).toBe(false);
    expect(toolCardHasExpandButton(shellToolWith("blocked"))).toBe(false);
  });
});

describe('toolBodyIsVisible: "renderResult returns \\"\\" unless expanded or errored"', () => {
  it("is hidden by default (collapsed) for a successful call", () => {
    expect(toolBodyIsVisible(shellToolWith("completed"), false)).toBe(false);
  });

  it("shows once the caller's own toggle is expanded", () => {
    expect(toolBodyIsVisible(shellToolWith("completed"), true)).toBe(true);
  });

  it("shows a failed call's body even while the toggle is still collapsed", () => {
    expect(toolBodyIsVisible(shellToolWith("failed"), false)).toBe(true);
  });

  it("a failed call's body stays visible when the toggle is also expanded", () => {
    expect(toolBodyIsVisible(shellToolWith("failed"), true)).toBe(true);
  });

  // REWRITTEN at the P10-W4 merge gate, and a reviewer could disagree, so
  // here is exactly what changed and why. This said:
  //
  //   it("is hidden by default for every other status too", () => {
  //     expect(toolBodyIsVisible("running", false)).toBe(false);
  //     ...
  //
  // which pinned a real defect rather than a rule. `running`, `blocked`
  // and `canceled` draw NO expand button, so "hidden by default" left
  // their bodies with no control that could ever reveal them — a running
  // shell command's streaming output was unreachable while it streamed.
  // The design never says this: its `.blk.pend` frames without `data-r`
  // all print their lines, and none carries an `.xbtn`. (CORRECTED at
  // the P10-W5 merge gate: this said "its eight `.blk.pend` frames".
  // Re-counted directly against the artifact there are ten `.blk.pend`
  // frames, one of which carries `data-r`, so nine carry none. The
  // count is dropped rather than re-pinned; the claim never needed it.)
  //
  // ADAPTED at W5-PEND: only the CALL FORM changed (a bare `status` string
  // became a full tool, per this section's own header comment) — the
  // statuses, the assertions, and the invariant they pin are byte-identical
  // to what P10-W4 shipped. `shell` is used because it is one of the
  // families W5-PEND deliberately left untouched for `running`/`blocked`
  // (see `toolCardHasExpandButton`'s own doc comment), so this test still
  // exercises exactly the defect P10-W4's comment names — a running SHELL
  // command's streaming output.
  it("always shows the body of a status that draws no expand button", () => {
    for (const status of ["running", "blocked", "canceled"] as const) {
      const tool = shellToolWith(status);
      expect(toolCardHasExpandButton(tool)).toBe(false);
      // Both toggle positions: there is no button, so the toggle is not
      // reachable and must not decide anything.
      expect(toolBodyIsVisible(tool, false)).toBe(true);
      expect(toolBodyIsVisible(tool, true)).toBe(true);
    }
  });

  it("never leaves a body hidden with no control able to reveal it", () => {
    // The invariant the rewritten test above is an instance of, stated
    // once over every status rather than over a hand-picked three. Kept on
    // `shell` (a family W5-PEND does not touch) so this test's guarantee —
    // unweakened, per that task's own instruction — is exactly what P10-W4
    // shipped, just called with a tool instead of a bare status.
    const statuses = ["completed", "failed", "running", "blocked", "canceled"] as const;
    for (const status of statuses) {
      const tool = shellToolWith(status);
      if (!toolBodyIsVisible(tool, false)) {
        expect(toolCardHasExpandButton(tool)).toBe(true);
      }
    }
  });
});

describe("W5-PEND: a still-running tool block can be expanded once it has a result", () => {
  // The one android-spec.html frame this task exists to port:
  // `<div class="blk pend" data-r>` — a still-running `write` whose body is
  // already a collapsed "187 lines" summary.
  function writeToolWith(
    status: tools.ToolCallViewStatus,
    content: string | undefined,
  ): tools.WriteToolCallViewModel {
    return {
      family: "write",
      callId: "call-w5-pend-write",
      toolName: "write",
      status,
      displayName: "Wrote Button.tsx",
      updateCount: 1,
      filePath: "packages/ui/src/Button.tsx",
      content,
    };
  }

  it("a running write that already has content gets the button and defaults collapsed, like any finished call", () => {
    const tool = writeToolWith("running", "line 1\nline 2\n… (187 lines)");
    expect(toolCardHasExpandButton(tool)).toBe(true);
    expect(toolBodyIsVisible(tool, false)).toBe(false);
    expect(toolBodyIsVisible(tool, true)).toBe(true);
  });

  it("a running write with nothing yet still shows whatever it has, with no button — the read-tsconfig.base.json sibling frame", () => {
    const tool = writeToolWith("running", undefined);
    expect(toolCardHasExpandButton(tool)).toBe(false);
    expect(toolBodyIsVisible(tool, false)).toBe(true);
    expect(toolBodyIsVisible(tool, true)).toBe(true);
  });

  it("a blocked call (waiting for approval) with content already available also gets the button", () => {
    // Not itself an android-spec.html frame (the spec's own `blocked`
    // analogue is `ask_user`, a family this task leaves untouched — see
    // `toolCardHasExpandButton`'s own doc comment), but `blocked` shares
    // `running`'s "no finished outcome to lean on" reasoning exactly, so it
    // is proven here rather than left unexercised.
    const tool = writeToolWith("blocked", "already written");
    expect(toolCardHasExpandButton(tool)).toBe(true);
    expect(toolBodyIsVisible(tool, false)).toBe(false);
  });

  it("the button's presence is the SAME for an edit whether it is running, blocked, or already finished — proving it now tracks the result, not the status word", () => {
    // `editToolWith` (below) fixes `status: "completed"`; every other
    // status is exercised here by overriding it, holding the diff itself
    // constant. `diffLinesFor` — the same helper `EditBody` itself calls —
    // is the "has a result" signal for `edit`, reused rather than
    // re-derived (see `foldableFamilyAlreadyHasResult`'s own doc comment).
    for (const status of ["running", "blocked", "completed"] as const) {
      const withDiff = { ...editToolWith("+const a = 2;"), status };
      expect(toolCardHasExpandButton(withDiff)).toBe(true);
    }
  });

  it("the full status × has-result matrix: the invariant holds everywhere, and the button tracks the result exactly while running or blocked", () => {
    const statuses: tools.ToolCallViewStatus[] = [
      "running",
      "blocked",
      "completed",
      "failed",
      "canceled",
    ];
    for (const status of statuses) {
      for (const hasResult of [true, false]) {
        const tool = { ...editToolWith(hasResult ? "+line" : undefined), status };
        const button = toolCardHasExpandButton(tool);

        // The invariant W4-TOOLBLOCK added and this task must not weaken:
        // a body is never hidden with no control able to reveal it.
        if (!toolBodyIsVisible(tool, false)) {
          expect(button).toBe(true);
        }

        // The rule this task changes: while running or blocked, the button
        // tracks `hasResult` exactly — not `true` for every status
        // (W4-TOOLBLOCK's bug) and not `false` for every status (which
        // would just move the bug rather than fix it).
        if (status === "running" || status === "blocked") {
          expect(button).toBe(hasResult);
        }
        // Once finished, `completed`/`failed` still always draw the
        // button (android-spec.html's nine finished `data-r` frames have
        // zero counterexamples — see `toolCardHasExpandButton`'s own doc
        // comment) regardless of `hasResult`, and `canceled` never does.
        if (status === "completed" || status === "failed") {
          expect(button).toBe(true);
        }
        if (status === "canceled") {
          expect(button).toBe(false);
        }
      }
    }
  });
});

describe("capHighlightedLines: the design's own 10-line cap", () => {
  it("declares HIGHLIGHT_LINE_CAP as 10", () => {
    expect(HIGHLIGHT_LINE_CAP).toBe(10);
  });

  it("passes a short body through untouched, with no notice", () => {
    const capped = capHighlightedLines(["a", "b", "c"]);
    expect(capped.visible).toEqual(["a", "b", "c"]);
    expect(capped.hiddenLines).toBe(0);
    expect(capped.truncatedNotice).toBeUndefined();
  });

  it("bounds a long body to the cap and names exactly how much is hidden", () => {
    const lines = Array.from({ length: 14 }, (_, index) => `line ${index}`);
    const capped = capHighlightedLines(lines);
    expect(capped.visible).toHaveLength(HIGHLIGHT_LINE_CAP);
    expect(capped.totalLines).toBe(14);
    expect(capped.hiddenLines).toBe(4);
    expect(capped.truncatedNotice).toBe("Showing first 10 of 14 lines (4 more lines hidden).");
  });

  it("says 'line', singular, when exactly one is hidden", () => {
    const capped = capHighlightedLines(Array.from({ length: 11 }, (_, i) => `l${i}`));
    expect(capped.truncatedNotice).toBe("Showing first 10 of 11 lines (1 more line hidden).");
  });
});

describe("toolExpandButtonAccessibilityLabel", () => {
  it("reads Expand when collapsed and Collapse when open", () => {
    expect(toolExpandButtonAccessibilityLabel(false)).toBe("Expand");
    expect(toolExpandButtonAccessibilityLabel(true)).toBe("Collapse");
  });
});

describe("the .xbtn rotation spring — android-spec.html: `transition:transform .28s cubic-bezier(.34,1.56,.64,1)`", () => {
  it("is 280ms", () => {
    expect(TOOL_XBTN_ROTATION_DURATION_MS).toBe(280);
  });

  it("is the exact cubic-bezier control points, not `../../ui/theme/expressive-motion.ts`'s unrelated overshoot spring", () => {
    expect(TOOL_XBTN_ROTATION_EASING).toEqual([0.34, 1.56, 0.64, 1]);
  });

  it("rotates from 0deg (collapsed) to 180deg (open)", () => {
    expect(TOOL_XBTN_ROTATION_CLOSED_DEG).toBe(0);
    expect(TOOL_XBTN_ROTATION_OPEN_DEG).toBe(180);
  });
});

describe("the .xbtn background overlay — android-spec.html: `color-mix(in oklab, var(--ink) 9%|15%, transparent)`", () => {
  it("is 9% at rest and 15% pressed (the ported hover step)", () => {
    expect(TOOL_XBTN_BACKGROUND_ALPHA_REST).toBe(0.09);
    expect(TOOL_XBTN_BACKGROUND_ALPHA_PRESSED).toBe(0.15);
  });
});

describe("inkOverlayColor: color-mix(in oklab, ink N%, transparent) === ink at N% alpha", () => {
  it("resolves the dark theme's own ink (#f2f3f4) at the rest and pressed alphas", () => {
    // packages/design-tokens/src/tokens.ts's dark palette: ink: "#f2f3f4".
    expect(inkOverlayColor("#f2f3f4", TOOL_XBTN_BACKGROUND_ALPHA_REST)).toBe(
      "rgba(242, 243, 244, 0.09)",
    );
    expect(inkOverlayColor("#f2f3f4", TOOL_XBTN_BACKGROUND_ALPHA_PRESSED)).toBe(
      "rgba(242, 243, 244, 0.15)",
    );
  });

  it("resolves the light theme's own ink (#1f2124) the same way", () => {
    // packages/design-tokens/src/tokens.ts's light palette: ink: "#1f2124".
    expect(inkOverlayColor("#1f2124", TOOL_XBTN_BACKGROUND_ALPHA_REST)).toBe(
      "rgba(31, 33, 36, 0.09)",
    );
  });

  it("accepts a hex string with or without its leading #", () => {
    expect(inkOverlayColor("f2f3f4", 0.5)).toBe(inkOverlayColor("#f2f3f4", 0.5));
  });

  it("never throws on a malformed hex, and returns it unchanged", () => {
    expect(inkOverlayColor("not-a-color", 0.09)).toBe("not-a-color");
  });
});
