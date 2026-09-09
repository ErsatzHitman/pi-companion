import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { timeline as coreTimeline } from "@picompanion/frontend-core";
import type { AgentStreamMessage } from "@picompanion/protocol/messages";

import {
  MAX_TEXT_CHARS,
  TRUNCATION_SUFFIX,
  areMessageRowPropsEqual,
  boundedText,
  isCoreMessageEntry,
  roleAffordanceFor,
  speakerFor,
  timestampLabelFor,
  type CoreMessageEntry,
  type TranscriptMessageRowProps,
} from "./message-row-model";

/**
 * Every `AgentStreamMessage` payload below is **transcribed verbatim**
 * (same `agentId`/`epoch`/`seq`/`timestamp`/`item` field values, cited by
 * scenario + frame id) from
 * `packages/frontend-core/src/timeline/fixtures/scenarios/
 * assistant-message-correction.ts`, `.../message-attachments.ts`, and
 * `.../tool-call-lifecycle.ts` — the shared fixtures this task's brief
 * points at. They are not statically imported: `@picompanion/frontend-
 * core`'s `package.json` `exports` map exposes only `"."`, with no
 * subpath for `./timeline/fixtures`, so a static cross-package import of
 * that directory is not possible without either editing frontend-core's
 * exports (out of this task's Owns grant and explicitly forbidden this
 * wave) or importing it by a source-relative path (the repository
 * invariant this task must not violate: "Web and Android depend on
 * package exports ... never source-relative cross-workspace paths").
 * Transcribing the literal payloads, typed against the real
 * `@picompanion/protocol/messages` `AgentStreamMessage` and run through
 * the real, unmodified `@picompanion/frontend-core`
 * `timeline.ingestAgentStreamMessage`/`buildTranscriptEntries`, proves
 * this model reads the same wire shape those fixtures record without
 * crossing the package boundary. See this task's report for the same
 * note.
 */
function ingestAll(messages: AgentStreamMessage[]): coreTimeline.TimelineState {
  let state = coreTimeline.createEmptyTimelineState();
  for (const message of messages) {
    state = coreTimeline.ingestAgentStreamMessage(state, message);
  }
  return state;
}

function messageEntries(state: coreTimeline.TimelineState): CoreMessageEntry[] {
  return coreTimeline.buildTranscriptEntries(state).filter(isCoreMessageEntry);
}

describe("message-row-model: shared fixture — assistant-message-correction", () => {
  // Transcribed from scenario "assistant-message-correction", frames
  // "assistant-delta-1", "assistant-delta-1-resend", "assistant-correction-1".
  const messages: AgentStreamMessage[] = [
    {
      type: "agent_stream",
      payload: {
        agentId: "agt_fixture_t20a_0001",
        epoch: "epoch-t20a-0001",
        seq: 10,
        timestamp: "2026-09-01T10:00:00.000Z",
        event: {
          type: "timeline",
          provider: "pi",
          item: {
            type: "assistant_message",
            text: "Draft answer for /synthetic/workspace/demo-repo",
            messageId: "msg_t20a_0001",
          },
        },
      },
    },
    {
      type: "agent_stream",
      payload: {
        agentId: "agt_fixture_t20a_0001",
        epoch: "epoch-t20a-0001",
        seq: 10,
        timestamp: "2026-09-01T10:00:00.000Z",
        event: {
          type: "timeline",
          provider: "pi",
          item: {
            type: "assistant_message",
            text: "Draft answer for /synthetic/workspace/demo-repo",
            messageId: "msg_t20a_0001",
          },
        },
      },
    },
    {
      type: "agent_stream",
      payload: {
        agentId: "agt_fixture_t20a_0001",
        epoch: "epoch-t20a-0001",
        seq: 11,
        timestamp: "2026-09-01T10:00:05.000Z",
        event: {
          type: "timeline",
          provider: "pi",
          item: {
            type: "assistant_message",
            text: "Final answer for /synthetic/workspace/demo-repo/README.md.",
            messageId: "msg_t20a_0002",
            replaceMessageId: "msg_t20a_0001",
            corrected: true,
          },
        },
      },
    },
  ];

  it("dedupes the exact re-delivery and applies the correction in place, leaving exactly one row", () => {
    const entries = messageEntries(ingestAll(messages));
    expect(entries).toHaveLength(1);
    const [entry] = entries;
    expect(entry.kind).toBe("assistant-message");
    expect(entry.text).toBe("Final answer for /synthetic/workspace/demo-repo/README.md.");
    expect((entry as Extract<CoreMessageEntry, { kind: "assistant-message" }>).corrected).toBe(
      true,
    );
  });

  it("speakerFor and roleAffordanceFor classify the corrected row as the assistant, distinguishable by text label alone", () => {
    const [entry] = messageEntries(ingestAll(messages));
    expect(speakerFor(entry)).toBe("assistant");
    expect(roleAffordanceFor(entry)).toEqual({
      speaker: "assistant",
      speakerLabel: "Pi",
      hasBorder: false,
    });
  });
});

