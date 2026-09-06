/**
 * Tests for T28A1's transcript view model (plan.md §7.4, §11.1, §11.6):
 * every §11.1 lifecycle state this domain carries data for maps to a typed
 * `TranscriptEntry`, a recorded session's entry list is stable/deterministic
 * in plain Node, and an unrecognized item type falls back to a safe
 * diagnostic instead of throwing.
 */
import { describe, expect, it } from "vitest";
import type { AgentTimelineItem } from "@picompanion/protocol/agent-types";

import { loadTimelineFixtureScenario } from "./fixtures/index.js";
import { agentStreamMessageFromFrame, frameById } from "./fixtures/wire.js";
import { addOptimisticUserMessage, ingestAgentStreamMessage } from "./reducer.js";
import { createEmptyTimelineState } from "./types.js";
import type { TimelineRow, TimelineState } from "./types.js";
import {
  buildTranscriptEntries,
  buildTranscriptEntry,
  buildTranscriptView,
} from "./transcript-view.js";
import type { TranscriptEntry } from "./transcript-view.js";

function row(overrides: Partial<TimelineRow> & { item: AgentTimelineItem }): TimelineRow {
  return {
    id: "epoch-fixture:1",
    epoch: "epoch-fixture",
    seqStart: 1,
    seqEnd: 1,
    timestamp: "2026-09-01T00:00:00.000Z",
    provider: "pi",
    ...overrides,
  };
}

function stateWithRows(rows: TimelineRow[], stale = false): TimelineState {
  return {
    epoch: rows[0]?.epoch ?? null,
    rows,
    pendingRows: [],
    gap: null,
    stale,
  };
}

