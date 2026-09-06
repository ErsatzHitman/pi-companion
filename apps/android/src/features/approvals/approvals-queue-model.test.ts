import { describe, expect, it } from "vitest";

import { permissions } from "@picompanion/frontend-core";

import {
  describeWaitingCount,
  getApprovalsQueueSnapshot,
  isDangerousRequest,
  resolveApprovalPanel,
} from "./approvals-queue-model.js";

/**
 * T33B5 acceptance criterion 1 ("a permission request can be approved
 * and denied in-app") and criterion 2 ("the decision round-trips and
 * the turn continues", including the withdrawn case). Criterion 3
 * (keyboard ownership) is proved separately in
 * `approvals-sheet-focus.test.ts` against T33B4's `resolveFocusOwner`.
 *
 * These tests drive the real, unowned `permissions.PermissionsController`
 * (`packages/frontend-core/src/permissions/`) directly rather than a
 * fake — the same choice `use-approvals-queue.test.ts` makes on web —
 * so nothing here re-derives or re-guesses that controller's own
 * pending/answered/timeout state machine; it only proves this module's
 * own panel/queue projections over it. `permissions.test.ts` already
 * proves the timeout path (`defaultTimeoutMs`); that is not duplicated
 * here.
 */

function toolRequest(
  id: string,
  overrides?: Partial<permissions.AgentPermissionRequest>,
): permissions.AgentPermissionRequest {
  return {
    id,
    provider: "pi",
    name: "bash",
    kind: "tool",
    title: `Run ${id}`,
    actions: [
      { id: "allow", label: "Allow", behavior: "allow", variant: "primary" },
      { id: "deny", label: "Deny", behavior: "deny", variant: "secondary" },
    ],
    ...overrides,
  };
}

function dangerousToolRequest(id: string): permissions.AgentPermissionRequest {
  return toolRequest(id, {
    name: "bash",
    title: "rm -rf ./build",
    actions: [
      { id: "allow", label: "Run it", behavior: "allow", variant: "primary" },
      { id: "deny", label: "Don't run it", behavior: "deny", variant: "danger" },
    ],
  });
}

function threeWayToolRequest(id: string): permissions.AgentPermissionRequest {
  return toolRequest(id, {
    actions: [
      { id: "always", label: "Always allow", behavior: "allow", variant: "primary" },
      { id: "once", label: "Allow once", behavior: "allow", variant: "secondary" },
      { id: "deny", label: "Deny", behavior: "deny", variant: "secondary" },
    ],
  });
}

function selectDialogRequest(id: string): permissions.AgentPermissionRequest {
  return {
    id,
    provider: "pi",
    name: "ask_user_selection",
    kind: "question",
    title: "Pick a branch",
    metadata: { extensionUiMethod: "select" },
    input: {
      questions: [
        {
          question: "Which branch?",
          header: "branch",
          options: [{ label: "main" }],
          multiSelect: false,
        },
      ],
    },
  };
}

function makeController() {
  return new permissions.PermissionsController({ clock: new FakeNowClock() });
}

class FakeNowClock {
  private ms = 0;
  now(): number {
    return this.ms;
  }
  advance(delta: number): void {
    this.ms += delta;
  }
  setTimeout(): never {
    throw new Error("not needed by these tests");
  }
  clearTimeout(): void {}
  setInterval(): never {
    throw new Error("not needed by these tests");
  }
  clearInterval(): void {}
}

