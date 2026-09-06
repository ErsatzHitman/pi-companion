/**
 * Minimal in-memory `Clock`/`DaemonPermissionsSource` test doubles for
 * this feature's own tests only (never shipped behind a real code
 * path). Mirrors `apps/web/src/features/approvals/test-doubles.ts` and
 * `features/composer/composer-model.test.ts`'s own "own tiny copy
 * instead of reaching into `packages/frontend-core/src`" convention
 * (plan.md §6: apps depend on package *exports*, never source-relative
 * cross-workspace paths).
 */
import type { Clock, TimerHandle } from "@picompanion/frontend-core";
import type { permissions } from "@picompanion/frontend-core";

import type {
  DaemonPermissionRequestMessage,
  DaemonPermissionResolvedMessage,
  DaemonPermissionsSource,
} from "./daemon-permissions-client.js";

/** Deterministic, manually advanced `Clock` test double, `now()`-only (no scheduled timers needed by this feature's own tests — see `ApprovalsContainer`'s doc comment for why no `defaultTimeoutMs` is passed). */
export class FakeClock implements Clock {
  private currentMs: number;

  constructor(startMs = 0) {
    this.currentMs = startMs;
  }

  now(): number {
    return this.currentMs;
  }

  advance(deltaMs: number): void {
    this.currentMs += deltaMs;
  }

  setTimeout(): TimerHandle {
    throw new Error("FakeClock.setTimeout is not implemented; this test double is now-only.");
  }

  clearTimeout(): void {
    throw new Error("FakeClock.clearTimeout is not implemented; this test double is now-only.");
  }

  setInterval(): TimerHandle {
    throw new Error("FakeClock.setInterval is not implemented; this test double is now-only.");
  }

  clearInterval(): void {
    throw new Error("FakeClock.clearInterval is not implemented; this test double is now-only.");
  }
}

type PermissionHandler<TType extends "agent_permission_request" | "agent_permission_resolved"> = (
  message: TType extends "agent_permission_request"
    ? DaemonPermissionRequestMessage
    : DaemonPermissionResolvedMessage,
) => void;

/**
 * In-memory `DaemonPermissionsSource` test double. Records every
 * `respondToPermission` call and lets a test script a canned success/
 * failure per call via `respondImpl`. `emitRequest`/`emitResolved`
 * simulate the daemon pushing a live `agent_permission_request`/
 * `agent_permission_resolved` — the latter is what this task's
 * "withdrawn" case (`approvals-queue-model.test.ts`) drives without any
 * prior local answer.
 */
export class FakeDaemonPermissionsSource implements DaemonPermissionsSource {
  readonly respondCalls: Array<{
    agentId: string;
    requestId: string;
    response: permissions.AgentPermissionResponse;
  }> = [];

  respondImpl: (
    agentId: string,
    requestId: string,
    response: permissions.AgentPermissionResponse,
  ) => Promise<void> = async () => {};

  private readonly requestHandlers = new Set<PermissionHandler<"agent_permission_request">>();
  private readonly resolvedHandlers = new Set<PermissionHandler<"agent_permission_resolved">>();

  async respondToPermission(
    agentId: string,
    requestId: string,
    response: permissions.AgentPermissionResponse,
  ): Promise<void> {
    this.respondCalls.push({ agentId, requestId, response });
    await this.respondImpl(agentId, requestId, response);
  }

  on<TType extends "agent_permission_request" | "agent_permission_resolved">(
    type: TType,
    handler: PermissionHandler<TType>,
  ): () => void {
    if (type === "agent_permission_request") {
      const requestHandler = handler as PermissionHandler<"agent_permission_request">;
      this.requestHandlers.add(requestHandler);
      return () => {
        this.requestHandlers.delete(requestHandler);
      };
    }
    const resolvedHandler = handler as PermissionHandler<"agent_permission_resolved">;
    this.resolvedHandlers.add(resolvedHandler);
    return () => {
      this.resolvedHandlers.delete(resolvedHandler);
    };
  }

  /** Test helper: simulates the daemon pushing a live `agent_permission_request`. */
  emitRequest(agentId: string, request: permissions.AgentPermissionRequest): void {
    const message: DaemonPermissionRequestMessage = {
      type: "agent_permission_request",
      payload: { agentId, request },
    };
    for (const handler of this.requestHandlers) handler(message);
  }

  /** Test helper: simulates the daemon pushing a live `agent_permission_resolved` — e.g. the request being withdrawn/superseded before this client answered it locally. */
  emitResolved(
    agentId: string,
    requestId: string,
    resolution: permissions.AgentPermissionResponse,
  ): void {
    const message: DaemonPermissionResolvedMessage = {
      type: "agent_permission_resolved",
      payload: { agentId, requestId, resolution },
    };
    for (const handler of this.resolvedHandlers) handler(message);
  }
}