describe("message-row-model: shared fixture — message-attachments", () => {
  // Transcribed from scenario "message-attachments", frames
  // "user-message-with-image", "assistant-reply-draft",
  // "assistant-reply-correction-with-image".
  const messages: AgentStreamMessage[] = [
    {
      type: "agent_stream",
      payload: {
        agentId: "agt_fixture_t52a2_0001",
        epoch: "epoch-t52a2-0001",
        seq: 1,
        timestamp: "2026-09-02T10:00:00.000Z",
        event: {
          type: "timeline",
          provider: "pi",
          item: {
            type: "user_message",
            text: "What is wrong with this screenshot?",
            messageId: "msg_t52a2_0001",
            images: [
              {
                mimeType: "image/png",
                path: "/synthetic/attachments/t52a2-0001.png",
                bytes: 48213,
              },
            ],
          },
        },
      },
    },
    {
      type: "agent_stream",
      payload: {
        agentId: "agt_fixture_t52a2_0001",
        epoch: "epoch-t52a2-0001",
        seq: 2,
        timestamp: "2026-09-02T10:00:01.000Z",
        event: {
          type: "timeline",
          provider: "pi",
          item: {
            type: "assistant_message",
            text: "Looking at it now...",
            messageId: "msg_t52a2_0002",
          },
        },
      },
    },
    {
      type: "agent_stream",
      payload: {
        agentId: "agt_fixture_t52a2_0001",
        epoch: "epoch-t52a2-0001",
        seq: 3,
        timestamp: "2026-09-02T10:00:02.000Z",
        event: {
          type: "timeline",
          provider: "pi",
          item: {
            type: "assistant_message",
            text: "The button is missing its focus ring, see the annotated version.",
            messageId: "msg_t52a2_0002",
            replaceMessageId: "msg_t52a2_0002",
            corrected: true,
            images: [
              {
                mimeType: "image/png",
                path: "/synthetic/attachments/t52a2-0002-annotated.png",
                bytes: 51002,
              },
            ],
          },
        },
      },
    },
  ];

  it("classifies the user row as the user speaker with the border affordance, and passes images through unrendered", () => {
    const entries = messageEntries(ingestAll(messages));
    expect(entries).toHaveLength(2);
    const [userEntry, assistantEntry] = entries;

    expect(userEntry.kind).toBe("user-message");
    expect(speakerFor(userEntry)).toBe("user");
    expect(roleAffordanceFor(userEntry)).toEqual({
      speaker: "user",
      speakerLabel: "You",
      hasBorder: true,
    });
    // T52A2's images passthrough survives this model unchanged, even
    // though this task's view does not render it yet (see
    // message-row-model.ts's module doc "Deliberate difference from web").
    expect(userEntry.images).toEqual([
      { mimeType: "image/png", path: "/synthetic/attachments/t52a2-0001.png", bytes: 48213 },
    ]);

    expect(assistantEntry.kind).toBe("assistant-message");
    expect(assistantEntry.text).toBe(
      "The button is missing its focus ring, see the annotated version.",
    );
    expect(assistantEntry.images).toEqual([
      {
        mimeType: "image/png",
        path: "/synthetic/attachments/t52a2-0002-annotated.png",
        bytes: 51002,
      },
    ]);
  });
});

describe("message-row-model: shared fixture — tool-call-lifecycle (non-message rows are excluded)", () => {
  // Transcribed from scenario "tool-call-lifecycle", frame "tool-call-a-start".
  const toolCallMessage: AgentStreamMessage = {
    type: "agent_stream",
    payload: {
      agentId: "agt_fixture_t20a_0002",
      epoch: "epoch-t20a-0002",
      seq: 20,
      timestamp: "2026-09-01T11:00:00.000Z",
      event: {
        type: "timeline",
        provider: "pi",
        item: {
          type: "tool_call",
          callId: "call_t20a_0001",
          name: "read_file",
          status: "running",
          error: null,
          detail: { type: "read", filePath: "/synthetic/workspace/demo-repo/README.md" },
        },
      },
    },
  };

  it("isCoreMessageEntry rejects a tool-call row, so this feature's row never renders one", () => {
    const state = ingestAll([toolCallMessage]);
    const allEntries = coreTimeline.buildTranscriptEntries(state);
    expect(allEntries).toHaveLength(1);
    expect(allEntries[0].kind).toBe("tool-call");
    expect(isCoreMessageEntry(allEntries[0])).toBe(false);
    expect(messageEntries(state)).toHaveLength(0);
  });
});

