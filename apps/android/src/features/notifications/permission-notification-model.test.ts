/**
 * T36B — permission-notification model tests, plan.md §9.3.
 *
 * Proves this task's three criteria against a real
 * `permissions.PermissionsController` (frontend-core, unmodified) plus
 * scripted `PushRegistrationPort`/`DaemonPermissionsSource` fakes — no
 * socket, no device, no emulator (repo-wide port-6767/6768 rule; this
 * wave's "nothing proven on an emulator/device/real socket" note).
 *
 * What this file does NOT prove, on purpose: that a real Android
 * notification with real action buttons is ever shown, or that a real
 * OS delivers a real tap/action event. This suite drives scripted
 * `PushRegistrationPort` fakes, not the real port;
 * `expo-push-registration-port.ts`'s `createExpoPushRegistrationPort`
 * (T391) is where the real `expo-notifications` calls live. T37E
 * (Maestro) and T59 (real device) own the on-device half.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Clock, TimerHandle } from "@picompanion/frontend-core";
import { permissions } from "@picompanion/frontend-core";

import type {
  DaemonPermissionRequestMessage,
  DaemonPermissionResolvedMessage,
  DaemonPermissionsSource,
} from "../approvals/daemon-permissions-client.js";

import {
  buildPermissionNotificationContent,
  createPermissionNotificationController,
  type PermissionNotificationOutcome,
} from "./permission-notification-model";
import type {
  PermissionNotificationActionEvent,
  PermissionNotificationContent,
  PushRegistrationPort,
} from "./push-registration-port";

const { PermissionsController } = permissions;

/** Own tiny `Clock` double for this feature's own tests only — `now()`-only, matching `../approvals/test-doubles.ts`'s `FakeClock` (not imported: that file is scoped to approvals' own tests). */
class FakeClock implements Clock {
  private ms = 0;
  now(): number {
    return this.ms;
  }
  setTimeout(): TimerHandle {
    throw new Error("not implemented");
  }
  clearTimeout(): void {}
  setInterval(): TimerHandle {
    throw new Error("not implemented");
  }
  clearInterval(): void {}
}

/** Minimal `DaemonPermissionsSource` double: records every send, never actually pushes request/resolved events (this file drives the controller directly instead). */
class FakeDaemon implements DaemonPermissionsSource {
  readonly respondCalls: Array<{
    agentId: string;
    requestId: string;
    response: permissions.AgentPermissionResponse;
  }> = [];

  async respondToPermission(
    agentId: string,
    requestId: string,
    response: permissions.AgentPermissionResponse,
  ): Promise<void> {
    this.respondCalls.push({ agentId, requestId, response });
  }

  on<TType extends "agent_permission_request" | "agent_permission_resolved">(
    _type: TType,
    _handler: (
      message: TType extends "agent_permission_request"
        ? DaemonPermissionRequestMessage
        : DaemonPermissionResolvedMessage,
    ) => void,
  ): () => void {
    return () => {};
  }
}

/** Scripted `PushRegistrationPort` slice this task's tests use in place of a real OS notification tray. */
function createFakePort() {
  const posted: PermissionNotificationContent[] = [];
  const cancelled: string[] = [];
  let actionHandler: ((event: PermissionNotificationActionEvent) => void) | null = null;

  const port: Pick<
    PushRegistrationPort,
    "postPermissionNotification" | "cancelPermissionNotification" | "onNotificationAction"
  > = {
    async postPermissionNotification(content) {
      posted.push(content);
    },
    async cancelPermissionNotification(requestId) {
      cancelled.push(requestId);
    },
    onNotificationAction(handler) {
      actionHandler = handler;
      return () => {
        actionHandler = null;
      };
    },
  };

  return {
    port,
    posted,
    cancelled,
    emitAction(event: PermissionNotificationActionEvent) {
      actionHandler?.(event);
    },
  };
}

function makeRequest(
  id: string,
  overrides: Partial<permissions.AgentPermissionRequest> = {},
): permissions.AgentPermissionRequest {
  return {
    id,
    provider: "pi",
    name: "write_file",
    kind: "tool",
    title: "Write src/x.ts",
    actions: [
      { id: "allow", label: "Allow", behavior: "allow" },
      { id: "deny", label: "Deny", behavior: "deny" },
    ],
    ...overrides,
  };
}

