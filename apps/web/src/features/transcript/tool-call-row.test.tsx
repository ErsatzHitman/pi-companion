import { cleanup, render, screen, within } from "@testing-library/react";
import { axe } from "jest-axe";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { timeline, tools } from "@picompanion/frontend-core";

import { isToolCallEntry, TranscriptToolCallRow } from "./tool-call-row.js";
import type { ToolCallTranscriptEntry } from "./tool-call-row.js";

afterEach(cleanup);

function toolEntry(
  tool: tools.ToolCallViewModel,
  overrides: Record<string, unknown> = {},
): ToolCallTranscriptEntry {
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
    ...overrides,
  } as ToolCallTranscriptEntry;
}

const SHELL_TOOL: tools.ShellToolCallViewModel = {
  family: "shell",
  callId: "call-1",
  toolName: "bash",
  status: "completed",
  displayName: "Ran a shell command",
  updateCount: 1,
  durationMs: 4200,
  command: "pnpm test",
  cwd: "/synthetic/workspace",
  output: "3 passed, 0 failed",
  exitCode: 0,
};

const READ_TOOL: tools.ReadToolCallViewModel = {
  family: "read",
  callId: "call-2",
  toolName: "read",
  status: "completed",
  displayName: "Read README.md",
  updateCount: 1,
  filePath: "/synthetic/workspace/README.md",
  content: "# Demo repo\n",
};

// A real (tiny, 1x1 transparent) PNG, base64-encoded — used to prove
// image-result detection decodes something real, not just a pattern
// match on the `data:image/...` prefix.
const ONE_PIXEL_PNG_DATA_URI =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

const EDIT_TOOL: tools.EditToolCallViewModel = {
  family: "edit",
  callId: "call-3",
  toolName: "edit",
  status: "completed",
  displayName: "Edited index.ts",
  updateCount: 1,
  filePath: "/synthetic/workspace/index.ts",
  unifiedDiff:
    "--- a/index.ts\n+++ b/index.ts\n-export const value = 1;\n+export const value = 2;\n",
  isMultiEdit: false,
};

const SEARCH_TOOL: tools.SearchToolCallViewModel = {
  family: "search",
  callId: "call-4",
  toolName: "grep",
  status: "failed",
  displayName: "Searched for TODO",
  updateCount: 1,
  query: "TODO",
  errorText: "permission denied",
};

const WORKTREE_TOOL: tools.WorktreeSetupToolCallViewModel = {
  family: "worktree_setup",
  callId: "call-5",
  toolName: "worktree_setup",
  status: "running",
  displayName: "Setting up worktree",
  updateCount: 1,
  worktreePath: "/synthetic/worktrees/feature",
  branchName: "feature/demo",
  log: "cloning…",
  commands: [
    {
      index: 0,
      command: "git clone",
      cwd: "/synthetic",
      log: "done",
      status: "completed",
      exitCode: 0,
    },
    {
      index: 1,
      command: "npm install",
      cwd: "/synthetic",
      log: "",
      status: "running",
      exitCode: null,
    },
  ],
};

const GENERIC_TOOL: tools.GenericToolCallViewModel = {
  family: "generic",
  callId: "call-6",
  toolName: "mcp.custom_future_tool",
  status: "completed",
  displayName: "mcp.custom_future_tool",
  updateCount: 1,
  source: "mcp",
  collapsibleInput: { note: "<script>alert(1)</script>", nested: { depth: 1 } },
  result: { ok: true },
  copyPayload: '{"toolName":"mcp.custom_future_tool"}',
  reportPayload: {
    toolName: "mcp.custom_future_tool",
    callId: "call-6",
    status: "completed",
    reason: "Unrecognized detail.type from a newer protocol version.",
  },
};

const GENERIC_FAILED_TOOL: tools.GenericToolCallViewModel = {
  ...GENERIC_TOOL,
  callId: "call-7",
  status: "failed",
  errorText: "boom",
  rawError: { message: "boom" },
  result: undefined,
};

describe("isToolCallEntry", () => {
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
    expect(isToolCallEntry(toolEntry(SHELL_TOOL))).toBe(true);
    expect(isToolCallEntry(message)).toBe(false);
  });
});

function stubClipboard(clipboard: Partial<Clipboard> | undefined) {
  Object.defineProperty(navigator, "clipboard", {
    value: clipboard,
    configurable: true,
  });
}

