import type {
  AgentStreamEvent,
  AgentTimelineImageRef,
  AgentTimelineItem,
  ToolCallDetail,
} from "../../agent-sdk-types.js";
import { materializeProviderImage } from "../provider-image-output.js";
import type { PiAgentMessage, PiImageContent, PiTextContent } from "./rpc-types.js";
import {
  extractTextFromToolResult,
  mapToolDetail,
  parseToolArgs,
  parseToolResult,
  resolveToolCallName,
  type PiToolResult,
  type PiTrackedToolCall,
} from "./tool-call-mapper.js";

export interface PiCapturedUserMessageEntry {
  id: string;
  text: string;
}

export interface PiHistoryMapperHooks {
  mapCustomMessage?: (
    text: string,
    provider: string,
  ) => Extract<AgentStreamEvent, { type: "timeline" }> | null;
  resolveToolCallId?: (toolCallId: string, toolCall: PiTrackedToolCall) => string;
  mapToolDetail?: (
    toolCall: PiTrackedToolCall,
    result: PiToolResult,
    context: { toolCallId: string },
  ) => ToolCallDetail | null;
}

function isTextContentBlock(block: unknown): block is PiTextContent {
  return (
    typeof block === "object" &&
    block !== null &&
    !Array.isArray(block) &&
    Reflect.get(block, "type") === "text" &&
    typeof Reflect.get(block, "text") === "string"
  );
}

export function getUserMessageText(content: string | (PiTextContent | PiImageContent)[]): string {
  if (typeof content === "string") {
    return content;
  }

  const textParts: string[] = [];
  for (const block of content) {
    if (isTextContentBlock(block)) {
      textParts.push(block.text);
    }
  }
  return textParts.join("\n\n");
}

function isImageContentBlock(block: unknown): block is PiImageContent {
  return (
    typeof block === "object" &&
    block !== null &&
    !Array.isArray(block) &&
    Reflect.get(block, "type") === "image" &&
    typeof Reflect.get(block, "data") === "string" &&
    typeof Reflect.get(block, "mimeType") === "string"
  );
}

/**
 * Extracts the image blocks from Pi's user/custom message content, in
 * order (T52A1). `getUserMessageText` above reads only the text blocks out
 * of this same array; before this function existed, an image a user
 * pasted — or a materialized-image hint another provider path re-sent to
 * Pi — was silently discarded the moment session history was replayed.
 * Pi's own wire format (`PiAgentMessage`, `rpc-types.ts`) never puts an
 * image block on an `assistant` message, only `user`/`custom`, so this is
 * the one extraction point that matters.
 */
function getUserMessageImages(
  content: string | (PiTextContent | PiImageContent)[],
): PiImageContent[] {
  if (typeof content === "string") {
    return [];
  }

  const images: PiImageContent[] = [];
  for (const block of content) {
    if (isImageContentBlock(block)) {
      images.push(block);
    }
  }
  return images;
}

/**
 * Materializes image content blocks to referenced `AgentTimelineImageRef`s
 * instead of the raw base64 bytes (T52A1 acceptance: "large binary content
 * is referenced rather than inlined wholesale into every timeline
 * fetch"). Reuses the same content-addressed temp-file materialization
 * tool-result images already use (`materializeProviderImage`,
 * `../provider-image-output.js`), so replaying the same history
 * repeatedly (reconnect, resume, a re-subscribed client) reuses one file
 * per distinct image instead of rewriting it, and the timeline item
 * itself never carries the bytes.
 *
 * A single image failing to materialize (e.g. a disk write error) does
 * not drop the whole message — the failing image is skipped and every
 * other block, text and other images, still survives the mapping.
 */
function materializeUserMessageImages(images: readonly PiImageContent[]): AgentTimelineImageRef[] {
  const refs: AgentTimelineImageRef[] = [];
  for (const image of images) {
    try {
      const materialized = materializeProviderImage({
        data: image.data,
        mimeType: image.mimeType,
      });
      refs.push({
        mimeType: image.mimeType,
        path: materialized.path,
        bytes: Buffer.from(image.data, "base64").length,
      });
    } catch {
      // Best-effort: one image failing to write to disk should not drop the
      // rest of the message (text, other images) from the timeline.
    }
  }
  return refs;
}

export class PiHistoryMapper {
  private readonly pendingToolCalls = new Map<string, PiTrackedToolCall>();
  private userIndex = 0;
  private assistantIndex = 0;

  constructor(
    private readonly provider: string,
    private readonly userEntries: readonly PiCapturedUserMessageEntry[] = [],
    private readonly hooks: PiHistoryMapperHooks = {},
  ) {}

  mapMessages(messages: readonly PiAgentMessage[]): AgentStreamEvent[] {
    const events: AgentStreamEvent[] = [];

    for (const message of messages) {
      switch (message.role) {
        case "user":
          events.push(...this.mapUserMessage(message));
          break;
        case "custom":
          events.push(...this.mapCustomMessage(message));
          break;
        case "assistant":
          events.push(...this.mapAssistantMessage(message));
          break;
        case "toolResult": {
          const event = this.mapToolResultMessage(message);
          if (event) {
            events.push(event);
          }
          break;
        }
        case "bashExecution":
          events.push(this.mapBashExecutionMessage(message));
          break;
      }
    }

    return events;
  }

