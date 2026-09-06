/**
 * `ToolCallViewModelRegistry` — plan.md §7.4 ("keep tool execution updates
 * attached to their tool call"), §11.6.
 *
 * The daemon re-emits a `tool_call` timeline item multiple times for one
 * call as it progresses (`running` with partial detail, possibly more than
 * once, then a terminal `completed` / `failed` / `canceled`), all sharing
 * one `callId` (see the ported Pi provider's `PiRpcAgentSession.emitToolCallEvent`
 * and `PiHistoryMapper`, which both re-emit the full `tool_call` item per
 * update rather than a delta). This registry keys view models by `callId`
 * so those re-emissions update one card in place instead of producing
 * duplicates, and tracks `startedAt`/`updateCount`/`durationMs` across the
 * whole lifecycle.
 */
import type { Clock } from "../platform/clock.js";

import { buildToolCallViewModel } from "./view-model.js";
import type { ToolCallBuildOptions, ToolCallViewModel } from "./types.js";
import { isRecord, readNonEmptyString } from "./util.js";

export interface ToolCallUpsertOptions extends Omit<
  ToolCallBuildOptions,
  "previous" | "observedAt"
> {
  /** Overrides the registry's `Clock` for this one upsert (mainly for
   * tests that want an exact timestamp). */
  observedAt?: number;
}

/** Matches the `"unknown-call"` fallback `buildGenericToolCallViewModel`
 * uses when a raw value has no recoverable `callId`, so a lookup keyed by
 * this function always agrees with what the built view model reports as
 * its own `callId`. */
const UNIDENTIFIED_CALL_ID = "unknown-call";

function extractCallId(raw: unknown): string {
  if (isRecord(raw)) {
    const callId = readNonEmptyString(raw.callId);
    if (callId) {
      return callId;
    }
  }
  return UNIDENTIFIED_CALL_ID;
}

/**
 * Keeps one `ToolCallViewModel` per `callId`, updated in place as new
 * `tool_call` timeline items arrive for the same call.
 */
export class ToolCallViewModelRegistry {
  private readonly entries = new Map<string, ToolCallViewModel>();

  constructor(private readonly clock: Clock) {}

  /** Builds (or rebuilds) the view model for whatever `callId` is in
   * `raw`, preserving streaming continuity with any prior build for that
   * same `callId`. Never throws — unrecognized/malformed input still
   * produces (and stores) a `GenericToolCallViewModel`. */
  upsert(raw: unknown, options: ToolCallUpsertOptions = {}): ToolCallViewModel {
    const callId = extractCallId(raw);
    const previous = this.entries.get(callId);
    const next = buildToolCallViewModel(raw, {
      ...options,
      observedAt: options.observedAt ?? this.clock.now(),
      previous,
    });
    this.entries.set(next.callId, next);
    return next;
  }

  get(callId: string): ToolCallViewModel | undefined {
    return this.entries.get(callId);
  }

  /** All tracked view models, oldest-first-seen order. */
  list(): ToolCallViewModel[] {
    return [...this.entries.values()];
  }

  has(callId: string): boolean {
    return this.entries.has(callId);
  }

  remove(callId: string): void {
    this.entries.delete(callId);
  }

  clear(): void {
    this.entries.clear();
  }

  get size(): number {
    return this.entries.size;
  }
}
