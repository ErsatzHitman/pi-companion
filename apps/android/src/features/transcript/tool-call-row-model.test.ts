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
  genericInputSummary,
  genericResultSummary,
  isKnownToolCall,
  isToolCallEntry,
  redactValue,
  resolvedEdits,
  searchCountsLine,
  searchMatchLines,
  shellBlockIsDimmed,
  statusTextFor,
  toolHeaderChipLabel,
  truncateBody,
  unrecognizedToolMeta,
  worktreeCommandStepStatus,
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
