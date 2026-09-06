/**
 * T37E4 — proves every testId/label `../../maestro/notification-
 * approval.yaml` names for its in-app approval half still exists in
 * the real source it targets, and encodes T36B's security model
 * (`../../src/features/notifications/permission-notification-model.ts`)
 * against real, in-memory fakes — the flow's only proof today, since
 * there is no emulator, device, or Maestro binary in this wave (see
 * that flow file's own header comment).
 *
 * Two proof strategies, chosen per module, same split
 * `pairing.contract.test.ts` documents:
 *
 * - `permission-notification-model.ts` is RN-free, so this file imports
 *   it directly and drives the real `createPermissionNotificationController`
 *   against scripted fakes — no source-text match needed for that half.
 * - `ApprovalsContainer.tsx`/`ApprovalsHost.tsx`/`ApprovalForm.tsx`/
 *   `Button.tsx` all reach `react-native` and cannot be imported under
 *   this workspace's plain vitest (`CLAUDE.md`'s "VITEST LIMITATION"
 *   note), so those are proven with `readCode()`/`readComponentCode()` —
 *   comment-stripped source matched against a full JSX/prop expression,
 *   never a bare identifier (`CLAUDE.md`'s "SOURCE-TEXT REGEX TESTS ARE
 *   ON PROBATION" note). `SessionApprovals`'s own mount of
 *   `ApprovalsContainer` (`app/h/[serverId]/session/[agentId]/index.tsx`)
 *   is already proven by that file's own
 *   `index.test.ts` ("mounts `<SessionApprovals sessionId={agentId ??
 *   ""} />`" and its `hapticsEnabled` cases) — this file does not
 *   duplicate that; it starts one level down, at what `ApprovalsContainer`
 *   itself renders.
 *
 * Mutation-checked: see the wave report for the exact mutation, its
 * failure, and the byte-identical restore.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { permissions } from "@picompanion/frontend-core";

import {
  buildPermissionNotificationContent,
  createPermissionNotificationController,
} from "../../src/features/notifications/permission-notification-model.js";
import type {
  PermissionNotificationActionEvent,
  PermissionNotificationContent,
  PushRegistrationPort,
} from "../../src/features/notifications/push-registration-port.js";
import { FakeClock } from "../../src/features/approvals/test-doubles.js";

import { NOTIFICATION_APPROVAL_FLOW } from "./notification-approval-contract.js";

const { PermissionsController } = permissions;

function readSource(relativePath: string): string {
  return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");
}

function readCode(relativePath: string): string {
  return readSource(relativePath)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");
}

/** `readCode()` sliced to a single top-level function's body — same helper `index.test.ts` documents, needed here for `Button.tsx`'s `Button` (the file also exports a `createStyles` helper the bare `readCode()` match would also happily match inside). */
function readFunctionCode(relativePath: string, name: string): string {
  const code = readCode(relativePath);
  const body = code
    .split(/^export function /m)
    .map((part) => `export function ${part}`)
    .find((part) => part.startsWith(`export function ${name}(`));
  expect(body, `${relativePath} should declare an exported function ${name}`).toBeDefined();
  return body ?? "";
}

// ---------------------------------------------------------------------
// In-app approval half: testId/label wiring `notification-approval.yaml`
// drives (below `SessionApprovals`, already proven by index.test.ts).
// ---------------------------------------------------------------------

