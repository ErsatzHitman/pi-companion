import { watch, type FSWatcher } from "node:fs";
import { open, readFile, stat } from "node:fs/promises";
import type { Logger } from "pino";
import type { AgentManager, ManagedAgent } from "../../agent-manager.js";
import type { AgentStreamEvent, AgentTimelineItem } from "../../agent-sdk-types.js";
import { PiHistoryMapper } from "./history-mapper.js";
import type { PiAgentMessage } from "./rpc-types.js";

export interface PiLiveTailOptions {
  logger: Logger;
  agentManager: AgentManager;
  debounceMs?: number;
  pollIntervalMs?: number;
}

const DEFAULT_DEBOUNCE_MS = 300;
const DEFAULT_POLL_MS = 1500;
const NEWLINE_BYTE = 0x0a;

interface TailState {
  agentId: string;
  filePath: string;
  watcher: FSWatcher | null;
  pollTimer: ReturnType<typeof setInterval> | null;
  debounceTimer: ReturnType<typeof setTimeout> | null;
  lastMtimeMs: number | null;
  lastSize: number | null;
  handling: boolean;
  /**
   * Byte offset up to (and including) the last fully-consumed JSONL line.
   * Reads for subsequent changes start here instead of rereading the file
   * from the start, so append processing is proportional to appended bytes.
   */
  readOffset: number;
  /**
   * Persistent history mapper carried across incremental reads so tool-call
   * pairing and message indices stay correct without remapping prior lines.
   */
  mapper: PiHistoryMapper | null;
  /** True once the initial catch-up pass has primed the checkpoint. */
  bootstrapped: boolean;
  /**
   * Set when a truncation/rewrite was detected so the next bootstrap treats
   * the file as having no prior known items, guaranteeing forward progress
   * even though the agent's existing timeline may now be ahead of the file.
   */
  forceFullEmitOnBootstrap: boolean;
}

export class PiLiveTailWatcher {
  private readonly logger: Logger;
  private readonly agentManager: AgentManager;
  private readonly debounceMs: number;
  private readonly pollIntervalMs: number;
  private readonly tails = new Map<string, TailState>();
  private unsubscribe: (() => void) | null = null;
  private stopped = false;

  constructor(options: PiLiveTailOptions) {
    this.logger = options.logger.child({ module: "pi-live-tail" });
    this.agentManager = options.agentManager;
    this.debounceMs = options.debounceMs ?? DEFAULT_DEBOUNCE_MS;
    this.pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_MS;
  }

  start(): void {
    this.stopped = false;
    // Watch existing pi agents
    for (const agent of this.agentManager.listAgents()) {
      if (this.isPiAgent(agent)) this.startTailing(agent);
    }
    // Subscribe to new agents
    this.unsubscribe = this.agentManager.subscribe((event) => {
      if (event.type !== "agent_state") return;
      const agent = event.agent;
      if (!this.isPiAgent(agent)) return;
      if (this.tails.has(agent.id)) return;
      this.startTailing(agent);
    });
    this.logger.info("Pi live tail watcher started");
  }

  stop(): void {
    this.stopped = true;
    if (this.unsubscribe) {
      try {
        this.unsubscribe();
      } catch {}
      this.unsubscribe = null;
    }
    for (const [agentId, state] of this.tails) {
      this.stopTailing(agentId, state);
    }
    this.tails.clear();
  }

  private isPiAgent(agent: ManagedAgent): boolean {
    return agent.provider === "pi" && !!agent.persistence?.nativeHandle;
  }

  private getFilePath(agent: ManagedAgent): string | null {
    const handle = agent.persistence?.nativeHandle ?? agent.persistence?.sessionId;
    return typeof handle === "string" && handle.endsWith(".jsonl") ? handle : null;
  }