const DANGEROUS_ACTIONS: permissions.AgentPermissionAction[] = [
  { id: "allow", label: "Delete", behavior: "allow", variant: "danger" },
  { id: "deny", label: "Cancel", behavior: "deny" },
];

const THREE_WAY_ACTIONS: permissions.AgentPermissionAction[] = [
  { id: "a", label: "Option A", behavior: "allow" },
  { id: "b", label: "Option B", behavior: "allow" },
  { id: "c", label: "Cancel", behavior: "deny" },
];

function makeController(): permissions.PermissionsController {
  return new PermissionsController({ clock: new FakeClock() });
}

function outcomesOfKind(
  outcomes: PermissionNotificationOutcome[],
  kind: PermissionNotificationOutcome["kind"],
): PermissionNotificationOutcome[] {
  return outcomes.filter((outcome) => outcome.kind === kind);
}

describe("buildPermissionNotificationContent", () => {
  it("gives a binary, non-dangerous request two actions with their own verbs, never distinguished only by position", () => {
    const controller = makeController();
    const entry = controller.ingestRequest("agent-1", makeRequest("req-1"));
    const content = buildPermissionNotificationContent(entry.view);

    expect(content.actions.map((a) => a.id)).toEqual(["approve", "deny"]);
    const approve = content.actions.find((a) => a.id === "approve");
    const deny = content.actions.find((a) => a.id === "deny");
    expect(approve?.label).toBe("Approve");
    expect(deny?.label).toBe("Deny");
    // Each label carries its own verb — not shared, not empty, not a
    // generic OK/Cancel pair that would need position to disambiguate.
    expect(approve?.label).not.toBe(deny?.label);
    expect(approve?.label.toLowerCase()).toContain("approve");
    expect(deny?.label.toLowerCase()).toContain("deny");
  });

  it("never puts the tool name or detail in the lock-screen-visible publicTitle", () => {
    const controller = makeController();
    const entry = controller.ingestRequest(
      "agent-1",
      makeRequest("req-1", { title: "Delete /etc/secrets.env" }),
    );
    const content = buildPermissionNotificationContent(entry.view);
    expect(content.visibility).toBe("private");
    expect(content.publicTitle).toBe("Pi needs your permission");
    expect(content.publicTitle).not.toContain("secrets.env");
    expect(content.privateTitle).toContain("Delete /etc/secrets.env");
  });

  it("gives a dangerous binary request a tap-only notification (no action buttons)", () => {
    const controller = makeController();
    const entry = controller.ingestRequest(
      "agent-1",
      makeRequest("req-1", { actions: DANGEROUS_ACTIONS }),
    );
    const content = buildPermissionNotificationContent(entry.view);
    expect(content.actions).toEqual([]);
  });

  it("gives a multi-action (actions-row) request a tap-only notification", () => {
    const controller = makeController();
    const entry = controller.ingestRequest(
      "agent-1",
      makeRequest("req-1", { actions: THREE_WAY_ACTIONS }),
    );
    const content = buildPermissionNotificationContent(entry.view);
    expect(content.actions).toEqual([]);
  });

  it("gives an unsupported presentation (extension question) a tap-only notification with generic body", () => {
    const controller = makeController();
    const entry = controller.ingestRequest(
      "agent-1",
      makeRequest("req-1", { kind: "question", actions: [] }),
    );
    const content = buildPermissionNotificationContent(entry.view);
    expect(content.actions).toEqual([]);
    expect(content.privateBody).toBe("Open the app to respond.");
  });
});