describe("getApprovalsQueueSnapshot", () => {
  it("is empty with no pending requests", () => {
    const controller = makeController();
    expect(getApprovalsQueueSnapshot(controller)).toEqual({ current: null, waitingCount: 0 });
  });

  it("surfaces the oldest pending request as current, the rest as waitingCount", () => {
    const controller = makeController();
    controller.ingestRequest("agt_1", toolRequest("perm_1"));
    controller.ingestRequest("agt_1", toolRequest("perm_2"));
    controller.ingestRequest("agt_1", toolRequest("perm_3"));

    const snapshot = getApprovalsQueueSnapshot(controller);
    expect(snapshot.current?.requestId).toBe("perm_1");
    expect(snapshot.waitingCount).toBe(2);
  });

  it("scopes to sessionId when given", () => {
    const controller = makeController();
    controller.ingestRequest("agt_other", toolRequest("perm_other"));
    controller.ingestRequest("agt_mine", toolRequest("perm_mine"));

    const snapshot = getApprovalsQueueSnapshot(controller, "agt_mine");
    expect(snapshot.current?.requestId).toBe("perm_mine");
    expect(snapshot.waitingCount).toBe(0);
  });
});

describe("resolveApprovalPanel", () => {
  it("renders a plain tool request with no offered actions as a non-dangerous binary panel", () => {
    const controller = makeController();
    const entry = controller.ingestRequest("agt_1", toolRequest("perm_1", { actions: [] }));
    const panel = resolveApprovalPanel(entry.view);
    if (panel.kind !== "binary") throw new Error("expected a binary panel");
    expect(panel.dangerous).toBe(false);
    expect(panel.approveResponse).toEqual({ behavior: "allow" });
    expect(panel.denyResponse.behavior).toBe("deny");
  });

  it("renders a two-action allow/deny request as a binary panel using the daemon's own action ids", () => {
    const controller = makeController();
    const entry = controller.ingestRequest("agt_1", toolRequest("perm_1"));
    const panel = resolveApprovalPanel(entry.view);
    if (panel.kind !== "binary") throw new Error("expected a binary panel");
    expect(panel.dangerous).toBe(false);
    expect(panel.approveResponse).toEqual({ behavior: "allow", selectedActionId: "allow" });
    expect(panel.denyResponse).toEqual({ behavior: "deny", selectedActionId: "deny" });
  });

  it('flags a request dangerous when any offered action carries variant "danger"', () => {
    const controller = makeController();
    const entry = controller.ingestRequest("agt_1", dangerousToolRequest("perm_danger"));
    expect(isDangerousRequest(entry.view.actions)).toBe(true);
    const panel = resolveApprovalPanel(entry.view);
    if (panel.kind !== "binary") throw new Error("expected a binary panel");
    expect(panel.dangerous).toBe(true);
    expect(panel.closeResponse).toEqual(panel.denyResponse);
  });

  it("falls back to an actions-row panel for a three-way request ApprovalForm's fixed pair cannot represent, ordering deny first", () => {
    const controller = makeController();
    const entry = controller.ingestRequest("agt_1", threeWayToolRequest("perm_3way"));
    const panel = resolveApprovalPanel(entry.view);
    if (panel.kind !== "actions-row") throw new Error("expected an actions-row panel");
    expect(panel.actions.map((a) => a.action.id)).toEqual(["deny", "always", "once"]);
    expect(panel.closeResponse).toEqual({ behavior: "deny", selectedActionId: "deny" });
  });

  it("reports a non-tool-actions presentation (e.g. a select dialog) as unsupported, but still closeable with a deny/cancel response", () => {
    const controller = makeController();
    const entry = controller.ingestRequest("agt_1", selectDialogRequest("perm_select"));
    expect(entry.view.presentation).toBe("select");
    const panel = resolveApprovalPanel(entry.view);
    expect(panel.kind).toBe("unsupported");
    expect(panel.closeResponse.behavior).toBe("deny");
  });
});

describe("describeWaitingCount", () => {
  it("is null for zero", () => {
    expect(describeWaitingCount(0)).toBeNull();
  });
  it("is singular for one", () => {
    expect(describeWaitingCount(1)).toBe("1 more request is waiting.");
  });
  it("is plural for more than one", () => {
    expect(describeWaitingCount(3)).toBe("3 more requests are waiting.");
  });
});

