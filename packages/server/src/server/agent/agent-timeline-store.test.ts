import { describe, expect, it } from "vitest";
import { InMemoryAgentTimelineStore } from "./agent-timeline-store.js";
import { streamPiHistory, type PiCapturedUserMessageEntry } from "./providers/pi/history-mapper.js";
import { parseMessagesFromText } from "./providers/pi/pi-live-tail.js";
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

    /**
     * FIX-S6 regression: the test above ("importing the same fixture Pi
     * session twice") calls `streamPiHistory` identically both times, so it
     * never actually modelled the real asymmetry between the two
     * production importers and passed even with the FIX-S5-only fix that
     * still shipped the headline bug's user-row half. The real asymmetry,
     * confirmed by reading both call sites: `agent.ts`'s RPC-driven
     * `streamHistory()` supplies `userEntries` (Pi's own captured tree-entry
     * ids, fetched via a live extension round trip); `pi-live-tail.ts`'s
     * independent read of the raw `.jsonl` session file
     * (`bootstrapTail`/`incrementalTail`) never can, and additionally sees
     * the file's own interleaved non-`message` rows (`model_change`,
     * `thinking_level_change`, `custom_message`, and a top-level `custom`
     * type distinct from a `message`-typed row whose `role` is `"custom"`)
     * that the RPC path's `getMessages()` never surfaces at all. This test
     * drives both real shapes — including that raw-file noise, through the
     * actual `parseMessagesFromText` `pi-live-tail.ts` uses — through the
     * same dedupe path `agent-manager.ts` wires up, in both possible race
     * orderings, and asserts one row per logical message survives, in the
     * original order.
     */
    it("holds each user and assistant message exactly once, in order, whichever importer shape runs first (cross-importer race)", async () => {
      // The RPC-shaped feed (`agent.ts`'s `streamHistory()`): a clean
      // message list plus Pi's own captured tree-entry ids for the two
      // user turns.
      const rpcMessages: PiAgentMessage[] = [
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
      const capturedEntries: PiCapturedUserMessageEntry[] = [
        { id: "entry-live-1", text: "Hello" },
        { id: "entry-live-2", text: "Hi" },
      ];

      // The raw-file-shaped feed (`pi-live-tail.ts`'s `bootstrapTail`): the
      // *same* logical session, but read from `.jsonl` text interleaving
      // real `message` rows with the non-`message` row types Pi's own
      // session file carries and the RPC path never returns.
      const rawJsonlLines = [
        JSON.stringify({ type: "model_change", model: "some-model" }),
        JSON.stringify({ type: "message", message: { role: "user", content: "Hello" } }),
        JSON.stringify({ type: "thinking_level_change", level: "high" }),
        JSON.stringify({
          type: "message",
          message: {
            role: "assistant",
            content: [{ type: "text", text: "Hello! How can I help you today?" }],
          },
        }),
        JSON.stringify({ type: "custom_message", text: "not a message row" }),
        JSON.stringify({ type: "message", message: { role: "user", content: "Hi" } }),
        JSON.stringify({ type: "custom", note: "top-level custom type, not a message row" }),
        JSON.stringify({
          type: "message",
          message: {
            role: "assistant",
            content: [{ type: "text", text: "Hi there! What would you like to do?" }],
          },
        }),
        JSON.stringify({ type: "thinking_level_change", level: "low" }),
        JSON.stringify({
          type: "message",
          message: { role: "custom", content: "Reply with exactly: WAVE-OK" },
        }),
        JSON.stringify({ type: "model_change", model: "another-model" }),
        JSON.stringify({
          type: "message",
          message: { role: "assistant", content: [{ type: "text", text: "WAVE-OK" }] },
        }),
      ];
      const liveTailMessages = parseMessagesFromText(rawJsonlLines.join("\n") + "\n");
      // Sanity: the noise rows above were genuinely filtered out, not just
      // coincidentally absent from the assertion below.
      expect(liveTailMessages).toHaveLength(6);
      expect(liveTailMessages).toEqual(rpcMessages);

      const expectedTexts = [
        "Hello",
        "Hello! How can I help you today?",
        "Hi",
        "Hi there! What would you like to do?",
        "Reply with exactly: WAVE-OK",
        "WAVE-OK",
      ];

      async function importRpcShape(
        store: InMemoryAgentTimelineStore,
        agentId: string,
      ): Promise<void> {
        for await (const event of streamPiHistory("pi", rpcMessages, capturedEntries)) {
          if (event.type !== "timeline") continue;
          store.append(agentId, event.item, { dedupeKey: dedupeKeyFor(event.item) });
        }
      }
      async function importLiveTailShape(
        store: InMemoryAgentTimelineStore,
        agentId: string,
      ): Promise<void> {
        for await (const event of streamPiHistory("pi", liveTailMessages)) {
          if (event.type !== "timeline") continue;
          store.append(agentId, event.item, { dedupeKey: dedupeKeyFor(event.item) });
        }
      }

      function textsOf(store: InMemoryAgentTimelineStore, agentId: string): string[] {
        return store
          .getRows(agentId)
          .map((row) => row.item)
          .filter(
            (
              item,
            ): item is Extract<AgentTimelineItem, { type: "user_message" | "assistant_message" }> =>
              item.type === "user_message" || item.type === "assistant_message",
          )
          .map((item) => item.text);
      }

      // Ordering 1: RPC path wins the race (the common case — its captured
      // entries are usually populated by the time it runs).
      const rpcFirstStore = new InMemoryAgentTimelineStore();
      rpcFirstStore.initialize("agent-1");
      await importRpcShape(rpcFirstStore, "agent-1");
      await importLiveTailShape(rpcFirstStore, "agent-1");
      expect(rpcFirstStore.getRows("agent-1")).toHaveLength(6);
      expect(textsOf(rpcFirstStore, "agent-1")).toEqual(expectedTexts);

      // Ordering 2: the file-tail watcher wins the race instead (the scenario
      // the owner's reproduction actually hit — a fast raw-file read finishing
      // before the RPC round trip does, right after a daemon restart).
      const liveTailFirstStore = new InMemoryAgentTimelineStore();
      liveTailFirstStore.initialize("agent-1");
      await importLiveTailShape(liveTailFirstStore, "agent-1");
      await importRpcShape(liveTailFirstStore, "agent-1");
      expect(liveTailFirstStore.getRows("agent-1")).toHaveLength(6);
      expect(textsOf(liveTailFirstStore, "agent-1")).toEqual(expectedTexts);
    });
  });
});