describe("buildTranscriptEntry: one typed entry per §11.1 lifecycle state", () => {
  it("maps a user_message row", () => {
    const entry = buildTranscriptEntry(
      row({ item: { type: "user_message", text: "hello", messageId: "msg_1" } }),
    );
    expect(entry).toMatchObject({
      kind: "user-message",
      text: "hello",
      messageId: "msg_1",
      pending: false,
      stale: false,
    });
    expect(entry).not.toHaveProperty("images");
  });

  it("carries a user_message row's images through, in source order (T52A2)", () => {
    const entry = buildTranscriptEntry(
      row({
        item: {
          type: "user_message",
          text: "look at this",
          messageId: "msg_img_1",
          images: [
            { mimeType: "image/png", path: "/synthetic/a.png", bytes: 10 },
            { mimeType: "image/jpeg", path: "/synthetic/b.jpg" },
          ],
        },
      }),
    );
    expect(entry.kind).toBe("user-message");
    if (entry.kind === "user-message") {
      expect(entry.images).toEqual([
        { mimeType: "image/png", path: "/synthetic/a.png", bytes: 10 },
        { mimeType: "image/jpeg", path: "/synthetic/b.jpg" },
      ]);
    }
  });

  it("omits the images key for a user_message row with an empty images array", () => {
    const entry = buildTranscriptEntry(
      row({ item: { type: "user_message", text: "no images", images: [] } }),
    );
    expect(entry).not.toHaveProperty("images");
  });

  it("maps an uncorrected assistant_message row with corrected: false", () => {
    const entry = buildTranscriptEntry(
      row({ item: { type: "assistant_message", text: "draft", messageId: "msg_2" } }),
    );
    expect(entry).toMatchObject({ kind: "assistant-message", text: "draft", corrected: false });
    expect(entry).not.toHaveProperty("images");
  });

  it("carries an assistant_message row's images through (T52A2)", () => {
    const entry = buildTranscriptEntry(
      row({
        item: {
          type: "assistant_message",
          text: "here is a screenshot",
          messageId: "msg_3",
          images: [{ mimeType: "image/png", path: "/synthetic/c.png", bytes: 99 }],
        },
      }),
    );
    expect(entry.kind).toBe("assistant-message");
    if (entry.kind === "assistant-message") {
      expect(entry.images).toEqual([
        { mimeType: "image/png", path: "/synthetic/c.png", bytes: 99 },
      ]);
    }
  });

  it("maps a corrected assistant_message row with corrected: true", () => {
    const entry = buildTranscriptEntry(
      row({
        item: {
          type: "assistant_message",
          text: "final",
          messageId: "msg_2",
          replaceMessageId: "msg_2",
          corrected: true,
        },
      }),
    );
    expect(entry).toMatchObject({ kind: "assistant-message", text: "final", corrected: true });
  });

  it("maps a reasoning row to a thinking entry", () => {
    const entry = buildTranscriptEntry(row({ item: { type: "reasoning", text: "thinking..." } }));
    expect(entry).toMatchObject({ kind: "thinking", text: "thinking..." });
  });

  it("maps every tool_call status (start/update/end lifecycle) to a typed tool-call entry", () => {
    const statuses: Array<AgentTimelineItem & { type: "tool_call" }> = [
      {
        type: "tool_call",
        callId: "call_1",
        name: "bash",
        status: "running",
        error: null,
        detail: { type: "shell", command: "echo hi" },
      },
      {
        type: "tool_call",
        callId: "call_1",
        name: "bash",
        status: "completed",
        error: null,
        detail: { type: "shell", command: "echo hi", output: "hi\n", exitCode: 0 },
      },
      {
        type: "tool_call",
        callId: "call_2",
        name: "bash",
        status: "failed",
        error: "boom",
        detail: { type: "shell", command: "false" },
      },
      {
        type: "tool_call",
        callId: "call_3",
        name: "bash",
        status: "canceled",
        error: null,
        detail: { type: "shell", command: "sleep 100" },
      },
    ];
    for (const item of statuses) {
      const entry = buildTranscriptEntry(row({ item }));
      expect(entry.kind).toBe("tool-call");
      if (entry.kind === "tool-call") {
        expect(entry.tool.callId).toBe(item.callId);
        expect(entry.tool.status).toBe(item.status);
        expect(entry.tool.family).toBe("shell");
      }
    }
  });

  it("routes an unknown tool detail through the safe generic tool card, never raw payload", () => {
    const entry = buildTranscriptEntry(
      row({
        item: {
          type: "tool_call",
          callId: "call_unknown",
          name: "future_tool",
          status: "completed",
          error: null,
          detail: { type: "unknown", input: { secret: "x" }, output: { secret: "y" } },
        },
      }),
    );
    expect(entry.kind).toBe("tool-call");
    if (entry.kind === "tool-call") {
      expect(entry.tool.family).toBe("generic");
    }
  });

  it("maps a todo row", () => {
    const entry = buildTranscriptEntry(
      row({
        item: {
          type: "todo",
          items: [
            { text: "write tests", completed: false },
            { text: "read plan.md", completed: true },
          ],
        },
      }),
    );
    expect(entry).toMatchObject({
      kind: "todo",
      items: [
        { text: "write tests", completed: false },
        { text: "read plan.md", completed: true },
      ],
    });
  });

  it("maps an error row", () => {
    const entry = buildTranscriptEntry(row({ item: { type: "error", message: "turn failed" } }));
    expect(entry).toMatchObject({ kind: "error", message: "turn failed" });
  });

  it("maps a compaction row for both loading and completed status", () => {
    const loading = buildTranscriptEntry(
      row({ item: { type: "compaction", status: "loading", trigger: "auto", preTokens: 900 } }),
    );
    expect(loading).toMatchObject({
      kind: "compaction",
      status: "loading",
      trigger: "auto",
      preTokens: 900,
    });

    const completed = buildTranscriptEntry(
      row({ item: { type: "compaction", status: "completed" } }),
    );
    expect(completed).toMatchObject({ kind: "compaction", status: "completed" });
    expect(completed).not.toHaveProperty("trigger");
  });

  // T143: `compaction_end`'s payload used to be discarded entirely
  // (`result?: unknown` at the daemon boundary), so `CompactionTimelineItem`
  // carried only `status`/`trigger`/`preTokens`. This proves the daemon's
  // new fields (Pi's own `summary`, `estimatedTokensAfter`, and the
  // best-effort `filesRead`/`filesModified`) survive protocol -> core onto
  // `CompactionTranscriptEntry` — the "far end" this domain owns.
  it("carries Pi's compaction result fields (summary, file lists) onto the entry (T143)", () => {
    const entry = buildTranscriptEntry(
      row({
        item: {
          type: "compaction",
          status: "completed",
          trigger: "auto",
          preTokens: 128_000,
          summary: "Discussed the auth refactor and merged two branches.",
          estimatedTokensAfter: 4_000,
          filesRead: ["a.ts", "b.ts"],
          filesModified: ["c.ts"],
        },
      }),
    );
    expect(entry).toMatchObject({
      kind: "compaction",
      status: "completed",
      summary: "Discussed the auth refactor and merged two branches.",
      estimatedTokensAfter: 4_000,
      filesRead: ["a.ts", "b.ts"],
      filesModified: ["c.ts"],
    });
  });

  it("omits the compaction result fields when the daemon supplies none of them", () => {
    const entry = buildTranscriptEntry(
      row({ item: { type: "compaction", status: "completed", trigger: "manual" } }),
    );
    expect(entry).not.toHaveProperty("summary");
    expect(entry).not.toHaveProperty("estimatedTokensAfter");
    expect(entry).not.toHaveProperty("filesRead");
    expect(entry).not.toHaveProperty("filesModified");
  });

  it("maps a pi_ui_snapshot row to an extension-snapshot entry", () => {
    const state = {
      revision: 1,
      elements: {},
    } as unknown as import("@picompanion/protocol/pi-ui-bridge/schema").PiUiState;
    const entry = buildTranscriptEntry(row({ item: { type: "pi_ui_snapshot", state } }));
    expect(entry).toMatchObject({ kind: "extension-snapshot", state });
  });

  it("falls back to a safe unknown diagnostic entry for an unrecognized item type, never throwing", () => {
    const bogus = { type: "future_lifecycle_state", payload: { secret: "x" } } as unknown;
    const entry = buildTranscriptEntry(row({ item: bogus as AgentTimelineItem }));
    expect(entry.kind).toBe("unknown");
    if (entry.kind === "unknown") {
      expect(entry.rawType).toBe("future_lifecycle_state");
      expect(entry.raw).toEqual(bogus);
    }
  });
});

