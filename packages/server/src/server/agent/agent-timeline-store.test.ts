import { describe, expect, it } from "vitest";
import { InMemoryAgentTimelineStore } from "./agent-timeline-store.js";
import { streamPiHistory } from "./providers/pi/history-mapper.js";
import type { PiAgentMessage } from "./providers/pi/rpc-types.js";
import type { AgentTimelineItem } from "./agent-sdk-types.js";

describe("InMemoryAgentTimelineStore", () => {
  it("clamps an overshooting before cursor into the bounded tail window", () => {
    const store = new InMemoryAgentTimelineStore();
    store.initialize("agent-1", {
      epoch: "epoch-1",
      nextSeq: 8,
      rows: [
        {
          seq: 5,
          timestamp: "2026-01-01T00:00:00.000Z",
          item: { type: "assistant_message", text: "five" },
        },
        {
          seq: 6,
          timestamp: "2026-01-01T00:00:01.000Z",
          item: { type: "assistant_message", text: "six" },
        },
        {
          seq: 7,
          timestamp: "2026-01-01T00:00:02.000Z",
          item: { type: "assistant_message", text: "seven" },
        },
      ],
    });

    const result = store.fetch("agent-1", {
      direction: "before",
      cursor: { epoch: "epoch-1", seq: 100 },
      limit: 2,
    });

    expect(result).toEqual({
      epoch: "epoch-1",
      direction: "before",
      reset: false,
      staleCursor: false,
      gap: false,
      window: { minSeq: 5, maxSeq: 7, nextSeq: 8 },
      hasOlder: true,
      hasNewer: false,
      rows: [
        {
          seq: 6,
          timestamp: "2026-01-01T00:00:01.000Z",
          item: { type: "assistant_message", text: "six" },
        },
        {
          seq: 7,
          timestamp: "2026-01-01T00:00:02.000Z",
          item: { type: "assistant_message", text: "seven" },
        },
      ],
    });
  });

  it("returns a bounded reset window when an after cursor is behind retained history", () => {
    const store = new InMemoryAgentTimelineStore();
    store.initialize("agent-1", {
      epoch: "epoch-1",
      nextSeq: 8,
      rows: [
        {
          seq: 5,
          timestamp: "2026-01-01T00:00:00.000Z",
          item: { type: "assistant_message", text: "five" },
        },
        {
          seq: 6,
          timestamp: "2026-01-01T00:00:01.000Z",
          item: { type: "assistant_message", text: "six" },
        },
        {
          seq: 7,
          timestamp: "2026-01-01T00:00:02.000Z",
          item: { type: "assistant_message", text: "seven" },
        },
      ],
    });

    const result = store.fetch("agent-1", {
      direction: "after",
      cursor: { epoch: "epoch-1", seq: 1 },
      limit: 1,
    });

    expect(result).toEqual({
      epoch: "epoch-1",
      direction: "after",
      reset: true,
      staleCursor: false,
      gap: true,
      window: { minSeq: 5, maxSeq: 7, nextSeq: 8 },
      hasOlder: true,
      hasNewer: false,
      rows: [
        {
          seq: 7,
          timestamp: "2026-01-01T00:00:02.000Z",
          item: { type: "assistant_message", text: "seven" },
        },
      ],
    });
  });

  describe("FIX-S5: idempotent append (source of the headline duplication bug)", () => {
    it("append() with the same dedupeKey twice records the row once", () => {
      const store = new InMemoryAgentTimelineStore();
      store.initialize("agent-1");

      const first = store.append(
        "agent-1",
        { type: "user_message", text: "Hello", messageId: "pi-history-user-1" },
        { dedupeKey: "msg:pi-history-user-1" },
      );
      const second = store.append(
        "agent-1",
        { type: "user_message", text: "Hello", messageId: "pi-history-user-1" },
        { dedupeKey: "msg:pi-history-user-1" },
      );

      expect(second).toEqual(first);
      expect(store.getRows("agent-1")).toHaveLength(1);
      expect(store.getRows("agent-1")[0].seq).toBe(first.seq);
    });

    it("append() with two different dedupeKeys for identical text records two rows", () => {
      const store = new InMemoryAgentTimelineStore();
      store.initialize("agent-1");

      store.append(
        "agent-1",
        { type: "user_message", text: "WAVE-OK", messageId: "pi-history-user-1" },
        { dedupeKey: "msg:pi-history-user-1" },
      );
      store.append(
        "agent-1",
        { type: "user_message", text: "WAVE-OK", messageId: "pi-history-user-2" },
        { dedupeKey: "msg:pi-history-user-2" },
      );

      const rows = store.getRows("agent-1");
      expect(rows).toHaveLength(2);
      expect(rows.map((row) => row.item)).toEqual([
        { type: "user_message", text: "WAVE-OK", messageId: "pi-history-user-1" },
        { type: "user_message", text: "WAVE-OK", messageId: "pi-history-user-2" },
      ]);
    });

    it("append() without a dedupeKey is unaffected (default live-append behavior preserved)", () => {
      const store = new InMemoryAgentTimelineStore();
      store.initialize("agent-1");

      store.append("agent-1", { type: "assistant_message", text: "chunk one" });
      store.append("agent-1", { type: "assistant_message", text: "chunk one" });

      expect(store.getRows("agent-1")).toHaveLength(2);
    });

    /**
     * The end-to-end regression the owner's headline bug reduces to:
     * import a fixture Pi session, then import the *same* underlying
     * session a second time — simulating a daemon restart's re-resume
     * racing `PiLiveTailWatcher`'s own from-scratch bootstrap read of the
     * raw Pi session file (`pi-live-tail.ts`) — and confirm the timeline
     * still holds each message exactly once, in order. This exercises the
     * real `PiHistoryMapper` (`streamPiHistory`, shared by both
     * production importers) feeding the same dedupeKey derivation
     * `AgentManager.deriveHistoryTimelineDedupeKey` uses, so it proves the
     * fix at the mapper+store boundary the way `agent-manager.ts`'s own
     * two call sites and `appendHistoryBackfillTimelineItem` wire it.
     */
    function dedupeKeyFor(item: AgentTimelineItem): string | undefined {
      if ((item.type === "user_message" || item.type === "assistant_message") && item.messageId) {
        return `msg:${item.messageId}`;
      }
      if (item.type === "tool_call") {
        return `call:${item.callId}`;
      }
      return undefined;
    }

    async function importPiSessionInto(
      store: InMemoryAgentTimelineStore,
      agentId: string,
      messages: PiAgentMessage[],
    ): Promise<void> {
      for await (const event of streamPiHistory("pi", messages)) {
        if (event.type !== "timeline") continue;
        store.append(agentId, event.item, { dedupeKey: dedupeKeyFor(event.item) });
      }
    }

    it("importing the same fixture Pi session twice (restart/resume/watcher re-read) yields each message once, in order", async () => {
      // Mirrors the owner's reproduction: three real exchanges plus a
      // display-eligible custom-role row (Pi's own "notice" shape), the
      // same mix their captured session file held.
      const messages: PiAgentMessage[] = [
        { role: "user", content: "Hello" },
        {
          role: "assistant",
          content: [{ type: "text", text: "Hello! How can I help you today?" }],
        },
        { role: "user", content: "Hi" },
        {
          role: "assistant",
          content: [{ type: "text", text: "Hi there! What would you like to do?" }],
        },
        { role: "custom", content: "Reply with exactly: WAVE-OK" },
        { role: "assistant", content: [{ type: "text", text: "WAVE-OK" }] },
      ];

      const store = new InMemoryAgentTimelineStore();
      store.initialize("agent-1");

      await importPiSessionInto(store, "agent-1", messages);
      const afterFirstImport = store.getRows("agent-1").map((row) => row.item);
      expect(afterFirstImport).toHaveLength(6);

      // Simulate the race: the same session re-imported a second time
      // (daemon restart re-resuming the agent, or the live-tail watcher
      // bootstrapping independently) before either importer knew about the
      // other's rows.
      await importPiSessionInto(store, "agent-1", messages);

      const finalRows = store.getRows("agent-1");
      expect(finalRows).toHaveLength(6);
      expect(finalRows.map((row) => row.item)).toEqual(afterFirstImport);
      expect(finalRows.map((row) => row.seq)).toEqual([1, 2, 3, 4, 5, 6]);
    });

    it("a session genuinely containing the same text twice still yields two rows", async () => {
      const messages: PiAgentMessage[] = [
        { role: "user", content: "WAVE-OK" },
        { role: "assistant", content: [{ type: "text", text: "ack" }] },
        { role: "user", content: "WAVE-OK" },
      ];

      const store = new InMemoryAgentTimelineStore();
      store.initialize("agent-1");
      await importPiSessionInto(store, "agent-1", messages);

      const rows = store.getRows("agent-1");
      expect(rows).toHaveLength(3);
      const userTexts = rows
        .map((row) => row.item)
        .filter(
          (item): item is Extract<AgentTimelineItem, { type: "user_message" }> =>
            item.type === "user_message",
        )
        .map((item) => item.text);
      expect(userTexts).toEqual(["WAVE-OK", "WAVE-OK"]);
    });
  });
});