  private startTailing(agent: ManagedAgent): void {
    const filePath = this.getFilePath(agent);
    if (!filePath) return;
    if (this.tails.has(agent.id)) return;

    const state: TailState = {
      agentId: agent.id,
      filePath,
      watcher: null,
      pollTimer: null,
      debounceTimer: null,
      lastMtimeMs: null,
      lastSize: null,
      handling: false,
      readOffset: 0,
      mapper: null,
      bootstrapped: false,
      forceFullEmitOnBootstrap: false,
    };
    this.tails.set(agent.id, state);

    // Initial mtime/size
    void stat(filePath)
      .then((s) => {
        state.lastMtimeMs = s.mtimeMs;
        state.lastSize = s.size;
      })
      .catch(() => {});

    // fs.watch on file
    try {
      const watcher = watch(filePath, () => this.scheduleDebounced(state));
      watcher.on("error", (err) => {
        this.logger.warn({ err, filePath, agentId: agent.id }, "Pi live tail watch error");
      });
      state.watcher = watcher;
    } catch (error) {
      this.logger.debug({ err: error, filePath }, "Failed to watch Pi session file, polling only");
    }

    // Poll backstop for FS where watch drops
    state.pollTimer = setInterval(() => {
      void this.checkAndTail(state);
    }, this.pollIntervalMs);
    (state.pollTimer as unknown as { unref?: () => void }).unref?.();

    // Prime the checkpoint (one-time catch-up read) so the watcher/poll loop
    // above can rely on incremental reads for every subsequent change.
    void this.checkAndTail(state);

    this.logger.debug({ agentId: agent.id, filePath }, "Started Pi live tail");
  }

  private stopTailing(_agentId: string, state: TailState): void {
    if (state.watcher) {
      try {
        state.watcher.close();
      } catch {}
      state.watcher = null;
    }
    if (state.pollTimer) {
      clearInterval(state.pollTimer);
      state.pollTimer = null;
    }
    if (state.debounceTimer) {
      clearTimeout(state.debounceTimer);
      state.debounceTimer = null;
    }
  }

  private scheduleDebounced(state: TailState): void {
    if (this.stopped) return;
    if (state.debounceTimer) clearTimeout(state.debounceTimer);
    state.debounceTimer = setTimeout(() => {
      state.debounceTimer = null;
      void this.checkAndTail(state);
    }, this.debounceMs);
  }

  private getCurrentTimelineCount(agentId: string): number {
    try {
      return this.agentManager.getTimeline(agentId).length;
    } catch {
      return 0;
    }
  }

  private async checkAndTail(state: TailState): Promise<void> {
    if (state.handling || this.stopped) return;
    // Verify agent still exists and is pi
    const agent = this.agentManager.getAgent(state.agentId);
    if (!agent || agent.provider !== "pi") {
      this.stopTailing(state.agentId, state);
      this.tails.delete(state.agentId);
      return;
    }

    let stats;
    try {
      stats = await stat(state.filePath);
    } catch {
      return;
    }
    // No change?
    if (
      state.bootstrapped &&
      state.lastMtimeMs !== null &&
      state.lastSize !== null &&
      stats.mtimeMs === state.lastMtimeMs &&
      stats.size === state.lastSize
    ) {
      return;
    }
    // File truncated or replaced (should not happen in normal operation):
    // the checkpoint can no longer be trusted, so reset and re-bootstrap
    // safely instead of reading past the end of the file or emitting bad data.
    if (state.bootstrapped && stats.size < state.readOffset) {
      this.logger.warn(
        { filePath: state.filePath, agentId: state.agentId },
        "Pi live tail detected truncation, resetting checkpoint",
      );
      state.bootstrapped = false;
      state.mapper = null;
      state.readOffset = 0;
      state.forceFullEmitOnBootstrap = true;
    }
    state.lastMtimeMs = stats.mtimeMs;
    state.lastSize = stats.size;

    state.handling = true;
    try {
      if (!state.bootstrapped) {
        await this.bootstrapTail(state, stats.size);
      } else {
        await this.incrementalTail(state, stats.size);
      }
    } catch (error) {
      this.logger.warn({ err: error, filePath: state.filePath }, "Pi live tail failed");
    } finally {
      state.handling = false;
    }
  }

  /**
   * One-time catch-up pass: reads the whole file (unavoidable, since we must
   * reconcile with whatever the agent's timeline already contains), primes a
   * persistent history mapper, and establishes the byte-offset checkpoint
   * that all subsequent reads build on incrementally.
   */
  private async bootstrapTail(state: TailState, fileSize: number): Promise<void> {
    let buffer: Buffer;
    try {
      buffer = await readFile(state.filePath);
    } catch {
      return;
    }
    const { completeText, consumedBytes } = splitCompleteLines(buffer);
    const messages = parseMessagesFromText(completeText);

    const mapper = new PiHistoryMapper("pi");
    const events = mapper.mapMessages(messages);

    // After a detected truncation the agent's existing timeline count no
    // longer corresponds to this file's contents, so start from zero to
    // guarantee the new content is emitted instead of silently dropped.
    const knownCount = state.forceFullEmitOnBootstrap
      ? 0
      : this.getCurrentTimelineCount(state.agentId);
    if (events.length > knownCount) {
      await this.emitEvents(state, events.slice(knownCount));
    }

    state.mapper = mapper;
    state.readOffset = consumedBytes;
    state.bootstrapped = true;
    state.forceFullEmitOnBootstrap = false;
    void fileSize;
  }