describe("TranscriptToolCallRow — known tool families render their specific card", () => {
  it("renders a shell card with command, output, and exit code", () => {
    render(<TranscriptToolCallRow entry={toolEntry(SHELL_TOOL)} testId="tc-shell" />);
    const card = screen.getByTestId("tc-shell");
    expect(within(card).getByText("Ran a shell command")).toBeTruthy();
    expect(within(card).getByText("pnpm test")).toBeTruthy();
    expect(within(card).getByText("3 passed, 0 failed")).toBeTruthy();
    expect(within(card).getByText(/Exit code: 0/)).toBeTruthy();
    expect(within(card).getByText("4s")).toBeTruthy();
  });

  it("renders a read card with the file path and a bounded content preview", () => {
    render(<TranscriptToolCallRow entry={toolEntry(READ_TOOL)} testId="tc-read" />);
    const card = screen.getByTestId("tc-read");
    expect(within(card).getByText("/synthetic/workspace/README.md")).toBeTruthy();
    expect(card.textContent).toContain("Demo repo");
  });

  it("renders an image result read from a file as an <img> with an accessible name", () => {
    const imageReadTool: tools.ReadToolCallViewModel = {
      ...READ_TOOL,
      callId: "call-2b",
      filePath: "/synthetic/workspace/logo.png",
      content: ONE_PIXEL_PNG_DATA_URI,
    };
    render(<TranscriptToolCallRow entry={toolEntry(imageReadTool)} testId="tc-read-image" />);
    const card = screen.getByTestId("tc-read-image");
    const image = within(card).getByRole("img", {
      name: "Image read from /synthetic/workspace/logo.png",
    });
    expect(image.getAttribute("src")).toBe(ONE_PIXEL_PNG_DATA_URI);
    // Never falls back to dumping the (large) base64 string as visible text.
    expect(card.textContent).not.toContain("base64");
  });

  it("renders an image result written to a file as an <img> with an accessible name", () => {
    const imageWriteTool: tools.WriteToolCallViewModel = {
      family: "write",
      callId: "call-2c",
      toolName: "write",
      status: "completed",
      displayName: "Wrote logo.png",
      updateCount: 1,
      filePath: "/synthetic/workspace/logo.png",
      content: ONE_PIXEL_PNG_DATA_URI,
    };
    render(<TranscriptToolCallRow entry={toolEntry(imageWriteTool)} testId="tc-write-image" />);
    const card = screen.getByTestId("tc-write-image");
    expect(
      within(card).getByRole("img", { name: "Image written to /synthetic/workspace/logo.png" }),
    ).toBeTruthy();
  });

  it("bounds an oversized image to a visible note instead of dropping or inlining it", () => {
    const hugeBase64Body = "A".repeat(4_000_000); // decodes to ~3MB, over the 2MB preview bound
    const imageReadTool: tools.ReadToolCallViewModel = {
      ...READ_TOOL,
      callId: "call-2d",
      filePath: "/synthetic/workspace/huge.png",
      content: `data:image/png;base64,${hugeBase64Body}`,
    };
    render(<TranscriptToolCallRow entry={toolEntry(imageReadTool)} testId="tc-read-huge-image" />);
    const card = screen.getByTestId("tc-read-huge-image");
    expect(within(card).queryByRole("img")).toBeNull();
    expect(card.textContent).toContain("Image omitted from preview");
    expect(card.textContent).toContain("KB exceeds");
  });

  it("renders an edit card with a diff summary badge and the full diff lines", () => {
    render(<TranscriptToolCallRow entry={toolEntry(EDIT_TOOL)} testId="tc-edit" />);
    const card = screen.getByTestId("tc-edit");
    expect(within(card).getByText("+1")).toBeTruthy();
    expect(within(card).getByText("-1")).toBeTruthy();
    expect(card.textContent).toContain("-export const value = 1;");
    expect(card.textContent).toContain("+export const value = 2;");
    const diffGroup = within(card).getByRole("group", { name: "Diff" });
    expect(diffGroup.querySelector(".pc-diff-line--add")?.textContent).toContain(
      "+export const value = 2;",
    );
    expect(diffGroup.querySelector(".pc-diff-line--remove")?.textContent).toContain(
      "-export const value = 1;",
    );
  });

  it("synthesizes a diff view from edits when there is no unifiedDiff string", () => {
    const multiEditTool: tools.EditToolCallViewModel = {
      ...EDIT_TOOL,
      callId: "call-3b",
      unifiedDiff: undefined,
      isMultiEdit: true,
      edits: [
        { oldString: "const a = 1;", newString: "const a = 2;" },
        { oldString: "const b = 1;", newString: "const b = 2;" },
      ],
    };
    render(<TranscriptToolCallRow entry={toolEntry(multiEditTool)} testId="tc-edit-multi" />);
    const card = screen.getByTestId("tc-edit-multi");
    expect(card.textContent).toContain("2 edits in this file");
    expect(card.textContent).toContain("-const a = 1;");
    expect(card.textContent).toContain("+const a = 2;");
    expect(card.textContent).toContain("-const b = 1;");
    expect(card.textContent).toContain("+const b = 2;");
  });

  it("bounds an oversized diff to a visible line count rather than dropping or freezing it", () => {
    const hugeDiffLines = Array.from({ length: 900 }, (_, index) =>
      index % 2 === 0 ? `-old line ${index}` : `+new line ${index}`,
    );
    const hugeDiffTool: tools.EditToolCallViewModel = {
      ...EDIT_TOOL,
      callId: "call-3c",
      unifiedDiff: hugeDiffLines.join("\n"),
    };
    render(<TranscriptToolCallRow entry={toolEntry(hugeDiffTool)} testId="tc-edit-huge" />);
    const card = screen.getByTestId("tc-edit-huge");
    // Only the first MAX_DIFF_LINES (400) lines are rendered as classified
    // spans; the rest are summarized, never silently dropped.
    expect(card.querySelectorAll(".pc-diff-line").length).toBe(400);
    expect(card.textContent).toContain("500 more diff lines not shown");
    expect(card.textContent).not.toContain("old line 898");
  });

  it("renders a failed search card with the error text visible", () => {
    render(<TranscriptToolCallRow entry={toolEntry(SEARCH_TOOL)} testId="tc-search" />);
    const card = screen.getByTestId("tc-search");
    expect(within(card).getByText("permission denied")).toBeTruthy();
    expect(within(card).getByText("Failed")).toBeTruthy();
  });

  it("renders a worktree_setup card as an ordered list of commands", () => {
    render(<TranscriptToolCallRow entry={toolEntry(WORKTREE_TOOL)} testId="tc-worktree" />);
    const card = screen.getByTestId("tc-worktree");
    expect(within(card).getByText("git clone")).toBeTruthy();
    expect(within(card).getByText("npm install")).toBeTruthy();
    expect(within(card).getByRole("list", { name: "Setup commands" })).toBeTruthy();
  });

  it("conveys tool status as visible text, not colour alone", () => {
    render(<TranscriptToolCallRow entry={toolEntry(SHELL_TOOL)} testId="tc-status" />);
    expect(screen.getByText("Completed")).toBeTruthy();
    const runningEntry = toolEntry({ ...SHELL_TOOL, status: "running", durationMs: undefined });
    cleanup();
    render(<TranscriptToolCallRow entry={runningEntry} testId="tc-status-running" />);
    expect(screen.getByText("Running")).toBeTruthy();
  });

  it("shows a blocked call as 'Waiting for approval'", () => {
    render(
      <TranscriptToolCallRow
        entry={toolEntry({
          ...SHELL_TOOL,
          status: "blocked",
          blockedByPermissionRequestId: "req-1",
        })}
        testId="tc-blocked"
      />,
    );
    expect(screen.getByText("Waiting for approval")).toBeTruthy();
  });
});