describe("buildTranscriptEntry: pending and stale propagation", () => {
  it("carries a pending optimistic row's pending flag through", () => {
    const entry = buildTranscriptEntry(
      row({ item: { type: "user_message", text: "hi" }, pending: true }),
    );
    expect(entry.pending).toBe(true);
  });

  it("defaults pending to false when the row omits it", () => {
    const entry = buildTranscriptEntry(row({ item: { type: "user_message", text: "hi" } }));
    expect(entry.pending).toBe(false);
  });

  it("stamps every entry with the view's stale flag", () => {
    const entry = buildTranscriptEntry(row({ item: { type: "user_message", text: "hi" } }), true);
    expect(entry.stale).toBe(true);
  });
});

describe("buildTranscriptEntries / buildTranscriptView", () => {
  it("combines confirmed and pending rows in getVisibleTimelineRows order", () => {
    let state = createEmptyTimelineState();
    state = ingestAgentStreamMessage(state, {
      type: "agent_stream",
      payload: {
        agentId: "agt_x",
        epoch: "epoch-a",
        seq: 1,
        timestamp: "2026-09-01T00:00:00.000Z",
        event: {
          type: "timeline",
          provider: "pi",
          item: { type: "user_message", text: "confirmed", messageId: "msg_1" },
        },
      },
    });
    state = addOptimisticUserMessage(state, {
      clientMessageId: "cmid_1",
      text: "still pending",
      timestamp: "2026-09-01T00:00:01.000Z",
    });

    const entries = buildTranscriptEntries(state);
    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({ kind: "user-message", text: "confirmed", pending: false });
    expect(entries[1]).toMatchObject({
      kind: "user-message",
      text: "still pending",
      pending: true,
    });
  });

  it("buildTranscriptView carries gap and stale through unchanged", () => {
    const rows = [row({ item: { type: "user_message", text: "hi" } })];
    const state: TimelineState = {
      ...stateWithRows(rows, true),
      gap: { epoch: "epoch-fixture", fromSeq: 2, toSeq: 4 },
    };
    const view = buildTranscriptView(state);
    expect(view.stale).toBe(true);
    expect(view.gap).toEqual({ epoch: "epoch-fixture", fromSeq: 2, toSeq: 4 });
    expect(view.entries).toHaveLength(1);
    expect(view.entries[0]?.stale).toBe(true);
  });
});