  private mapUserMessage(message: Extract<PiAgentMessage, { role: "user" }>): AgentStreamEvent[] {
    const text = getUserMessageText(message.content);
    const images = materializeUserMessageImages(getUserMessageImages(message.content));
    this.userIndex += 1;
    if (!text && images.length === 0) {
      return [];
    }
    const userEntry = this.userEntries[this.userIndex - 1];
    return [
      {
        type: "timeline",
        provider: this.provider,
        item: {
          type: "user_message",
          text,
          ...(userEntry ? { messageId: userEntry.id } : {}),
          ...(images.length > 0 ? { images } : {}),
        },
      },
    ];
  }

  private mapCustomMessage(
    message: Extract<PiAgentMessage, { role: "custom" }>,
  ): AgentStreamEvent[] {
    if (Reflect.get(message, "display") === false) {
      return [];
    }
    const text = getUserMessageText(message.content);
    const images = materializeUserMessageImages(getUserMessageImages(message.content));
    const mappedEvent = text ? this.hooks.mapCustomMessage?.(text, this.provider) : null;
    if (mappedEvent) {
      return [mappedEvent];
    }
    if (!text && images.length === 0) {
      return [];
    }
    return [
      {
        type: "timeline",
        provider: this.provider,
        item: {
          type: "assistant_message",
          text,
          ...(images.length > 0 ? { images } : {}),
        },
      },
    ];
  }

  private mapAssistantMessage(
    message: Extract<PiAgentMessage, { role: "assistant" }>,
  ): AgentStreamEvent[] {
    const events: AgentStreamEvent[] = [];
    this.assistantIndex += 1;
    const messageId =
      message.responseId || `${this.provider}-history-assistant-${this.assistantIndex}`;
    for (const content of message.content) {
      if (content.type === "text" && content.text) {
        events.push({
          type: "timeline",
          provider: this.provider,
          item: { type: "assistant_message", text: content.text, messageId },
        });
        continue;
      }
      if (content.type === "thinking" && content.thinking) {
        events.push({
          type: "timeline",
          provider: this.provider,
          item: { type: "reasoning", text: content.thinking },
        });
        continue;
      }
      if (content.type === "toolCall") {
        const tracked = parseToolArgs(content.name, content.arguments);
        this.pendingToolCalls.set(content.id, tracked);
        const detail = this.mapToolDetail(content.id, tracked, null);
        if (!detail) {
          continue;
        }
        events.push({
          type: "timeline",
          provider: this.provider,
          item: {
            type: "tool_call",
            callId: this.resolveToolCallId(content.id, tracked),
            name: tracked.toolName,
            status: "running",
            detail,
            error: null,
          },
        });
      }
    }
    return events;
  }

  private mapToolResultMessage(
    message: Extract<PiAgentMessage, { role: "toolResult" }>,
  ): AgentStreamEvent | null {
    const tracked =
      this.pendingToolCalls.get(message.toolCallId) ?? parseToolArgs(message.toolName, null);
    this.pendingToolCalls.delete(message.toolCallId);
    const result = parseToolResult({ content: message.content, details: message.details });
    const detail = this.mapToolDetail(message.toolCallId, tracked, result);
    if (!detail) {
      return null;
    }
    return {
      type: "timeline",
      provider: this.provider,
      item: toToolResultTimelineItem({
        callId: this.resolveToolCallId(message.toolCallId, tracked),
        name: resolveToolCallName(tracked, result),
        isError: Boolean(message.isError),
        detail,
        errorText: extractTextFromToolResult(result) ?? "Tool call failed",
      }),
    };
  }

  private mapBashExecutionMessage(
    message: Extract<PiAgentMessage, { role: "bashExecution" }>,
  ): AgentStreamEvent {
    const detail: ToolCallDetail = {
      type: "shell",
      command: message.command,
      output: message.output,
      exitCode: message.exitCode ?? null,
    };
    return {
      type: "timeline",
      provider: this.provider,
      item: {
        type: "tool_call",
        callId: `pi-bash-${message.timestamp}`,
        name: "bash",
        status: message.cancelled ? "canceled" : "completed",
        detail,
        error: null,
      },
    };
  }

  private resolveToolCallId(toolCallId: string, toolCall: PiTrackedToolCall): string {
    return this.hooks.resolveToolCallId?.(toolCallId, toolCall) ?? toolCallId;
  }

  private mapToolDetail(
    toolCallId: string,
    toolCall: PiTrackedToolCall,
    result: PiToolResult,
  ): ToolCallDetail | null {
    const hook = this.hooks.mapToolDetail;
    return hook ? hook(toolCall, result, { toolCallId }) : mapToolDetail(toolCall, result);
  }
}

export async function* streamPiHistory(
  provider: string,
  messages: PiAgentMessage[],
  userEntries: readonly PiCapturedUserMessageEntry[] = [],
  hooks: PiHistoryMapperHooks = {},
): AsyncGenerator<AgentStreamEvent> {
  const mapper = new PiHistoryMapper(provider, userEntries, hooks);
  for (const event of mapper.mapMessages(messages)) {
    if (event) {
      yield event;
    }
  }
}

function toToolResultTimelineItem(input: {
  callId: string;
  name: string;
  isError: boolean;
  detail: ToolCallDetail;
  errorText: string;
}): AgentTimelineItem {
  if (input.isError) {
    return {
      type: "tool_call",
      callId: input.callId,
      name: input.name,
      status: "failed",
      detail: input.detail,
      error: input.errorText,
    };
  }
  return {
    type: "tool_call",
    callId: input.callId,
    name: input.name,
    status: "completed",
    detail: input.detail,
    error: null,
  };
}