describe("TranscriptToolCallRow — the safe generic card", () => {
  it("never renders the raw payload — only inert, stringified text", () => {
    render(<TranscriptToolCallRow entry={toolEntry(GENERIC_TOOL)} testId="tc-generic" />);
    const card = screen.getByTestId("tc-generic");
    expect(within(card).getByText("mcp.custom_future_tool")).toBeTruthy();
    expect(card.querySelector("script")).toBeNull();
    // The dangerous-looking string is present only as inert text content
    // inside <pre><code>, never parsed as markup.
    expect(card.innerHTML).not.toContain("<script>alert(1)</script>");
    expect(card.textContent).toContain("depth");
  });

  it("shows tool name, source, execution state, and duration", () => {
    render(
      <TranscriptToolCallRow
        entry={toolEntry({ ...GENERIC_TOOL, durationMs: 1500 })}
        testId="tc-generic-header"
      />,
    );
    const card = screen.getByTestId("tc-generic-header");
    expect(within(card).getAllByText(/mcp\.custom_future_tool/).length).toBeGreaterThan(0);
    expect(within(card).getByText(/from mcp/)).toBeTruthy();
    expect(within(card).getByText("Completed")).toBeTruthy();
    expect(within(card).getByText("2s")).toBeTruthy();
  });

  it("renders an image result payload as an <img> instead of a JSON dump", () => {
    render(
      <TranscriptToolCallRow
        entry={toolEntry({ ...GENERIC_TOOL, callId: "call-6b", result: ONE_PIXEL_PNG_DATA_URI })}
        testId="tc-generic-image"
      />,
    );
    const card = screen.getByTestId("tc-generic-image");
    expect(
      within(card).getByRole("img", { name: "Image result from mcp.custom_future_tool" }),
    ).toBeTruthy();
    expect(within(card).queryByText("Result")).toBeNull();
  });

  it("shows the raw error for a failed unknown call instead of a result panel", () => {
    render(
      <TranscriptToolCallRow entry={toolEntry(GENERIC_FAILED_TOOL)} testId="tc-generic-fail" />,
    );
    const card = screen.getByTestId("tc-generic-fail");
    expect(card.textContent).toContain("boom");
    expect(within(card).getByText("Failed")).toBeTruthy();
  });

  it("copies the copy payload to the clipboard and shows visible confirmation", async () => {
    // `userEvent.setup()` installs its own `navigator.clipboard` stub, so
    // spy on it only *after* setup rather than defining our own property
    // first (which `setup()` would otherwise overwrite).
    const user = userEvent.setup();
    const writeText = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue(undefined);
    render(<TranscriptToolCallRow entry={toolEntry(GENERIC_TOOL)} testId="tc-generic-copy" />);

    await user.click(screen.getByRole("button", { name: "Copy details" }));
    expect(writeText).toHaveBeenCalledWith(GENERIC_TOOL.copyPayload);
    expect(await screen.findByRole("button", { name: "Copied" })).toBeTruthy();
  });

  it("copies a distinct report payload via the report action", async () => {
    const user = userEvent.setup();
    const writeText = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue(undefined);
    render(<TranscriptToolCallRow entry={toolEntry(GENERIC_TOOL)} testId="tc-generic-report" />);

    await user.click(screen.getByRole("button", { name: "Copy report" }));
    expect(writeText).toHaveBeenCalledWith(JSON.stringify(GENERIC_TOOL.reportPayload, null, 2));
    expect(await screen.findByRole("button", { name: "Report copied" })).toBeTruthy();
  });

  it("renders a visible failure — not 'Copied' — when the Clipboard API is absent", async () => {
    // `userEvent.setup()` installs its own `navigator.clipboard` stub, so
    // remove it only *after* setup rather than defining our own property
    // first (which `setup()` would otherwise overwrite).
    const user = userEvent.setup();
    stubClipboard(undefined);
    render(<TranscriptToolCallRow entry={toolEntry(GENERIC_TOOL)} testId="tc-generic-noclip" />);
    const card = screen.getByTestId("tc-generic-noclip");

    await user.click(screen.getByRole("button", { name: "Copy details" }));

    // Never claims success when nothing was ever attempted.
    expect(within(card).queryByRole("button", { name: "Copied" })).toBeNull();
    expect(within(card).getByRole("button", { name: "Copy details" })).toBeTruthy();
    const status = await within(card).findByTestId("tc-generic-noclip-copy-status");
    expect(status.textContent).toContain("Copy failed");
    expect(status.textContent).toContain("Clipboard is not available in this browser context");
  });

  it("renders a visible failure carrying the real reason when the write is rejected", async () => {
    const user = userEvent.setup();
    stubClipboard({
      writeText: vi.fn().mockRejectedValue(new Error("Write permission denied.")),
    });
    render(<TranscriptToolCallRow entry={toolEntry(GENERIC_TOOL)} testId="tc-generic-rejected" />);
    const card = screen.getByTestId("tc-generic-rejected");

    await user.click(screen.getByRole("button", { name: "Copy details" }));

    expect(within(card).queryByRole("button", { name: "Copied" })).toBeNull();
    const status = await within(card).findByTestId("tc-generic-rejected-copy-status");
    expect(status.textContent).toContain("Copy failed");
    expect(status.textContent).toContain("Write permission denied.");
    // The two failure modes are distinguishable, not one shared message.
    expect(status.textContent).not.toContain("Clipboard is not available in this browser context");
  });

  it("clears a rejected-write failure and shows success on the next attempt", async () => {
    const user = userEvent.setup();
    const writeText = vi
      .fn()
      .mockRejectedValueOnce(new Error("Write permission denied."))
      .mockResolvedValueOnce(undefined);
    stubClipboard({ writeText });
    render(<TranscriptToolCallRow entry={toolEntry(GENERIC_TOOL)} testId="tc-generic-retry" />);
    const card = screen.getByTestId("tc-generic-retry");

    await user.click(within(card).getByRole("button", { name: "Copy details" }));
    expect((await within(card).findByTestId("tc-generic-retry-copy-status")).textContent).toContain(
      "Copy failed",
    );

    await user.click(within(card).getByRole("button", { name: "Copy details" }));
    expect(await within(card).findByRole("button", { name: "Copied" })).toBeTruthy();
    expect(within(card).queryByTestId("tc-generic-retry-copy-status")).toBeNull();
  });

  it("keeps the two clipboard actions' failures independent of each other", async () => {
    const user = userEvent.setup();
    stubClipboard({
      writeText: vi.fn().mockRejectedValue(new Error("Write permission denied.")),
    });
    render(<TranscriptToolCallRow entry={toolEntry(GENERIC_TOOL)} testId="tc-generic-both" />);
    const card = screen.getByTestId("tc-generic-both");

    await user.click(within(card).getByRole("button", { name: "Copy details" }));
    expect(await within(card).findByTestId("tc-generic-both-copy-status")).toBeTruthy();
    expect(within(card).queryByTestId("tc-generic-both-report-status")).toBeNull();

    await user.click(within(card).getByRole("button", { name: "Copy report" }));
    expect(await within(card).findByTestId("tc-generic-both-report-status")).toBeTruthy();
    // The first failure is still standing — one action's state never
    // clears the other's.
    expect(within(card).getByTestId("tc-generic-both-copy-status")).toBeTruthy();
  });
});