describe("boundedText: matches web's MAX_TEXT_CHARS/TRUNCATION_SUFFIX bound", () => {
  it("leaves text at or under the bound unchanged", () => {
    expect(boundedText("hello")).toBe("hello");
    const exact = "a".repeat(MAX_TEXT_CHARS);
    expect(boundedText(exact)).toBe(exact);
  });

  it("truncates text over the bound to exactly MAX_TEXT_CHARS, ending with the suffix", () => {
    const oversized = "b".repeat(MAX_TEXT_CHARS + 5000);
    const result = boundedText(oversized);
    expect(result).toHaveLength(MAX_TEXT_CHARS);
    expect(result.endsWith(TRUNCATION_SUFFIX)).toBe(true);
    expect(result.startsWith("b".repeat(MAX_TEXT_CHARS - TRUNCATION_SUFFIX.length))).toBe(true);
  });
});

describe("areMessageRowPropsEqual: same comparator fields as web's areRowPropsEqual", () => {
  function userEntry(overrides: Partial<CoreMessageEntry> = {}): CoreMessageEntry {
    return {
      kind: "user-message",
      id: "row-1",
      epoch: "epoch-1",
      seqStart: 1,
      seqEnd: 1,
      timestamp: "2026-01-01T00:00:00.000Z",
      provider: "pi",
      pending: false,
      stale: false,
      text: "Hi Pi",
      ...overrides,
    } as CoreMessageEntry;
  }

  function assistantEntry(
    overrides: Partial<Extract<CoreMessageEntry, { kind: "assistant-message" }>> = {},
  ): CoreMessageEntry {
    return {
      kind: "assistant-message",
      id: "row-2",
      epoch: "epoch-1",
      seqStart: 2,
      seqEnd: 2,
      timestamp: "2026-01-01T00:00:01.000Z",
      provider: "pi",
      pending: false,
      stale: false,
      text: "Hi there",
      corrected: false,
      ...overrides,
    } as CoreMessageEntry;
  }

  function props(
    entry: CoreMessageEntry,
    overrides: Partial<TranscriptMessageRowProps> = {},
  ): TranscriptMessageRowProps {
    return { entry, streaming: false, testId: "row", ...overrides };
  }

  it("is true for identical props (reference-distinct entries)", () => {
    expect(areMessageRowPropsEqual(props(userEntry()), props(userEntry()))).toBe(true);
  });

  it("is false when text changes (the common case: a live streaming delta)", () => {
    expect(
      areMessageRowPropsEqual(
        props(assistantEntry({ text: "partial" })),
        props(assistantEntry({ text: "partial more" })),
      ),
    ).toBe(false);
  });

  it("is false when pending, stale, corrected, streaming, or testId changes", () => {
    const base = assistantEntry();
    expect(areMessageRowPropsEqual(props(base), props(assistantEntry({ pending: true })))).toBe(
      false,
    );
    expect(areMessageRowPropsEqual(props(base), props(assistantEntry({ stale: true })))).toBe(
      false,
    );
    expect(areMessageRowPropsEqual(props(base), props(assistantEntry({ corrected: true })))).toBe(
      false,
    );
    expect(areMessageRowPropsEqual(props(base), props(base, { streaming: true }))).toBe(false);
    expect(areMessageRowPropsEqual(props(base), props(base, { testId: "other" }))).toBe(false);
  });

  it("ignores `corrected` when comparing a user-message pair (the field does not exist there)", () => {
    expect(areMessageRowPropsEqual(props(userEntry()), props(userEntry()))).toBe(true);
  });

  // T284: `resolveImageUri` and `entry.images` are both compared by
  // reference, so a caller passing a fresh closure or a fresh array every
  // render would defeat this memo entirely — this is what proves the
  // comparator actually reads them, not just that the interface declares
  // them.
  it("is false when resolveImageUri changes reference, even with every other field identical", () => {
    const base = userEntry();
    const resolverA = () => "https://daemon.example/a.png";
    const resolverB = () => "https://daemon.example/a.png";
    expect(
      areMessageRowPropsEqual(
        props(base, { resolveImageUri: resolverA }),
        props(base, { resolveImageUri: resolverA }),
      ),
    ).toBe(true);
    expect(
      areMessageRowPropsEqual(
        props(base, { resolveImageUri: resolverA }),
        props(base, { resolveImageUri: resolverB }),
      ),
    ).toBe(false);
  });

  it("is false when entry.images changes reference, even with an identical array of one element", () => {
    const image = { mimeType: "image/png", path: "/tmp/paseo-attachments-x/a.png" };
    const withImages = userEntry({ images: [image] });
    const withImagesAgain = userEntry({ images: [image] });
    expect(areMessageRowPropsEqual(props(withImages), props(withImages))).toBe(true);
    expect(areMessageRowPropsEqual(props(withImages), props(withImagesAgain))).toBe(false);
  });
});