describe("buildTranscriptEntries: recorded-session stability (plan.md §13 Phase 2 exit style)", () => {
  it("produces a byte-identical entry list across repeated builds from the same fixture-driven state", () => {
    const scenario = loadTimelineFixtureScenario("tool-call-lifecycle");
    let state = createEmptyTimelineState();
    for (const frame of scenario.frames) {
      state = ingestAgentStreamMessage(state, agentStreamMessageFromFrame(frame));
    }

    const first: TranscriptEntry[] = buildTranscriptEntries(state);
    const second: TranscriptEntry[] = buildTranscriptEntries(state);
    expect(second).toEqual(first);

    // Two interleaved tool calls, each merged from start/update/end into one
    // row apiece (plan.md §7.4) -> exactly two transcript entries.
    expect(first).toHaveLength(2);
    expect(first.every((entry) => entry.kind === "tool-call")).toBe(true);
    const callIds = first.map((entry) => (entry.kind === "tool-call" ? entry.tool.callId : null));
    expect(callIds).toEqual(["call_t20a_0001", "call_t20a_0002"]);
    const completedEntry = first[0];
    if (completedEntry?.kind === "tool-call") {
      expect(completedEntry.tool.status).toBe("completed");
      expect(completedEntry.tool.family).toBe("read");
    }
  });

  it("produces a stable entry list across the assistant-message-correction fixture", () => {
    const scenario = loadTimelineFixtureScenario("assistant-message-correction");
    let state = createEmptyTimelineState();
    for (const id of ["assistant-delta-1", "assistant-delta-1-resend", "assistant-correction-1"]) {
      state = ingestAgentStreamMessage(
        state,
        agentStreamMessageFromFrame(frameById(scenario.frames, id)),
      );
    }

    const entries = buildTranscriptEntries(state);
    expect(entries).toHaveLength(1); // resend deduped, correction replaced in place
    expect(entries[0]).toMatchObject({ kind: "assistant-message", corrected: true });
    expect(buildTranscriptEntries(state)).toEqual(entries); // deterministic re-run
  });

  it("carries images through the message-attachments fixture, unchanged for the text-only entry (T52A2)", () => {
    const scenario = loadTimelineFixtureScenario("message-attachments");
    let state = createEmptyTimelineState();
    for (const frame of scenario.frames) {
      state = ingestAgentStreamMessage(state, agentStreamMessageFromFrame(frame));
    }

    const entries = buildTranscriptEntries(state);
    // The draft assistant_message (seq 2) is replaced in place by the
    // correction (seq 3), so only two entries remain: the user message and
    // the corrected, image-carrying assistant message.
    expect(entries).toHaveLength(2);

    const [userEntry, assistantEntry] = entries;
    expect(userEntry?.kind).toBe("user-message");
    if (userEntry?.kind === "user-message") {
      expect(userEntry.images).toEqual([
        { mimeType: "image/png", path: "/synthetic/attachments/t52a2-0001.png", bytes: 48213 },
      ]);
    }

    expect(assistantEntry?.kind).toBe("assistant-message");
    if (assistantEntry?.kind === "assistant-message") {
      expect(assistantEntry.corrected).toBe(true);
      expect(assistantEntry.images).toEqual([
        {
          mimeType: "image/png",
          path: "/synthetic/attachments/t52a2-0002-annotated.png",
          bytes: 51002,
        },
      ]);
    }

    expect(buildTranscriptEntries(state)).toEqual(entries); // deterministic re-run
  });
});