describe("TranscriptToolCallRow — memoization", () => {
  it("does not re-render when given an equivalent entry", () => {
    const entry = toolEntry(SHELL_TOOL);
    const { rerender, getByTestId } = render(
      <TranscriptToolCallRow entry={entry} testId="tc-stable" />,
    );
    expect(getByTestId("tc-stable").parentElement?.getAttribute("data-render-count")).toBe("1");

    rerender(
      <TranscriptToolCallRow entry={{ ...entry, tool: { ...entry.tool } }} testId="tc-stable" />,
    );
    expect(getByTestId("tc-stable").parentElement?.getAttribute("data-render-count")).toBe("1");
  });

  it("re-renders when the tool status changes", () => {
    const entry = toolEntry(SHELL_TOOL);
    const { rerender, getByTestId } = render(
      <TranscriptToolCallRow entry={entry} testId="tc-updating" />,
    );
    expect(getByTestId("tc-updating").parentElement?.getAttribute("data-render-count")).toBe("1");

    rerender(
      <TranscriptToolCallRow
        entry={{ ...entry, tool: { ...entry.tool, status: "failed", errorText: "oops" } }}
        testId="tc-updating"
      />,
    );
    expect(getByTestId("tc-updating").parentElement?.getAttribute("data-render-count")).toBe("2");
  });
});

