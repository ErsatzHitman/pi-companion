import type { AgentProvider, AgentStreamEvent, AgentTimelineItem } from "./agent-sdk-types.js";

/**
 * plan.md §14.5 budgets "no bridge update rate above 20 messages per second per agent"
 * (plan.md:1154). This constant is what delivers that budget for a single continuously
 * streaming timeline entry: while events for the same assistant_message/reasoning text
 * stream (or the same running tool_call) keep arriving, they collapse into one buffered
 * entry per window (see collapseEntries below), and that entry produces exactly one
 * onFlush call every windowMs — so that stream's own flush cadence is capped at
 * 1000 / 60 ≈ 16.67 messages/sec, under the 20/sec ceiling. Each onFlush call reaches the
 * bridge as one dispatched event: AgentManager's onFlush wiring
 * (agent-manager.ts:654-658) calls recordAndDispatchTimelineItem, which calls
 * dispatchStream once per invocation.
 *
 * This is the value production actually runs with: AgentManager falls back to it
 * (agent-manager.ts:653) whenever `agentStreamCoalesceWindowMs` is not supplied, and its
 * only production construction site, bootstrap.ts's `new AgentManager({...})` (around
 * bootstrap.ts:834), does not supply it. Every override of `windowMs` found in this
 * package today is in a `*.test.ts` file.
 *
 * What this window does NOT bound: flushBuffer (below) calls onFlush once per collapsed
 * entry, not once per flush, so a single window that accumulates several entries that do
 * not collapse together — alternating assistant/reasoning text, different providers or
 * turnIds, or more than one distinct tool_call — dispatches one bridge message per entry
 * out of that one window. (`agent-stream-coalescer.test.ts`'s "preserves strict
 * alternating assistant/reasoning order" flushes 4 items from a single 60 ms window.) A
 * terminal tool_call (completed/failed/canceled) also flushes immediately, bypassing the
 * window entirely (see `handle()` below). So `windowMs` throttles one stream's own update
 * cadence; it is not a hard ceiling on total per-agent bridge traffic.
 */
export const AGENT_STREAM_COALESCE_DEFAULT_WINDOW_MS = 60;

type CoalescableTextKind = "assistant_message" | "reasoning";
type CoalescableTimelineKind = CoalescableTextKind | "tool_call";
type CoalescableTextItem = Extract<AgentTimelineItem, { type: CoalescableTextKind }>;
type CoalescableTimelineItem = Extract<AgentTimelineItem, { type: CoalescableTimelineKind }>;
type CoalescableTimelineEvent = Extract<AgentStreamEvent, { type: "timeline" }> & {
  item: CoalescableTimelineItem;
};

export interface AgentStreamCoalescerTimers {
  setTimeout: (callback: () => void, ms?: number) => ReturnType<typeof setTimeout>;
  clearTimeout: typeof clearTimeout;
}

export interface AgentStreamCoalescerFlush {
  agentId: string;
  item: CoalescableTimelineItem;
  provider: AgentProvider;
  turnId?: string;
}

export interface AgentStreamCoalescerOptions {
  windowMs?: number;
  timers: AgentStreamCoalescerTimers;
  onFlush: (payload: AgentStreamCoalescerFlush) => void;
}

interface PendingTextEntry {
  kind: "text";
  item: CoalescableTextItem;
  text: string;
  provider: AgentProvider;
  turnId?: string;
}

interface PendingToolCallEntry {
  kind: "tool_call";
  item: Extract<AgentTimelineItem, { type: "tool_call" }>;
  provider: AgentProvider;
  turnId?: string;
}

type PendingAgentStreamEntry = PendingTextEntry | PendingToolCallEntry;

interface PendingAgentStreamBuffer {
  agentId: string;
  entries: PendingAgentStreamEntry[];
  toolCallEntryIndexes: Map<string, number>;
  timer: ReturnType<typeof setTimeout> | null;
  flushing: boolean;
}

function isCoalescableTimelineEvent(event: AgentStreamEvent): event is CoalescableTimelineEvent {
  return (
    event.type === "timeline" &&
    (event.item.type === "assistant_message" ||
      event.item.type === "reasoning" ||
      event.item.type === "tool_call")
  );
}

function isTextTimelineItem(item: CoalescableTimelineItem): item is CoalescableTextItem {
  return item.type === "assistant_message" || item.type === "reasoning";
}

function isTerminalToolCall(item: CoalescableTimelineItem): boolean {
  return (
    item.type === "tool_call" &&
    (item.status === "completed" || item.status === "failed" || item.status === "canceled")
  );
}

function isSameTextStream(previous: PendingTextEntry, next: PendingTextEntry): boolean {
  if (previous.item.type !== next.item.type) {
    return false;
  }
  if (previous.item.type === "assistant_message" && next.item.type === "assistant_message") {
    return previous.item.messageId === next.item.messageId;
  }
  return true;
}

