/**
 * `PermissionsController` — pending/answered/timeout state and response
 * dispatch for permission and extension dialog requests (plan.md §7.1,
 * §11.2, §12.3, `docs/issues-from-plan.md` T21A).
 *
 * This controller owns no transport. It ingests already-deserialized
 * daemon WebSocket frames (`agent_permission_request`,
 * `agent_permission_resolved`) — typically handed to it by the
 * connection domain (T19A) — and produces the outbound
 * `agent_permission_response` wire message for the caller to send. It
 * never calls a socket, `fetch`, or any other platform API itself; the
 * only platform dependency is the narrow `Clock` interface (plan.md
 * §7.3), used for `now()` timestamps and scheduling client-side dialog
 * timeouts.
 */

import type { Clock, TimerHandle } from "../platform/clock.js";
import {
  AgentPermissionRequestMessageSchema,
  AgentPermissionResolvedMessageSchema,
} from "@picompanion/protocol/messages";
import { toPermissionDialogViewModel } from "./view-model.js";
import type {
  AgentPermissionRequest,
  AgentPermissionResponse,
  AgentPermissionResponseWireMessage,
  PermissionDialogEntry,
  PermissionDialogStatus,
  PermissionDialogViewModel,
} from "./types.js";

export interface PermissionsControllerOptions {
  readonly clock: Clock;
  /**
   * Milliseconds after which a still-pending dialog auto-times-out.
   * Omit (or pass `undefined`) to never time out automatically — a
   * caller can still resolve requests manually via `answer`.
   */
  readonly defaultTimeoutMs?: number;
  /** Invoked once, synchronously, when a request transitions to `"timeout"`. */
  readonly onTimeout?: (entry: PermissionDialogEntry) => void;
}

export type PermissionMessageHandlingResult =
  | { readonly handled: true; readonly kind: "request" | "resolved" }
  | { readonly handled: false };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * Pending/answered/timeout state for permission and extension dialog
 * requests, keyed by `requestId`. See module docs above.
 */
export class PermissionsController {
  private readonly clock: Clock;
  private readonly defaultTimeoutMs: number | undefined;
  private readonly onTimeout: ((entry: PermissionDialogEntry) => void) | undefined;

  private readonly entries = new Map<string, PermissionDialogEntry>();
  private readonly timers = new Map<string, TimerHandle>();
  private readonly listeners = new Set<() => void>();
  private disposed = false;

  constructor(options: PermissionsControllerOptions) {
    this.clock = options.clock;
    this.defaultTimeoutMs = options.defaultTimeoutMs;
    this.onTimeout = options.onTimeout;
  }

  /** All requests known to this controller, insertion order. */
  list(): PermissionDialogEntry[] {
    return Array.from(this.entries.values());
  }

  /** Only the requests still awaiting a response. */
  getPending(): PermissionDialogViewModel[] {
    return this.list()
      .filter((entry) => entry.status === "pending")
      .map((entry) => entry.view);
  }