describe("TranscriptToolCallRow — accessibility", () => {
  beforeEach(() => {
    stubClipboard({ writeText: vi.fn().mockResolvedValue(undefined) });
  });

  it("has no axe violations for a known-family card", async () => {
    const { container } = render(
      <TranscriptToolCallRow entry={toolEntry(SHELL_TOOL)} testId="tc-axe-1" />,
    );
    expect(await axe(container)).toHaveNoViolations();
  }, 20_000);

  it("has no axe violations for the safe generic card", async () => {
    const { container } = render(
      <TranscriptToolCallRow entry={toolEntry(GENERIC_TOOL)} testId="tc-axe-2" />,
    );
    expect(await axe(container)).toHaveNoViolations();
  }, 20_000);

  it("has no axe violations for an edit card with full diff lines", async () => {
    const { container } = render(
      <TranscriptToolCallRow entry={toolEntry(EDIT_TOOL)} testId="tc-axe-3" />,
    );
    expect(await axe(container)).toHaveNoViolations();
  }, 20_000);

  it("has no axe violations for a card rendering an image result", async () => {
    const imageReadTool: tools.ReadToolCallViewModel = {
      ...READ_TOOL,
      callId: "call-2e",
      filePath: "/synthetic/workspace/logo.png",
      content: ONE_PIXEL_PNG_DATA_URI,
    };
    const { container } = render(
      <TranscriptToolCallRow entry={toolEntry(imageReadTool)} testId="tc-axe-4" />,
    );
    expect(await axe(container)).toHaveNoViolations();
  }, 20_000);
});
