import { rmSync } from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";

import type { AgentStreamEvent, AgentTimelineImageRef } from "../../agent-sdk-types.js";
import { streamPiHistory, type PiCapturedUserMessageEntry } from "./history-mapper.js";
import { parseMessagesFromText } from "./pi-live-tail.js";
import type { PiAgentMessage } from "./rpc-types.js";

async function collectHistory(
  messages: PiAgentMessage[],
  userEntries: PiCapturedUserMessageEntry[] = [],
): Promise<AgentStreamEvent[]> {
  const events: AgentStreamEvent[] = [];
  for await (const event of streamPiHistory("pi", messages, userEntries)) {
    events.push(event);
  }
  return events;
}

/** T52A1: materialized images land in a real content-addressed temp file
 * (the same path `materializeProviderImage` already writes tool-result
 * images to). Clean it up so repeated test runs never accumulate files. */
function cleanupMaterializedImage(image: AgentTimelineImageRef): void {
  rmSync(path.dirname(image.path), { recursive: true, force: true });
}

/** A materialized image path is `<content-hash>.<ext>` inside a
 * `paseo-attachments*` temp directory — never the raw base64 bytes
 * themselves (T52A1 acceptance: "large binary content is referenced
 * rather than inlined wholesale"). */
const MATERIALIZED_IMAGE_PATH_PATTERN = /paseo-attachments[^\\/]*[\\/][0-9a-f]{64}\.[a-z0-9]+$/;

