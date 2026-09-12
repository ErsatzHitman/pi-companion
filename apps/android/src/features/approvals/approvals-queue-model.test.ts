import { describe, expect, it } from "vitest";

import { permissions } from "@picompanion/frontend-core";

import {
  describeWaitingCount,
  getApprovalsQueueSnapshot,
  isDangerousRequest,
  resolveApprovalPanel,
  resolveConfirmApprovalPanel,
  resolveQuestionApprovalPanel,
} from "./approvals-queue-model.js";
import { buildQuestionSubmitResponse, initialQuestionValues } from "./approvals-question-model.js";

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

/** A plain `input` extension dialog (`Pi input` + one free-text question), the shape `vision-proxy`/`pi-goal` send. */
function inputDialogRequest(id: string): permissions.AgentPermissionRequest {
  return {
    id,
    provider: "pi",
    name: "Pi input",
    kind: "question",
    title: "Which file?",
    metadata: { extensionUiMethod: "input" },
    input: {
      questions: [
        {
          question: "Which file?",
          header: "response",
          options: [],
          multiSelect: false,
          placeholder: "src/x.ts",
        },
      ],
    },
  };
}

/** An `editor` extension dialog (multi-line field), the shape `pi-goal`'s draft wizard sends. */
function editorDialogRequest(id: string): permissions.AgentPermissionRequest {
  return {
    id,
    provider: "pi",
    name: "Pi editor",
    kind: "question",
    title: "Draft the goal",
    metadata: { extensionUiMethod: "editor" },
    input: {
      questions: [
        { question: "Draft the goal", header: "response", options: [], multiSelect: false },
      ],
    },
  };
}

/**
 * A generic (`kind: "question"`, no recognized `extensionUiMethod`)
 * request that still carries a real question — the fallback
 * `presentation: "question"` renders.
 */
function genericQuestionRequest(id: string): permissions.AgentPermissionRequest {
  return {
    id,
    provider: "pi",
    name: "Scripted question",
    kind: "question",
    title: "Proceed with the run?",
    input: {
      questions: [
        { question: "Proceed with the run?", header: "response", options: [], multiSelect: false },
      ],
    },
  };
}

/** A `question`-kind request that asks nothing at all — the one shape that still gets the Dismiss-only fallback. */
function questionslessQuestionRequest(id: string): permissions.AgentPermissionRequest {
  return { id, provider: "pi", name: "Mystery question", kind: "question", title: "Mystery" };
}

