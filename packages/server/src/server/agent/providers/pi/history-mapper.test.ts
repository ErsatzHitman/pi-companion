import { rmSync } from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";

import type { AgentStreamEvent, AgentTimelineImageRef } from "../../agent-sdk-types.js";
import { streamPiHistory, type PiCapturedUserMessageEntry } from "./history-mapper.js";
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
});