export class AgentStreamCoalescer {
  private readonly buffers = new Map<string, PendingAgentStreamBuffer>();
  private readonly onFlush: (payload: AgentStreamCoalescerFlush) => void;
  private readonly timers: AgentStreamCoalescerTimers;
  private readonly windowMs: number;

  constructor(options: AgentStreamCoalescerOptions) {
    this.windowMs = options.windowMs ?? AGENT_STREAM_COALESCE_DEFAULT_WINDOW_MS;
    this.timers = options.timers;
    this.onFlush = options.onFlush;
  }

  handle(agentId: string, event: AgentStreamEvent): boolean {
    if (!isCoalescableTimelineEvent(event)) {
      return false;
    }

    if (isTextTimelineItem(event.item) && event.item.text === "") {
      return true;
    }

    const buffer = this.getOrCreateBuffer(agentId);
    this.appendToBuffer(buffer, event);

    if (isTerminalToolCall(event.item)) {
      this.flushBuffer(agentId);
      return true;
    }

    if (!buffer.timer) {
      this.scheduleFlush(buffer);
    }

    return true;
  }

  flushFor(agentId: string): void {
    this.flushBuffer(agentId);
  }

  flushAll(): void {
    for (const agentId of Array.from(this.buffers.keys())) {
      this.flushBuffer(agentId);
    }
  }

  flushAndDiscard(agentId: string): void {
    this.flushBuffer(agentId);
    const buffer = this.buffers.get(agentId);
    if (buffer) {
      this.clearTimer(buffer);
      this.buffers.delete(agentId);
    }
  }

  private getOrCreateBuffer(agentId: string): PendingAgentStreamBuffer {
    const existing = this.buffers.get(agentId);
    if (existing) {
      return existing;
    }

    const buffer: PendingAgentStreamBuffer = {
      agentId,
      entries: [],
      toolCallEntryIndexes: new Map(),
      timer: null,
      flushing: false,
    };
    this.buffers.set(agentId, buffer);
    return buffer;
  }

  private appendToBuffer(buffer: PendingAgentStreamBuffer, event: CoalescableTimelineEvent): void {
    if (isTextTimelineItem(event.item)) {
      buffer.entries.push({
        kind: "text",
        item: event.item,
        text: event.item.text,
        provider: event.provider,
        ...(event.turnId !== undefined ? { turnId: event.turnId } : {}),
      });
      return;
    }

    const existingIndex = buffer.toolCallEntryIndexes.get(event.item.callId);
    const entry: PendingToolCallEntry = {
      kind: "tool_call",
      item: event.item,
      provider: event.provider,
      ...(event.turnId !== undefined ? { turnId: event.turnId } : {}),
    };

    if (existingIndex !== undefined) {
      buffer.entries[existingIndex] = entry;
      return;
    }

    buffer.toolCallEntryIndexes.set(event.item.callId, buffer.entries.length);
    buffer.entries.push(entry);
  }

  private scheduleFlush(buffer: PendingAgentStreamBuffer): void {
    const timer = this.timers.setTimeout(() => {
      this.flushBuffer(buffer.agentId, buffer);
    }, this.windowMs);
    timer.unref?.();
    buffer.timer = timer;
  }

  private clearTimer(buffer: PendingAgentStreamBuffer): void {
    if (!buffer.timer) {
      return;
    }
    this.timers.clearTimeout(buffer.timer);
    buffer.timer = null;
  }

  private flushBuffer(agentId: string, expectedBuffer?: PendingAgentStreamBuffer): void {
    const buffer = this.buffers.get(agentId);
    if (!buffer) {
      return;
    }
    if (expectedBuffer && buffer !== expectedBuffer) {
      return;
    }
    if (buffer.flushing) {
      return;
    }

    this.clearTimer(buffer);
    if (buffer.entries.length === 0) {
      return;
    }

    const entries = buffer.entries;
    buffer.entries = [];
    buffer.toolCallEntryIndexes.clear();
    buffer.flushing = true;

    try {
      for (const entry of this.collapseEntries(entries)) {
        this.onFlush({
          agentId,
          item:
            entry.kind === "text"
              ? {
                  ...entry.item,
                  text: entry.text,
                }
              : entry.item,
          provider: entry.provider,
          ...(entry.turnId !== undefined ? { turnId: entry.turnId } : {}),
        });
      }
    } finally {
      buffer.flushing = false;
    }
  }

  private collapseEntries(entries: PendingAgentStreamEntry[]): PendingAgentStreamEntry[] {
    const collapsed: PendingAgentStreamEntry[] = [];

    for (const entry of entries) {
      const previous = collapsed.at(-1);
      if (
        previous &&
        previous.kind === "text" &&
        entry.kind === "text" &&
        isSameTextStream(previous, entry) &&
        previous.provider === entry.provider &&
        previous.turnId === entry.turnId
      ) {
        previous.text += entry.text;
        continue;
      }

      collapsed.push({ ...entry });
    }

    return collapsed;
  }
}