describe("the full state machine: requested -> pending decision -> approved / denied / withdrawn", () => {
  it("approved: answering with the binary panel's approveResponse resolves the request and advances the queue", () => {
    const controller = makeController();
    controller.ingestRequest("agt_1", toolRequest("perm_1"));
    controller.ingestRequest("agt_1", toolRequest("perm_2"));

    const before = getApprovalsQueueSnapshot(controller);
    if (!before.current) throw new Error("expected a current request");
    const panel = resolveApprovalPanel(before.current);
    if (panel.kind !== "binary") throw new Error("expected a binary panel");

    const wireMessage = controller.answer(before.current.requestId, panel.approveResponse);
    expect(wireMessage).toEqual({
      type: "agent_permission_response",
      agentId: "agt_1",
      requestId: "perm_1",
      response: { behavior: "allow", selectedActionId: "allow" },
    });
    expect(controller.get("perm_1")?.status).toBe("answered");
    expect(controller.get("perm_1")?.localResponse).toEqual(panel.approveResponse);

    // The turn continues: the next queued request is now current.
    const after = getApprovalsQueueSnapshot(controller);
    expect(after.current?.requestId).toBe("perm_2");
    expect(after.waitingCount).toBe(0);
  });

  it("denied: answering with the binary panel's denyResponse resolves the request as denied, not stranded, and the queue advances", () => {
    const controller = makeController();
    controller.ingestRequest("agt_1", toolRequest("perm_1"));
    controller.ingestRequest("agt_1", toolRequest("perm_2"));

    const before = getApprovalsQueueSnapshot(controller);
    if (!before.current) throw new Error("expected a current request");
    const panel = resolveApprovalPanel(before.current);
    if (panel.kind !== "binary") throw new Error("expected a binary panel");

    controller.answer(before.current.requestId, panel.denyResponse);
    expect(controller.get("perm_1")?.status).toBe("answered");
    expect(controller.get("perm_1")?.localResponse?.behavior).toBe("deny");

    const after = getApprovalsQueueSnapshot(controller);
    expect(after.current?.requestId).toBe("perm_2");
  });

  it("withdrawn: a daemon resolution that arrives before this client ever answers locally still resolves the request and advances the queue — the case that gets skipped", () => {
    const controller = makeController();
    controller.ingestRequest("agt_1", toolRequest("perm_1"));
    controller.ingestRequest("agt_1", toolRequest("perm_2"));

    const before = getApprovalsQueueSnapshot(controller);
    expect(before.current?.requestId).toBe("perm_1");

    // Nothing local ever answers perm_1 — it is withdrawn/superseded
    // from elsewhere (plan.md §12.3's "single-answer semantics": another
    // connected client answered it, or the daemon withdrew it) before
    // this client's user acts on it.
    controller.applyResolution("agt_1", "perm_1", {
      behavior: "deny",
      message: "Withdrawn before this client answered",
    });

    const entry = controller.get("perm_1");
    expect(entry?.status).toBe("answered");
    expect(entry?.localResponse).toBeUndefined(); // proves this client never answered it itself
    expect(entry?.resolution).toEqual({
      behavior: "deny",
      message: "Withdrawn before this client answered",
    });

    // The turn continues: perm_1 is gone from the pending queue and
    // perm_2 is now current, with no user action required to unstick it.
    const after = getApprovalsQueueSnapshot(controller);
    expect(after.current?.requestId).toBe("perm_2");
    expect(after.waitingCount).toBe(0);

    // A stale local answer attempt on the withdrawn request is inert,
    // never a throw or a duplicate send (mirrors
    // `PermissionsController.answer`'s own "already answered" contract).
    expect(controller.answer("perm_1", { behavior: "allow" })).toBeNull();
  });

  it("withdrawn while it is the only pending request empties the queue entirely", () => {
    const controller = makeController();
    controller.ingestRequest("agt_1", toolRequest("perm_only"));
    expect(getApprovalsQueueSnapshot(controller).current?.requestId).toBe("perm_only");

    controller.applyResolution("agt_1", "perm_only", { behavior: "deny", interrupt: true });

    expect(getApprovalsQueueSnapshot(controller)).toEqual({ current: null, waitingCount: 0 });
  });
});