describe("createPermissionNotificationController — refresh()", () => {
  it("posts a notification for a newly pending request and tracks it live", async () => {
    const controller = makeController();
    const { port, posted } = createFakePort();
    const notif = createPermissionNotificationController({ controller, port });

    controller.ingestRequest("agent-1", makeRequest("req-1"));
    const outcomes = await notif.refresh();

    expect(outcomesOfKind(outcomes, "posted")).toHaveLength(1);
    expect(posted).toHaveLength(1);
    expect(posted[0]?.requestId).toBe("req-1");
    expect(notif.getLiveRequestIds()).toEqual(["req-1"]);
  });

  it("does not re-post on a second refresh() with nothing new", async () => {
    const controller = makeController();
    const { port, posted } = createFakePort();
    const notif = createPermissionNotificationController({ controller, port });

    controller.ingestRequest("agent-1", makeRequest("req-1"));
    await notif.refresh();
    const second = await notif.refresh();

    expect(posted).toHaveLength(1);
    expect(second).toEqual([]);
  });

  it("cancels the notification once the controller resolves the request through any path (not just this module's own handleAction)", async () => {
    const controller = makeController();
    const { port, cancelled } = createFakePort();
    const notif = createPermissionNotificationController({ controller, port });

    controller.ingestRequest("agent-1", makeRequest("req-1"));
    await notif.refresh();
    expect(notif.getLiveRequestIds()).toEqual(["req-1"]);

    // Resolved via the in-app sheet's own path (`use-approvals-queue.ts`'s
    // `respond` calls `controller.answer` directly), not through this
    // module — proving the notification gets torn down regardless of
    // which front door resolved the request.
    controller.answer("req-1", { behavior: "deny" });
    const outcomes = await notif.refresh();

    expect(outcomesOfKind(outcomes, "cancelled")).toEqual([
      { kind: "cancelled", requestId: "req-1" },
    ]);
    expect(cancelled).toEqual(["req-1"]);
    expect(notif.getLiveRequestIds()).toEqual([]);
  });
});