describe("Pi history mapper", () => {
  test("replays user, assistant, reasoning, and completed tool calls, carrying the user's inline image (T52A1)", async () => {
    const events = await collectHistory([
      {
        role: "user",
        content: [
          { type: "text", text: "read this" },
          { type: "image", data: "base64", mimeType: "image/png" },
          { type: "text", text: "then answer" },
        ],
      },
      {
        role: "assistant",
        responseId: "response-1",
        content: [
          { type: "thinking", thinking: "checking file" },
          { type: "toolCall", id: "tool-1", name: "read", arguments: { path: "note.txt" } },
          { type: "text", text: "done" },
        ],
      },
      {
        role: "toolResult",
        toolCallId: "tool-1",
        toolName: "read",
        content: [{ type: "text", text: "file contents" }],
      },
    ]);

    const userMessageEvent = events[0];
    if (
      userMessageEvent?.type !== "timeline" ||
      userMessageEvent.item.type !== "user_message" ||
      !userMessageEvent.item.images
    ) {
      throw new Error("Expected a user_message timeline item carrying a materialized image.");
    }
    const [image] = userMessageEvent.item.images;
    expect(userMessageEvent.item.images).toHaveLength(1);
    // The pasted image survives the mapping (was previously silently
    // dropped) but is referenced, not inlined: a real file on disk, not the
    // raw base64 bytes, sits on the timeline item.
    expect(image.mimeType).toBe("image/png");
    expect(image.bytes).toBe(Buffer.from("base64", "base64").length);
    expect(image.path).toMatch(MATERIALIZED_IMAGE_PATH_PATTERN);
    cleanupMaterializedImage(image);

    expect(events).toEqual([
      {
        type: "timeline",
        provider: "pi",
        item: {
          type: "user_message",
          text: "read this\n\nthen answer",
          messageId: "pi-history-user-1",
          images: [image],
        },
      },
      {
        type: "timeline",
        provider: "pi",
        item: { type: "reasoning", text: "checking file" },
      },
      {
        type: "timeline",
        provider: "pi",
        item: {
          type: "tool_call",
          callId: "tool-1",
          name: "read",
          status: "running",
          detail: {
            type: "read",
            filePath: "note.txt",
            content: undefined,
            offset: undefined,
            limit: undefined,
          },
          error: null,
        },
      },
      {
        type: "timeline",
        provider: "pi",
        item: { type: "assistant_message", text: "done", messageId: "response-1" },
      },
      {
        type: "timeline",
        provider: "pi",
        item: {
          type: "tool_call",
          callId: "tool-1",
          name: "read",
          status: "completed",
          detail: {
            type: "read",
            filePath: "note.txt",
            content: "file contents",
            offset: undefined,
            limit: undefined,
          },
          error: null,
        },
      },
    ]);
  });

  test("replays bash execution records as completed shell calls", async () => {
    await expect(
      collectHistory([
        {
          role: "bashExecution",
          command: "echo hi",
          output: "hi\n",
          exitCode: 0,
          timestamp: 123,
        },
      ]),
    ).resolves.toEqual([
      {
        type: "timeline",
        provider: "pi",
        item: {
          type: "tool_call",
          callId: "pi-bash-123",
          name: "bash",
          status: "completed",
          detail: { type: "shell", command: "echo hi", output: "hi\n", exitCode: 0 },
          error: null,
        },
      },
    ]);
  });

  test("replays non-notice custom messages as assistant text, matching the live path", async () => {
    await expect(
      collectHistory([{ role: "custom", content: "Extension command output" }]),
    ).resolves.toEqual([
      {
        type: "timeline",
        provider: "pi",
        item: {
          type: "assistant_message",
          text: "Extension command output",
          messageId: "pi-history-custom-1",
        },
      },
    ]);
  });

  test("carries an image-only user message through instead of dropping it (T52A1)", async () => {
    // No text block at all — before T52A1 this message produced zero
    // timeline items (`mapUserMessage` bailed out on an empty `text`),
    // silently discarding the entire pasted image.
    const events = await collectHistory([
      {
        role: "user",
        content: [{ type: "image", data: "YWJjMTIz", mimeType: "image/jpeg" }],
      },
    ]);

    expect(events).toHaveLength(1);
    const event = events[0];
    if (event?.type !== "timeline" || event.item.type !== "user_message" || !event.item.images) {
      throw new Error("Expected an image-only user_message timeline item.");
    }
    expect(event.item.text).toBe("");
    expect(event.item.images).toHaveLength(1);
    expect(event.item.images[0].mimeType).toBe("image/jpeg");
    cleanupMaterializedImage(event.item.images[0]);
  });

  test("carries images on a display-eligible custom message through as an assistant_message (T52A1)", async () => {
    // `mapCustomMessage` falls back to an `assistant_message` timeline item
    // for any displayable custom message with no provider-specific hook
    // mapping — the same code path a notice-style Pi custom message with
    // an inline image would take.
    const events = await collectHistory([
      {
        role: "custom",
        content: [
          { type: "text", text: "see attached" },
          { type: "image", data: "ZGVmNDU2", mimeType: "image/webp" },
        ],
      },
    ]);

    expect(events).toHaveLength(1);
    const event = events[0];
    if (
      event?.type !== "timeline" ||
      event.item.type !== "assistant_message" ||
      !event.item.images
    ) {
      throw new Error("Expected an assistant_message timeline item carrying the custom image.");
    }
    expect(event.item.text).toBe("see attached");
    expect(event.item.images).toHaveLength(1);
    expect(event.item.images[0].mimeType).toBe("image/webp");
    cleanupMaterializedImage(event.item.images[0]);
  });

  test("a text-only message carries no images field at all (unaffected by T52A1)", async () => {
    const events = await collectHistory([{ role: "user", content: "just text, no pictures" }]);

    expect(events).toEqual([
      {
        type: "timeline",
        provider: "pi",
        item: {
          type: "user_message",
          text: "just text, no pictures",
          messageId: "pi-history-user-1",
        },
      },
    ]);
    const event = events[0];
    if (event?.type !== "timeline" || event.item.type !== "user_message") {
      throw new Error("Expected a user_message timeline item.");
    }
    expect("images" in event.item).toBe(false);
  });

  // FIX-S5 regression coverage: the production duplication bug was two
  // independent importers (`AgentManager`'s RPC-based full-history replay
  // and `PiLiveTailWatcher`'s own from-scratch read of the raw Pi session
  // file, `pi-live-tail.ts`) racing to materialize the *same* underlying Pi
  // session into the timeline after a daemon restart/resume. Both call this
  // mapper (`PiHistoryMapper`, shared by `history-mapper.ts` and
  // `pi-live-tail.ts`) with a fresh instance starting from the same origin,
  // so `AgentManager.deriveHistoryTimelineDedupeKey` (agent-manager.ts) can
  // only collapse a re-import onto the row already recorded if this mapper
  // assigns the *same* item a stable, content-independent id every time.
  // These two tests pin that guarantee directly at the mapper level, ahead
  // of the store/agent-manager integration test in
  // `agent-timeline-store.test.ts`.
  test("FIX-S5: mapping the same session twice assigns identical messageIds to corresponding rows", async () => {
    const messages: PiAgentMessage[] = [
      { role: "user", content: "Hello" },
      { role: "assistant", content: [{ type: "text", text: "Hello! How can I help you today?" }] },
      { role: "user", content: "Hi" },
      {
        role: "assistant",
        content: [{ type: "text", text: "Hi there! What would you like to do?" }],
      },
    ];

    const firstImport = await collectHistory(messages);
    const secondImport = await collectHistory(messages);

    expect(secondImport).toEqual(firstImport);
    const messageIds = firstImport.map((event) =>
      event.type === "timeline" &&
      (event.item.type === "user_message" || event.item.type === "assistant_message")
        ? event.item.messageId
        : undefined,
    );
    expect(messageIds).toEqual([
      "pi-history-user-1",
      "pi-history-assistant-1", // no native responseId in this fixture, so the synthetic fallback
      "pi-history-user-2",
      "pi-history-assistant-2",
    ]);
  });

  test("FIX-S5: two genuinely separate user messages with identical text still get distinct messageIds", async () => {
    const events = await collectHistory([
      { role: "user", content: "WAVE-OK" },
      { role: "assistant", content: [{ type: "text", text: "ack" }] },
      { role: "user", content: "WAVE-OK" },
    ]);

    const userMessageIds = events
      .filter((event) => event.type === "timeline" && event.item.type === "user_message")
      .map((event) =>
        event.type === "timeline" && event.item.type === "user_message"
          ? event.item.messageId
          : undefined,
      );
    expect(userMessageIds).toEqual(["pi-history-user-1", "pi-history-user-2"]);
    expect(userMessageIds[0]).not.toBe(userMessageIds[1]);
  });

  // FIX-S6: this replaces a prior "uses Pi tree entry ids for replayed user
  // messages" test that pinned the exact behavior the headline duplication
  // bug turned on — `mapUserMessage` preferring `userEntries`' captured id
  // over the positional fallback. `agent.ts`'s RPC-driven `streamHistory()`
  // supplies `userEntries`; `pi-live-tail.ts`'s independent raw-`.jsonl`
  // read never can, so that preference made the two importers disagree on
  // every user message's identity. `userEntries` is still accepted (Pi's
  // captured entry is still resolved for rewind — see `agent.ts`'s
  // `resolveCapturedEntryForRewind`, by *position* rather than by
  // threading the id through this item) but must no longer change
  // `messageId` itself, on pain of reintroducing this exact bug.
  test("FIX-S6: a captured Pi tree entry id never overrides the positional messageId", async () => {
    await expect(
      collectHistory(
        [
          { role: "user", content: "first prompt" },
          { role: "assistant", content: [{ type: "text", text: "first answer" }] },
          { role: "user", content: "second prompt" },
        ],
        [
          { id: "entry-user-1", text: "first prompt" },
          { id: "entry-user-2", text: "second prompt" },
        ],
      ),
    ).resolves.toEqual([
      {
        type: "timeline",
        provider: "pi",
        item: {
          type: "user_message",
          text: "first prompt",
          messageId: "pi-history-user-1",
        },
      },
      {
        type: "timeline",
        provider: "pi",
        item: {
          type: "assistant_message",
          text: "first answer",
          messageId: "pi-history-assistant-1",
        },
      },
      {
        type: "timeline",
        provider: "pi",
        item: {
          type: "user_message",
          text: "second prompt",
          messageId: "pi-history-user-2",
        },
      },
    ]);
  });

  test("FIX-S6: the same session maps to identical messageIds whether or not userEntries is supplied (cross-importer stability)", async () => {
    const messages: PiAgentMessage[] = [
      { role: "user", content: "Hello" },
      { role: "assistant", content: [{ type: "text", text: "Hello! How can I help you today?" }] },
      { role: "user", content: "Hi" },
    ];
    // Simulates `agent.ts`'s RPC path (real captured entries supplied).
    const withCapturedEntries = await collectHistory(messages, [
      { id: "entry-abc", text: "Hello" },
      { id: "entry-def", text: "Hi" },
    ]);
    // Simulates `pi-live-tail.ts`'s raw-file path (never supplies any).
    const withoutCapturedEntries = await collectHistory(messages);

    expect(withCapturedEntries).toEqual(withoutCapturedEntries);
  });

  /**
   * FIX-S13 (minimal-reproduction regression): the owner's headline
   * duplication bug reproduces on a session's very *first* message, with a
   * `custom_message` row (Pi's own top-level `type`, distinct from a
   * `message`-typed row whose `role` happens to be `"custom"`) sitting
   * both before and after it — `workflow-delivery-probe`
   * (`display:false`, empty content) before, `pi-time-sense` after. The
   * prime suspect was that `PiHistoryMapper.mapUserMessage`'s positional
   * `userIndex` counter diverges between the two production importers
   * because one of them (the RPC path's `runtimeSession.getMessages()`)
   * sees these rows and the other (`pi-live-tail.ts`'s
   * `parseMessagesFromText`, which keeps only `entry.type === "message"`)
   * never can.
   *
   * Measured false, not assumed: `mapUserMessage`'s `this.userIndex += 1`
   * runs only inside the `case "user":` arm of `mapMessages`'s switch — a
   * `role: "custom"` row is dispatched to `mapCustomMessage` instead, which
   * touches only `this.customIndex`, never `this.userIndex`. A top-level
   * `custom_message`/`custom` jsonl row has no `message`-typed twin at all
   * (see the FIX-S6 cross-importer test above, which models exactly this:
   * `type: "custom_message"` and bare `type: "custom"` rows are pure noise
   * `parseMessagesFromText` was already proven to filter out completely).
   * So a `custom`-role row — whether or not a given importer's feed even
   * contains one for a `custom_message` jsonl entry — can never shift
   * `userIndex`, and this test pins that: the RPC-shaped feed (which, per
   * the real Pi runtime's `sendMessage()` → `session.messages` push,
   * legitimately CAN carry a `role: "custom"` entry for each side-channel
   * row with no jsonl `message`-typed twin) and the raw-jsonl-shaped feed
   * (which cannot see either row at all, being a different top-level
   * `type`) still assign the identical `pi-history-user-1` to the one real
   * user message — confirmed to already hold on the pre-fix tree, not
   * created as a passing tautology by this fix.
   */
  test("FIX-S13: a custom_message row before and after the first user message never shifts either importer's userIndex", async () => {
    // The RPC-shaped feed (`agent.ts`'s `streamHistory()` via
    // `runtimeSession.getMessages()`): Pi's real runtime pushes a
    // `role: "custom"` entry to `session.messages` for every
    // `sendMessage()`-injected row (verified against the installed Pi CLI's
    // own `agent-session.js`/`messages.js`), so this feed legitimately CAN
    // carry both side-channel rows the raw file records as `custom_message`.
    const rpcMessages: PiAgentMessage[] = [
      { role: "custom", content: "" },
      { role: "user", content: "Reply with exactly: CLEAN1" },
      { role: "custom", content: "time sense context" },
      { role: "assistant", content: [{ type: "text", text: "CLEAN1" }] },
    ];

    // The raw-file-shaped feed (`pi-live-tail.ts`'s `bootstrapTail`/
    // `incrementalTail`, via `parseMessagesFromText`): the *same* logical
    // session's `.jsonl`, exactly as measured live — both side-channel rows
    // persisted with a top-level `type: "custom_message"`, never
    // `type: "message"`, so `parseMessagesFromText` (which keeps only
    // `entry.type === "message"`) cannot see either one at all.
    const rawJsonlLines = [
      JSON.stringify({ type: "session" }),
      JSON.stringify({ type: "model_change" }),
      JSON.stringify({ type: "thinking_level_change" }),
      JSON.stringify({
        type: "custom_message",
        customType: "workflow-delivery-probe",
        content: "",
        display: false,
      }),
      JSON.stringify({
        type: "message",
        message: { role: "user", content: "Reply with exactly: CLEAN1" },
      }),
      JSON.stringify({ type: "custom_message", customType: "pi-time-sense", content: "now" }),
      JSON.stringify({
        type: "message",
        message: { role: "assistant", content: [{ type: "text", text: "CLEAN1" }] },
      }),
    ];
    const liveTailMessages = parseMessagesFromText(rawJsonlLines.join("\n") + "\n");
    // Sanity: both custom_message rows were genuinely filtered out, not
    // just coincidentally absent from the assertion below.
    expect(liveTailMessages).toEqual([
      { role: "user", content: "Reply with exactly: CLEAN1" },
      { role: "assistant", content: [{ type: "text", text: "CLEAN1" }] },
    ]);

    const rpcEvents = await collectHistory(rpcMessages);
    const tailEvents = await collectHistory(liveTailMessages);

    function firstUserMessageId(events: AgentStreamEvent[]): string | undefined {
      const event = events.find(
        (candidate) => candidate.type === "timeline" && candidate.item.type === "user_message",
      );
      return event && event.type === "timeline" && event.item.type === "user_message"
        ? event.item.messageId
        : undefined;
    }

    const rpcUserMessageId = firstUserMessageId(rpcEvents);
    const tailUserMessageId = firstUserMessageId(tailEvents);

    // The one real row this session ever contains must yield exactly one
    // identity, agreed by both importers — the necessary condition for
    // `AgentTimelineStore`/`AgentManager`'s dedupe-key merge machinery to
    // ever collapse the two producers' echoes of it into a single row.
    expect(rpcUserMessageId).toBe("pi-history-user-1");
    expect(tailUserMessageId).toBe("pi-history-user-1");
    expect(rpcUserMessageId).toBe(tailUserMessageId);
  });
});