  /**
   * Incremental pass: reads only the bytes appended since the last
   * checkpoint, parses the new complete JSONL lines, and feeds just those
   * new messages into the already-primed mapper. Work is proportional to
   * appended bytes, not total file size.
   */
  private async incrementalTail(state: TailState, fileSize: number): Promise<void> {
    if (fileSize <= state.readOffset || !state.mapper) return;

    const chunk = await readFileRange(state.filePath, state.readOffset, fileSize);
    if (chunk.length === 0) return;

    const { completeText, consumedBytes } = splitCompleteLines(chunk);
    if (consumedBytes === 0) {
      // Trailing partial line only (mid-write); wait for the next change.
      return;
    }
    const messages = parseMessagesFromText(completeText);
    state.readOffset += consumedBytes;
    if (messages.length === 0) return;

    const events = state.mapper.mapMessages(messages);
    if (events.length > 0) {
      await this.emitEvents(state, events);
    }
  }

  private async emitEvents(state: TailState, events: readonly AgentStreamEvent[]): Promise<void> {
    const items: AgentTimelineItem[] = [];
    for (const event of events) {
      if (event.type === "timeline") items.push(event.item);
    }
    if (items.length === 0) return;

    this.logger.info(
      { agentId: state.agentId, newCount: items.length },
      "Pi live tail emitting new items",
    );

    for (const item of items) {
      // Skip system injected envelopes
      if (item.type === "user_message" && isSystemInjected(item.text)) continue;
      try {
        // Use appendTimelineItem which records and broadcasts via agent_state / agent_stream
        await this.agentManager.appendTimelineItem(state.agentId, item);
      } catch (error) {
        this.logger.warn({ err: error, agentId: state.agentId }, "Failed to append live tail item");
      }
    }
  }
}

/**
 * Splits a buffer into the text up to (and including) the last complete
 * line and the number of bytes that portion occupies. Cutting on the raw
 * `\n` byte is always a safe UTF-8 boundary because 0x0A never appears as
 * part of a multi-byte sequence.
 */
function splitCompleteLines(buffer: Buffer): { completeText: string; consumedBytes: number } {
  const lastNewline = buffer.lastIndexOf(NEWLINE_BYTE);
  if (lastNewline === -1) {
    return { completeText: "", consumedBytes: 0 };
  }
  const consumedBytes = lastNewline + 1;
  return { completeText: buffer.subarray(0, consumedBytes).toString("utf8"), consumedBytes };
}

async function readFileRange(filePath: string, start: number, end: number): Promise<Buffer> {
  if (end <= start) return Buffer.alloc(0);
  const handle = await open(filePath, "r");
  try {
    const length = end - start;
    const buffer = Buffer.alloc(length);
    await handle.read(buffer, 0, length, start);
    return buffer;
  } finally {
    await handle.close();
  }
}

function parseMessagesFromText(text: string): PiAgentMessage[] {
  const lines = text.split(/\r?\n/);
  const messages: PiAgentMessage[] = [];
  for (const raw of lines) {
    const trimmed = raw.trim();
    if (!trimmed) continue;
    let entry: Record<string, unknown>;
    try {
      entry = JSON.parse(trimmed) as Record<string, unknown>;
    } catch {
      continue;
    }
    if (entry.type !== "message") continue;
    const msg = entry.message as unknown;
    if (!msg || typeof msg !== "object" || Array.isArray(msg)) continue;
    const role = (msg as Record<string, unknown>).role;
    if (typeof role !== "string") continue;
    // Validate role is known PiAgentMessage role
    if (
      role !== "user" &&
      role !== "assistant" &&
      role !== "custom" &&
      role !== "toolResult" &&
      role !== "bashExecution"
    ) {
      continue;
    }
    messages.push(msg as PiAgentMessage);
  }
  return messages;
}

function isSystemInjected(text: string): boolean {
  // Matches system-injected envelope check in agent-prompt.ts
  return text.includes("<system>") || text.includes("PASEO_") || text.trim().startsWith("[System");
}