describe("approvals sheet source (in-app approval half)", () => {
  it('ApprovalsContainer mounts ApprovalsHost with the fixed testId="approvals-dialog" the flow anchors on', () => {
    const code = readCode("../../src/features/approvals/ApprovalsContainer.tsx");
    expect(code).toMatch(
      /<ApprovalsHost\s+current=\{queue\.current\}[\s\S]{0,300}?testId="approvals-dialog"\s*\/>/,
    );
    expect(NOTIFICATION_APPROVAL_FLOW.sheetTestId).toBe("approvals-dialog");
  });

  it('ApprovalsHost falls testId through to Sheet, with the fixed title="Approval needed" the flow asserts', () => {
    const code = readCode("../../src/features/approvals/ApprovalsHost.tsx");
    expect(code).toMatch(/const sheetTestId = testId \?\? "approvals-sheet";/);
    expect(code).toMatch(
      /<Sheet\s+open=\{open\}\s+title="Approval needed"\s+description="Pi needs your decision to continue\."\s+onClose=\{[\s\S]{0,80}?\}\s+testId=\{sheetTestId\}/,
    );
    expect(NOTIFICATION_APPROVAL_FLOW.sheetTitle).toBe("Approval needed");
  });

  it("ApprovalsHost mounts ApprovalForm for a binary panel under `${sheetTestId}-form`, wiring Approve/Deny to onAnswer with the panel's own responses", () => {
    const code = readCode("../../src/features/approvals/ApprovalsHost.tsx");
    expect(code).toMatch(
      /<ApprovalForm\s+toolLabel=\{panel\.toolLabel\}\s+detail=\{panel\.detail\}\s+dangerous=\{panel\.dangerous\}\s+onApprove=\{\(\) => onAnswer\(panel\.approveResponse\)\}\s+onDeny=\{\(\) => onAnswer\(panel\.denyResponse\)\}\s+testId=\{`\$\{sheetTestId\}-form`\}/,
    );
    expect(NOTIFICATION_APPROVAL_FLOW.formTestId).toBe("approvals-dialog-form");
  });

  it("ApprovalForm renders Deny and Approve as two distinct Button testIds/labels — never a single combined action", () => {
    const code = readCode("../../src/ui/recipes/ApprovalForm.tsx");
    expect(code).toMatch(
      /<Button\s+kind="secondary"\s+label="Deny"\s+onPress=\{onDeny\}\s+testId=\{testId \? `\$\{testId\}-deny` : undefined\}/,
    );
    expect(code).toMatch(
      /<Button\s+kind=\{dangerous \? "danger" : "primary"\}\s+label="Approve"\s+onPress=\{onApprove\}\s+testId=\{testId \? `\$\{testId\}-approve` : undefined\}/,
    );
    expect(NOTIFICATION_APPROVAL_FLOW.denyButton).toBe("approvals-dialog-form-deny");
    expect(NOTIFICATION_APPROVAL_FLOW.approveButton).toBe("approvals-dialog-form-approve");
  });

  it("Button sets accessibilityLabel to its own label unconditionally, so Deny and Approve carry distinct accessible labels — the same property T36B's notification actions rely on (see the security-model describe block below)", () => {
    const body = readFunctionCode("../../src/ui/primitives/Button.tsx", "Button");
    expect(body).toMatch(/accessibilityLabel=\{label\}/);
    expect(NOTIFICATION_APPROVAL_FLOW.denyLabel).toBe("Deny");
    expect(NOTIFICATION_APPROVAL_FLOW.approveLabel).toBe("Approve");
    expect(NOTIFICATION_APPROVAL_FLOW.denyLabel).not.toBe(NOTIFICATION_APPROVAL_FLOW.approveLabel);
  });
});

// ---------------------------------------------------------------------
// T36B's security model, encoded directly against the real, RN-free
// permission-notification-model.ts — this is the flow's proof for
// everything the notification half cannot run yet to demonstrate live.
// ---------------------------------------------------------------------

/** Minimal scripted `PushRegistrationPort` slice — records every post/cancel and lets the test fire actions through `onNotificationAction`'s registered handler directly, exactly the "in-memory fake, never a real socket/OS" standard this wave requires. */
function createFakePort(): Pick<
  PushRegistrationPort,
  "postPermissionNotification" | "cancelPermissionNotification" | "onNotificationAction"
> & {
  fireAction: (event: PermissionNotificationActionEvent) => void;
  posted: PermissionNotificationContent[];
  cancelled: string[];
} {
  const posted: PermissionNotificationContent[] = [];
  const cancelled: string[] = [];
  let handler: ((event: PermissionNotificationActionEvent) => void) | undefined;
  return {
    posted,
    cancelled,
    async postPermissionNotification(content) {
      posted.push(content);
    },
    async cancelPermissionNotification(requestId) {
      cancelled.push(requestId);
    },
    onNotificationAction(onAction) {
      handler = onAction;
      return () => {
        handler = undefined;
      };
    },
    fireAction(event) {
      handler?.(event);
    },
  };
}