describe("createPermissionNotificationController — handleAction (security)", () => {
  it("approves through the same controller.answer the in-app sheet uses, and sends via the same daemon call", async () => {
    const controller = makeController();
    const { port } = createFakePort();
    const daemon = new FakeDaemon();
    const notif = createPermissionNotificationController({ controller, port, daemon });

    controller.ingestRequest("agent-1", makeRequest("req-1"));
    await notif.refresh();

    const outcome = await notif.handleAction({
      requestId: "req-1",
      agentId: "agent-1",
      actionId: "approve",
    });

    expect(outcome).toEqual({ kind: "approved", requestId: "req-1", agentId: "agent-1" });
    expect(controller.get("req-1")?.status).toBe("answered");
    expect(controller.get("req-1")?.localResponse?.behavior).toBe("allow");
    expect(daemon.respondCalls).toEqual([
      {
        agentId: "agent-1",
        requestId: "req-1",
        response: { behavior: "allow", selectedActionId: "allow" },
      },
    ]);
  });

  it("denies through the same path, never producing an allow response for a deny action", async () => {
    const controller = makeController();
    const { port } = createFakePort();
    const daemon = new FakeDaemon();
    const notif = createPermissionNotificationController({ controller, port, daemon });

    controller.ingestRequest("agent-1", makeRequest("req-1"));
    await notif.refresh();

    const outcome = await notif.handleAction({
      requestId: "req-1",
      agentId: "agent-1",
      actionId: "deny",
    });

    expect(outcome.kind).toBe("denied");
    expect(controller.get("req-1")?.localResponse?.behavior).toBe("deny");
    expect(daemon.respondCalls[0]?.response.behavior).toBe("deny");
  });

  it("rejects an action for a request that no longer exists (never posted)", async () => {
    const controller = makeController();
    const { port } = createFakePort();
    const daemon = new FakeDaemon();
    const notif = createPermissionNotificationController({ controller, port, daemon });

    const outcome = await notif.handleAction({
      requestId: "ghost-req",
      agentId: "agent-1",
      actionId: "approve",
    });

    expect(outcome).toEqual({ kind: "unknown-request", requestId: "ghost-req" });
    expect(daemon.respondCalls).toEqual([]);
  });

  it("rejects approve/deny for a notification that only offered a tap (dangerous request) — never falls back to a default response", async () => {
    const controller = makeController();
    const { port } = createFakePort();
    const daemon = new FakeDaemon();
    const notif = createPermissionNotificationController({ controller, port, daemon });

    controller.ingestRequest("agent-1", makeRequest("req-1", { actions: DANGEROUS_ACTIONS }));
    await notif.refresh();

    const outcome = await notif.handleAction({
      requestId: "req-1",
      agentId: "agent-1",
      actionId: "approve",
    });

    expect(outcome).toEqual({ kind: "action-not-offered", requestId: "req-1" });
    // Critically: the dangerous request must still be pending, not
    // silently approved.
    expect(controller.get("req-1")?.status).toBe("pending");
    expect(daemon.respondCalls).toEqual([]);
  });

  it("rejects an action whose agentId does not match the notified request's own agent", async () => {
    const controller = makeController();
    const { port } = createFakePort();
    const daemon = new FakeDaemon();
    const notif = createPermissionNotificationController({ controller, port, daemon });

    controller.ingestRequest("agent-1", makeRequest("req-1"));
    await notif.refresh();

    const outcome = await notif.handleAction({
      requestId: "req-1",
      agentId: "agent-2", // wrong agent, same requestId
      actionId: "approve",
    });

    expect(outcome).toEqual({ kind: "agent-mismatch", requestId: "req-1" });
    expect(controller.get("req-1")?.status).toBe("pending");
    expect(daemon.respondCalls).toEqual([]);
  });

  it("resolves two notifications independently when their actions arrive out of order", async () => {
    const controller = makeController();
    const { port } = createFakePort();
    const daemon = new FakeDaemon();
    const notif = createPermissionNotificationController({ controller, port, daemon });

    controller.ingestRequest("agent-A", makeRequest("req-A"));
    controller.ingestRequest("agent-B", makeRequest("req-B"));
    await notif.refresh();
    expect(notif.getLiveRequestIds().sort()).toEqual(["req-A", "req-B"]);

    // req-B's action arrives first, denying it; req-A's arrives second, approving it.
    const outcomeB = await notif.handleAction({
      requestId: "req-B",
      agentId: "agent-B",
      actionId: "deny",
    });
    const outcomeA = await notif.handleAction({
      requestId: "req-A",
      agentId: "agent-A",
      actionId: "approve",
    });

    expect(outcomeB).toEqual({ kind: "denied", requestId: "req-B", agentId: "agent-B" });
    expect(outcomeA).toEqual({ kind: "approved", requestId: "req-A", agentId: "agent-A" });
    expect(controller.get("req-B")?.localResponse?.behavior).toBe("deny");
    expect(controller.get("req-A")?.localResponse?.behavior).toBe("allow");
    expect(daemon.respondCalls.map((c) => c.requestId)).toEqual(["req-B", "req-A"]);
  });

  it("a stale notification cannot approve a request already resolved in-app — the race", async () => {
    const controller = makeController();
    const { port } = createFakePort();
    const daemon = new FakeDaemon();
    const notif = createPermissionNotificationController({ controller, port, daemon });

    controller.ingestRequest("agent-1", makeRequest("req-1"));
    await notif.refresh();

    // The in-app sheet resolves it first — same call
    // `use-approvals-queue.ts`'s `respond` makes, denying it and
    // sending to the daemon.
    const wire = controller.answer("req-1", { behavior: "deny" });
    expect(wire).not.toBeNull();
    if (wire) {
      await daemon.respondToPermission(wire.agentId, wire.requestId, wire.response);
    }
    expect(daemon.respondCalls).toHaveLength(1);

    // The stale notification's Approve action arrives after the race
    // is already lost.
    const outcome = await notif.handleAction({
      requestId: "req-1",
      agentId: "agent-1",
      actionId: "approve",
    });

    expect(outcome).toEqual({ kind: "already-resolved", requestId: "req-1" });
    // No second send, and the resolved answer is still the deny that won.
    expect(daemon.respondCalls).toHaveLength(1);
    expect(controller.get("req-1")?.localResponse?.behavior).toBe("deny");
  });

  it("a stale notification cannot approve a request the daemon already resolved out from under it", async () => {
    const controller = makeController();
    const { port } = createFakePort();
    const daemon = new FakeDaemon();
    const notif = createPermissionNotificationController({ controller, port, daemon });

    controller.ingestRequest("agent-1", makeRequest("req-1"));
    await notif.refresh();

    // A daemon-confirmed resolution (e.g. another client answered, or
    // the request was withdrawn) always wins over local state.
    controller.applyResolution("agent-1", "req-1", { behavior: "deny", message: "withdrawn" });

    const outcome = await notif.handleAction({
      requestId: "req-1",
      agentId: "agent-1",
      actionId: "approve",
    });

    expect(outcome).toEqual({ kind: "already-resolved", requestId: "req-1" });
    expect(daemon.respondCalls).toEqual([]);
  });

  it("routes a tap on a still-pending request to its approval surface", async () => {
    const controller = makeController();
    const { port } = createFakePort();
    const notif = createPermissionNotificationController({ controller, port });

    controller.ingestRequest("agent-1", makeRequest("req-1"));
    await notif.refresh();

    const outcome = await notif.handleAction({
      requestId: "req-1",
      agentId: "agent-1",
      actionId: "tap",
    });

    expect(outcome).toEqual({ kind: "route-to-approval", requestId: "req-1", agentId: "agent-1" });
  });

  it("routes a tap on an already-resolved request to the session, not a stale approval screen", async () => {
    const controller = makeController();
    const { port } = createFakePort();
    const notif = createPermissionNotificationController({ controller, port });

    controller.ingestRequest("agent-1", makeRequest("req-1"));
    await notif.refresh();
    controller.answer("req-1", { behavior: "deny" });

    const outcome = await notif.handleAction({
      requestId: "req-1",
      agentId: "agent-1",
      actionId: "tap",
    });

    expect(outcome).toEqual({ kind: "route-to-session", agentId: "agent-1" });
  });
});