/**
 * Mutation-checked source proof that `roleAffordanceFor`'s claim about
 * the shared `StreamingMessage` recipe (Android-only border on user
 * rows; "Pi"/"You" text label on both roles) matches the actual,
 * unmodified recipe source — not just this model's own assertion about
 * itself. Pattern and rationale copied from
 * `./transcript-accessibility.test.ts`'s `readCode()`: an unanchored
 * regex over raw source can be satisfied by a doc comment alone, so this
 * strips comments first. See this task's report for the mutation run
 * (delete each construct, confirm this test fails, restore
 * byte-identically, diff-prove the restore) — not repeated here since
 * `../../ui/recipes/StreamingMessage.tsx` is not owned by this task and
 * must not be left mutated.
 */
function readStreamingMessageCode(): string {
  const source = readFileSync(
    fileURLToPath(new URL("../../ui/recipes/StreamingMessage.tsx", import.meta.url)),
    "utf8",
  );
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

describe("roleAffordanceFor: matches the shared StreamingMessage recipe it documents", () => {
  it("StreamingMessage.tsx renders the same speaker -> label mapping this model claims", () => {
    const code = readStreamingMessageCode();
    expect(code).toMatch(/speaker === "assistant" \? "Pi" : "You"/);
  });

  it("StreamingMessage.tsx renders a border only for the user speaker, as this model's hasBorder claims", () => {
    const code = readStreamingMessageCode();
    expect(code).toMatch(/borderWidth:\s*speaker === "user" \? 1 : 0/);
  });
});

describe("timestampLabelFor (T308): delegates to frontend-core, same clock as web", () => {
  const IST = "Asia/Kolkata";
  const EN_GB = "en-GB";

  function entryAt(timestamp: string): CoreMessageEntry {
    return {
      kind: "assistant-message",
      id: "row-9",
      epoch: "epoch-1",
      seqStart: 9,
      seqEnd: 9,
      timestamp,
      provider: "pi",
      pending: false,
      stale: false,
      text: "done",
      corrected: false,
    } as CoreMessageEntry;
  }

  it("returns the device-local time for the entry's own timestamp", () => {
    const label = timestampLabelFor(entryAt("2026-09-09T12:12:08.000Z"), {
      now: new Date("2026-09-09T18:00:00.000Z"),
      timeZone: IST,
      locale: EN_GB,
    });

    expect(label?.text).toBe("17:42:08");
    expect(label?.iso).toBe("2026-09-09T12:12:08.000Z");
  });

  it("produces byte-identical output to calling frontend-core directly", () => {
    // The point of this helper is that it adds no formatting of its own — a
    // second implementation here is exactly the web/Android drift T308 set
    // out to prevent, so this pins delegation rather than behaviour twice.
    const entry = entryAt("2026-09-08T19:00:00.000Z");
    const options = { now: new Date("2026-09-09T06:00:00.000Z"), timeZone: IST, locale: EN_GB };

    expect(timestampLabelFor(entry, options)).toEqual(
      coreTimeline.formatMessageTimestamp(entry.timestamp, options),
    );
  });

  it("returns null for an unparseable timestamp so the row renders nothing", () => {
    expect(timestampLabelFor(entryAt("not a date"), { timeZone: IST })).toBeNull();
  });

  it("uses the device clock and locale when no options are passed", () => {
    // The production call site passes nothing; this proves that path works
    // rather than only the pinned-zone one the assertions above use.
    const label = timestampLabelFor(entryAt(new Date().toISOString()));

    expect(label).not.toBeNull();
    expect(label?.text).toMatch(/\d{1,2}:\d{2}:\d{2}/);
  });
});

describe("areMessageRowPropsEqual: reads timestamp, the field T308 made the row render", () => {
  function entryAt(timestamp: string): CoreMessageEntry {
    return {
      kind: "user-message",
      id: "row-1",
      epoch: "epoch-1",
      seqStart: 1,
      seqEnd: 1,
      timestamp,
      provider: "pi",
      pending: false,
      stale: false,
      text: "Hi Pi",
    } as CoreMessageEntry;
  }

  it("treats a changed timestamp as a change", () => {
    const previous = {
      entry: entryAt("2026-09-09T12:12:08.000Z"),
      streaming: false,
      testId: "row",
    };
    const next = { entry: entryAt("2026-09-09T13:13:09.000Z"), streaming: false, testId: "row" };

    expect(areMessageRowPropsEqual(previous, next)).toBe(false);
  });

  it("still treats an identical-valued fresh object as equal", () => {
    const previous = {
      entry: entryAt("2026-09-09T12:12:08.000Z"),
      streaming: false,
      testId: "row",
    };
    const next = { entry: entryAt("2026-09-09T12:12:08.000Z"), streaming: false, testId: "row" };

    expect(areMessageRowPropsEqual(previous, next)).toBe(true);
  });
});