/**
 * Same shape `approvals-queue-model.test.ts`'s own `toolRequest()`
 * fixture uses — a real `"tool"`-kind request with a binary allow/deny
 * action pair, so `resolveApprovalPanel` reports it as `"binary"` and
 * `contentForPanel` gives it real Approve/Deny actions (never the
 * tap-only path).
 */
function buildAgentRequest(id: string): permissions.AgentPermissionRequest {
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
  };
}

describe("T36B security model, encoded for the flow that cannot run yet", () => {
  it("a posted notification's content carries Approve and Deny as two distinct actions with distinct labels — buildPermissionNotificationContent, not a Maestro assumption", () => {
    const controller = new PermissionsController({ clock: new FakeClock() });
    controller.ingestRequest("agent-1", buildAgentRequest("req-1"));
    const view = controller.list()[0]!.view;
    const content = buildPermissionNotificationContent(view);
    expect(content.actions).toEqual([
      { id: "approve", label: NOTIFICATION_APPROVAL_FLOW.approveLabel },
      { id: "deny", label: NOTIFICATION_APPROVAL_FLOW.denyLabel },
    ]);
  });

  it("an approve action carries the requestId it was posted for, and the handler answers the live queue entry for exactly that id — not a default/most-recent request", () => {
    const controller = new PermissionsController({ clock: new FakeClock() });
    const port = createFakePort();
    const outcomes: string[] = [];
    const ctrl = createPermissionNotificationController({
      controller,
      port,
      onOutcome: (o) => outcomes.push(o.kind),
    });

    controller.ingestRequest("agent-1", buildAgentRequest("req-1"));
    controller.ingestRequest("agent-1", buildAgentRequest("req-2"));

    return ctrl.refresh().then(async () => {
      expect(ctrl.getLiveRequestIds().sort()).toEqual(["req-1", "req-2"]);

      const outcome = await ctrl.handleAction({
        requestId: "req-2",
        agentId: "agent-1",
        actionId: "approve",
      });
      expect(outcome).toEqual({ kind: "approved", requestId: "req-2", agentId: "agent-1" });
      // req-1 must still be pending — the action named req-2 and only req-2 was answered.
      expect(controller.get("req-1")?.status).toBe("pending");
      expect(controller.get("req-2")?.status).not.toBe("pending");
    });
  });

  it("a post-resolution action is the named no-op 'already-resolved' — never silently dropped, never re-sent", async () => {
    const controller = new PermissionsController({ clock: new FakeClock() });
    const port = createFakePort();
    const ctrl = createPermissionNotificationController({ controller, port });

    controller.ingestRequest("agent-1", buildAgentRequest("req-3"));
    await ctrl.refresh();

    // The daemon resolves it out-of-band (e.g. answered from the in-app
    // sheet instead) before the notification action arrives.
    controller.applyResolution("agent-1", "req-3", {
      behavior: "allow",
      selectedActionId: "allow",
    });

    const outcome = await ctrl.handleAction({
      requestId: "req-3",
      agentId: "agent-1",
      actionId: "approve",
    });
    expect(outcome).toEqual({ kind: "already-resolved", requestId: "req-3" });
    // And the notification is cancelled as a result, not left live.
    expect(port.cancelled).toContain("req-3");
  });

  it("an action for an agentId that does not match what the notification was posted for is rejected as 'agent-mismatch', never trusted from the event alone", async () => {
    const controller = new PermissionsController({ clock: new FakeClock() });
    const port = createFakePort();
    const ctrl = createPermissionNotificationController({ controller, port });

    controller.ingestRequest("agent-1", buildAgentRequest("req-4"));
    await ctrl.refresh();

    const outcome = await ctrl.handleAction({
      requestId: "req-4",
      agentId: "agent-attacker",
      actionId: "approve",
    });
    expect(outcome).toEqual({ kind: "agent-mismatch", requestId: "req-4" });
    expect(controller.get("req-4")?.status).toBe("pending");
  });
});