/** The exact shape the daemon's Pi provider builds for a `confirm` `extension_ui_request` (`agent.ts`: one question, `Yes`/`No`). */
function confirmDialogRequest(
  id: string,
  options: { labels?: string[]; header?: string } = {},
): permissions.AgentPermissionRequest {
  return {
    id,
    provider: "pi",
    name: "Scripted extension confirm",
    kind: "question",
    title: "Run a shell command?\n\nThe scripted extension wants to run `echo hello`.",
    metadata: { extensionUiMethod: "confirm" },
    input: {
      questions: [
        {
          question: "Run a shell command?\n\nThe scripted extension wants to run `echo hello`.",
          header: options.header ?? "response",
          options: (options.labels ?? ["Yes", "No"]).map((label) => ({ label })),
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

  it("T341: renders a confirm extension dialog as a binary panel whose Approve answers the daemon's own yes option and whose Deny/close is the deny response", () => {
    const controller = makeController();
    const entry = controller.ingestRequest("agt_1", confirmDialogRequest("perm_confirm"));
    expect(entry.view.presentation).toBe("confirm");
    const panel = resolveApprovalPanel(entry.view);
    if (panel.kind !== "binary") throw new Error("expected a binary panel");
    expect(panel.toolLabel).toBe(entry.view.title);
    expect(panel.detail).toBe(entry.view.questions[0]?.question);
    expect(panel.dangerous).toBe(false);
    expect(panel.approveResponse).toEqual({
      behavior: "allow",
      updatedInput: { answers: { response: "Yes" } },
    });
    expect(panel.denyResponse).toEqual({ behavior: "deny" });
    expect(panel.closeResponse).toEqual(panel.denyResponse);
  });

  it("T341: picks the yes-shaped option by its label, whatever the order or case, keyed by the question's own header", () => {
    const controller = makeController();
    const entry = controller.ingestRequest(
      "agt_1",
      confirmDialogRequest("perm_confirm_2", { labels: ["No", "YES"], header: "answer" }),
    );
    const panel = resolveConfirmApprovalPanel(entry.view);
    expect(panel.approveResponse).toEqual({
      behavior: "allow",
      updatedInput: { answers: { answer: "YES" } },
    });
  });

  it("T341: falls back to the literal the provider matches on when no offered option is yes-shaped", () => {
    const controller = makeController();
    const entry = controller.ingestRequest(
      "agt_1",
      confirmDialogRequest("perm_confirm_3", { labels: ["Proceed", "Stop"] }),
    );
    const panel = resolveConfirmApprovalPanel(entry.view);
    expect(panel.approveResponse).toEqual({
      behavior: "allow",
      updatedInput: { answers: { response: "Yes" } },
    });
  });

  it("resolves a select dialog into a real question panel carrying the daemon's own question and deny path", () => {
    const controller = makeController();
    const entry = controller.ingestRequest("agt_1", selectDialogRequest("perm_select"));
    expect(entry.view.presentation).toBe("select");
    const panel = resolveApprovalPanel(entry.view);
    if (panel.kind !== "question") throw new Error("expected a question panel");
    expect(panel.presentation).toBe("select");
    expect(panel.toolLabel).toBe("Pick a branch");
    expect(panel.questions).toEqual(entry.view.questions);
    expect(panel.dismissLabel).toBe("Cancel");
    expect(panel.denyResponse).toEqual({ behavior: "deny" });
    expect(panel.closeResponse).toEqual(panel.denyResponse);
  });

  it("resolves input, editor and generic question presentations into question panels too — no presentation kind is left unrenderable", () => {
    const controller = makeController();
    const requests = [
      inputDialogRequest("perm_input"),
      editorDialogRequest("perm_editor"),
      genericQuestionRequest("perm_generic"),
    ];
    const expected = ["input", "editor", "question"];
    for (const [index, request] of requests.entries()) {
      const entry = controller.ingestRequest("agt_1", request);
      expect(entry.view.presentation).toBe(expected[index]);
      const panel = resolveApprovalPanel(entry.view);
      if (panel.kind !== "question") throw new Error("expected a question panel");
      expect(panel.questions).toEqual(entry.view.questions);
    }
  });

  it("honours the daemon's own dismissLabel (the input method's optional placeholder relabels it Skip), not a fixed label", () => {
    const controller = makeController();
    const request = inputDialogRequest("perm_skip");
    request.input = {
      questions: [
        {
          question: "Optional note?",
          header: "response",
          options: [],
          multiSelect: false,
          allowEmpty: true,
          dismissLabel: "Skip",
        },
      ],
    };
    const entry = controller.ingestRequest("agt_1", request);
    const panel = resolveQuestionApprovalPanel(entry.view);
    expect(panel.dismissLabel).toBe("Skip");
  });

  it("keeps the Dismiss-only fallback for a question-kind request that asks nothing at all, still closeable with a deny/cancel response", () => {
    const controller = makeController();
    const entry = controller.ingestRequest("agt_1", questionslessQuestionRequest("perm_empty"));
    expect(entry.view.presentation).toBe("question");
    expect(entry.view.questions).toEqual([]);
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

  it("answered (question): a select panel's Submit resolves the request with the choice keyed by the question's own header, and the queue advances", () => {
    const controller = makeController();
    controller.ingestRequest("agt_1", selectDialogRequest("perm_select"));
    controller.ingestRequest("agt_1", toolRequest("perm_next"));

    const before = getApprovalsQueueSnapshot(controller);
    if (!before.current) throw new Error("expected a current request");
    const panel = resolveApprovalPanel(before.current);
    if (panel.kind !== "question") throw new Error("expected a question panel");

    const response = buildQuestionSubmitResponse(panel.questions, {
      ...initialQuestionValues(panel.questions),
      branch: "main",
    });
    expect(response).toEqual({
      behavior: "allow",
      updatedInput: { answers: { branch: "main" } },
    });

    const wireMessage = controller.answer(before.current.requestId, response);
    expect(wireMessage).toMatchObject({
      type: "agent_permission_response",
      agentId: "agt_1",
      requestId: "perm_select",
      response: { behavior: "allow" },
    });
    expect(controller.get("perm_select")?.status).toBe("answered");
    expect(controller.get("perm_select")?.localResponse).toEqual(response);

    const after = getApprovalsQueueSnapshot(controller);
    expect(after.current?.requestId).toBe("perm_next");
    expect(after.waitingCount).toBe(0);
  });

  it("denied (question): a question panel's dismiss response resolves the request as denied and the queue advances", () => {
    const controller = makeController();
    controller.ingestRequest("agt_1", genericQuestionRequest("perm_generic"));
    controller.ingestRequest("agt_1", toolRequest("perm_next"));

    const before = getApprovalsQueueSnapshot(controller);
    if (!before.current) throw new Error("expected a current request");
    const panel = resolveApprovalPanel(before.current);
    if (panel.kind !== "question") throw new Error("expected a question panel");

    controller.answer(before.current.requestId, panel.denyResponse);
    expect(controller.get("perm_generic")?.status).toBe("answered");
    expect(controller.get("perm_generic")?.localResponse?.behavior).toBe("deny");
    expect(getApprovalsQueueSnapshot(controller).current?.requestId).toBe("perm_next");
  });
});
