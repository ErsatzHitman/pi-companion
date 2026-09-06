import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { actions, permissions } from "@picompanion/frontend-core";

import { OutcomeNoticeDialog } from "./OutcomeNotice.js";
import { wirePermissionsController, wireRequestArbitrator } from "./daemon-permissions-client.js";
import { FakeClock, FakeDaemonPermissionsSource } from "./test-doubles.js";
import { useApprovalsQueue, type UseApprovalsQueueOptions } from "./use-approvals-queue.js";

afterEach(cleanup);

/**
 * T111: proves `agent_permission_resolved`'s optional `answeredBy` reaches
 * an actual rendered DOM node — not just hook state — by mounting the
 * real `useApprovalsQueue` -> `buildOutcomeNotice` -> `OutcomeNoticeDialog`
 * pipeline (the same one `ApprovalsContainer` wires in production) and
 * reading `screen`, the way a real reader (or a screen reader) would.
 * `use-approvals-queue.test.ts`'s own "T47A2: notice" describe block
 * already covers this pipeline's *state* (`result.current.notice`) with
 * `renderHook`, which never mounts visible markup — this file is `.tsx`
 * specifically so it can render real JSX and query it, which a `.ts` test
 * file cannot do (this repo's esbuild JSX transform is `.tsx`-gated).
 *
 * Both tests here model a *second* client's view: nobody answered
 * locally on this client — another client's resolution just arrives live
 * — exactly the "resolved-elsewhere" case `outcome-notice.ts` names as
 * "another client answered the request they are looking at".
 */

function toolRequest(id: string): permissions.AgentPermissionRequest {
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

function makeController() {
  return new permissions.PermissionsController({ clock: new FakeClock() });
}

function makeArbitrator() {
  return new actions.RequestArbitrator<permissions.AgentPermissionResponse>({
    clock: new FakeClock(),
  });
}

function ApprovalsNoticeProbe(props: UseApprovalsQueueOptions) {
  const queue = useApprovalsQueue(props);
  if (!queue.notice) return null;
  return (
    <OutcomeNoticeDialog
      notice={queue.notice}
      onDismiss={queue.dismissNotice}
      testId="probe-notice"
    />
  );
}

describe("T111: agent_permission_resolved's answeredBy reaches the DOM", () => {
  it("renders which client answered when the daemon supplies answeredBy", () => {
    const controller = makeController();
    const client = new FakeDaemonPermissionsSource();
    const arbitrator = makeArbitrator();
    const unwirePermissions = wirePermissionsController(controller, client);
    const unwireArbitration = wireRequestArbitrator(arbitrator, client);

    client.emitRequest("agt_1", toolRequest("perm_1"));
    render(
      <ApprovalsNoticeProbe controller={controller} client={client} arbitrator={arbitrator} />,
    );
    expect(screen.queryByTestId("probe-notice-message")).toBeNull();

    // A second client answers first, and the daemon attributes it.
    act(() => {
      client.emitResolved(
        "agt_1",
        "perm_1",
        { behavior: "allow", selectedActionId: "allow" },
        { clientId: "clid_android_0007", label: "Android tablet" },
      );
    });

    const message = screen.getByTestId("probe-notice-message").textContent;
    expect(message).toContain("Android tablet");
    expect(message).not.toContain("unknown client");

    unwireArbitration();
    unwirePermissions();
  });

  it("keeps rendering 'an unknown client' when the daemon omits answeredBy (pre-T111 payload shape)", () => {
    const controller = makeController();
    const client = new FakeDaemonPermissionsSource();
    const arbitrator = makeArbitrator();
    const unwirePermissions = wirePermissionsController(controller, client);
    const unwireArbitration = wireRequestArbitrator(arbitrator, client);

    client.emitRequest("agt_1", toolRequest("perm_1"));
    render(
      <ApprovalsNoticeProbe controller={controller} client={client} arbitrator={arbitrator} />,
    );

    // No fourth argument: the exact call shape every pre-T111 test in
    // `use-approvals-queue.test.ts` already uses, proving an old daemon's
    // payload still renders exactly as it did before this task.
    act(() => {
      client.emitResolved("agt_1", "perm_1", { behavior: "allow", selectedActionId: "allow" });
    });

    const message = screen.getByTestId("probe-notice-message").textContent;
    expect(message).toContain("unknown client");

    unwireArbitration();
    unwirePermissions();
  });

  it("mutation proof: forwarding no answeredBy from wireRequestArbitrator (as if T111's forwarding were deleted) always renders 'an unknown client', even when the daemon supplied a real identity", () => {
    const controller = makeController();
    const client = new FakeDaemonPermissionsSource();
    // Simulates deleting `answeredBy: message.payload.answeredBy` from
    // `wireRequestArbitrator`'s `offResolved` handler: build the
    // arbitrator wiring by hand, exactly as that function does, but
    // without forwarding `answeredBy`.
    const arbitrator = makeArbitrator();
    const unwirePermissions = wirePermissionsController(controller, client);
    const offRequest = client.on("agent_permission_request", (message) => {
      arbitrator.open(message.payload.request.id);
    });
    const offResolved = client.on("agent_permission_resolved", (message) => {
      arbitrator.applyResolution(message.payload.requestId, {
        response: message.payload.resolution,
        // answeredBy deliberately omitted here.
      });
    });

    client.emitRequest("agt_1", toolRequest("perm_1"));
    render(
      <ApprovalsNoticeProbe controller={controller} client={client} arbitrator={arbitrator} />,
    );

    act(() => {
      client.emitResolved(
        "agt_1",
        "perm_1",
        { behavior: "allow", selectedActionId: "allow" },
        { clientId: "clid_android_0007", label: "Android tablet" },
      );
    });

    // Without the forwarding line, a real identity the daemon supplied is
    // silently lost — this is exactly the regression T111's real
    // `wireRequestArbitrator` (proven by the test above) fixes.
    const message = screen.getByTestId("probe-notice-message").textContent;
    expect(message).toContain("unknown client");
    expect(message).not.toContain("Android tablet");

    offRequest();
    offResolved();
    unwirePermissions();
  });
});