describe("createPermissionNotificationController — start() wiring", () => {
  it("auto-posts on queue changes and auto-handles port actions, and stops doing either after its dispose function runs", async () => {
    const controller = makeController();
    const { port, posted, emitAction } = createFakePort();
    const daemon = new FakeDaemon();
    const notif = createPermissionNotificationController({ controller, port, daemon });

    const dispose = notif.start();
    controller.ingestRequest("agent-1", makeRequest("req-1"));
    // `refresh()` runs fire-and-forget off `controller.subscribe`; awaiting
    // a microtask flush lets it settle before asserting.
    await Promise.resolve();
    await Promise.resolve();
    expect(posted).toHaveLength(1);

    emitAction({ requestId: "req-1", agentId: "agent-1", actionId: "approve" });
    await Promise.resolve();
    await Promise.resolve();
    expect(daemon.respondCalls).toHaveLength(1);

    dispose();
    controller.ingestRequest("agent-1", makeRequest("req-2"));
    await Promise.resolve();
    await Promise.resolve();
    expect(posted).toHaveLength(1); // no second post after dispose

    emitAction({ requestId: "req-2", agentId: "agent-1", actionId: "approve" });
    await Promise.resolve();
    expect(daemon.respondCalls).toHaveLength(1); // no second send after dispose
  });
});

describe("createPermissionNotificationController — sensitive content never logs", () => {
  const consoleSpies: Array<ReturnType<typeof vi.spyOn>> = [];

  beforeEach(() => {
    for (const method of ["log", "info", "warn", "error", "debug"] as const) {
      consoleSpies.push(vi.spyOn(console, method).mockImplementation(() => {}));
    }
  });

  afterEach(() => {
    for (const spy of consoleSpies) spy.mockRestore();
    consoleSpies.length = 0;
  });

  it("never calls any console method across post -> action -> race", async () => {
    const controller = makeController();
    const { port } = createFakePort();
    const daemon = new FakeDaemon();
    const notif = createPermissionNotificationController({ controller, port, daemon });

    controller.ingestRequest("agent-1", makeRequest("req-1", { title: "rm -rf /secret-project" }));
    await notif.refresh();
    controller.answer("req-1", { behavior: "deny" });
    await notif.handleAction({ requestId: "req-1", agentId: "agent-1", actionId: "approve" });
    await notif.handleAction({ requestId: "unknown", agentId: "agent-1", actionId: "deny" });

    for (const spy of consoleSpies) {
      expect(spy).not.toHaveBeenCalled();
    }
  });
});