  get(requestId: string): PermissionDialogEntry | undefined {
    return this.entries.get(requestId);
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Parses one already-deserialized daemon WebSocket message and, if it
   * is `agent_permission_request` or `agent_permission_resolved`,
   * applies it. Returns `{ handled: false }` for anything else instead
   * of throwing, so callers can pass every inbound message through
   * unconditionally.
   */
  handleMessage(message: unknown): PermissionMessageHandlingResult {
    if (!isRecord(message) || typeof message.type !== "string") {
      return { handled: false };
    }
    if (message.type === "agent_permission_request") {
      const parsed = AgentPermissionRequestMessageSchema.safeParse(message);
      if (!parsed.success) {
        return { handled: false };
      }
      this.ingestRequest(parsed.data.payload.agentId, parsed.data.payload.request);
      return { handled: true, kind: "request" };
    }
    if (message.type === "agent_permission_resolved") {
      const parsed = AgentPermissionResolvedMessageSchema.safeParse(message);
      if (!parsed.success) {
        return { handled: false };
      }
      this.applyResolution(
        parsed.data.payload.agentId,
        parsed.data.payload.requestId,
        parsed.data.payload.resolution,
      );
      return { handled: true, kind: "resolved" };
    }
    return { handled: false };
  }

  /**
   * Registers a new permission or extension dialog request as pending.
   * Idempotent: re-ingesting a known `requestId` is a no-op (matches the
   * timeline invariant that duplicate events never produce duplicate
   * rows — plan.md §7.4 — applied here to permission requests).
   */
  ingestRequest(agentId: string, request: AgentPermissionRequest): PermissionDialogEntry {
    const existing = this.entries.get(request.id);
    if (existing) {
      return existing;
    }
    const entry: PermissionDialogEntry = {
      view: toPermissionDialogViewModel(agentId, request),
      status: "pending",
      requestedAt: this.clock.now(),
    };
    this.entries.set(request.id, entry);
    this.scheduleTimeout(request.id);
    this.notify();
    return entry;
  }

  /**
   * Dispatches a user's answer. Returns the outbound
   * `agent_permission_response` wire message, or `null` if the request
   * is unknown or no longer `"pending"` (already answered or timed
   * out — a stale UI action, never a throw).
   */
  answer(
    requestId: string,
    response: AgentPermissionResponse,
  ): AgentPermissionResponseWireMessage | null {
    const entry = this.entries.get(requestId);
    if (!entry || entry.status !== "pending") {
      return null;
    }
    this.clearTimeout(requestId);
    this.transition(requestId, {
      ...entry,
      status: "answered",
      respondedAt: this.clock.now(),
      localResponse: response,
    });
    return {
      type: "agent_permission_response",
      agentId: entry.view.agentId,
      requestId,
      response,
    };
  }

  /**
   * Applies the daemon's confirmed resolution
   * (`agent_permission_resolved`). Always wins over local state — the
   * daemon is authoritative (plan.md §7.2) — including reconciling a
   * request this client had already marked `"timeout"`. Unknown
   * `requestId`s (e.g. resolved before this client observed the
   * request) are ignored rather than fabricating a view model.
   */
  applyResolution(agentId: string, requestId: string, resolution: AgentPermissionResponse): void {
    const entry = this.entries.get(requestId);
    if (!entry) {
      return;
    }
    this.clearTimeout(requestId);
    this.transition(requestId, {
      ...entry,
      view: entry.view.agentId === agentId ? entry.view : { ...entry.view, agentId },
      status: "answered",
      resolvedAt: this.clock.now(),
      resolution,
    });
  }

  /** Clears every pending timer and subscriber. Safe to call more than once. */
  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    for (const handle of this.timers.values()) {
      this.clock.clearTimeout(handle);
    }
    this.timers.clear();
    this.listeners.clear();
  }

  private scheduleTimeout(requestId: string): void {
    if (this.defaultTimeoutMs === undefined || this.disposed) {
      return;
    }
    const handle = this.clock.setTimeout(() => {
      this.timers.delete(requestId);
      this.fireTimeout(requestId);
    }, this.defaultTimeoutMs);
    this.timers.set(requestId, handle);
  }

  private fireTimeout(requestId: string): void {
    const entry = this.entries.get(requestId);
    if (!entry || entry.status !== "pending") {
      return;
    }
    const timedOut: PermissionDialogEntry = {
      ...entry,
      status: "timeout",
      respondedAt: this.clock.now(),
    };
    this.entries.set(requestId, timedOut);
    this.onTimeout?.(timedOut);
    this.notify();
  }

  private clearTimeout(requestId: string): void {
    const handle = this.timers.get(requestId);
    if (handle !== undefined) {
      this.clock.clearTimeout(handle);
      this.timers.delete(requestId);
    }
  }

  private transition(requestId: string, next: PermissionDialogEntry): void {
    this.entries.set(requestId, next);
    this.notify();
  }

  private notify(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }
}

export type { PermissionDialogStatus };
