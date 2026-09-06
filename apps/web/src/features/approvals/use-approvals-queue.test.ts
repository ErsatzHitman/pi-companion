import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { actions, permissions } from "@picompanion/frontend-core";

import { FakeClock, FakeDaemonPermissionsSource } from "./test-doubles.js";
import { useApprovalsQueue } from "./use-approvals-queue.js";
import { wirePermissionsController, wireRequestArbitrator } from "./daemon-permissions-client.js";

const SETTLE_WAIT = { timeout: 5_000 } as const;

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

describe("useApprovalsQueue", () => {
  it("starts empty and stays empty with no pending requests", () => {
    const controller = makeController();
    const { result } = renderHook(() => useApprovalsQueue({ controller }));
    expect(result.current.current).toBeNull();
    expect(result.current.waitingCount).toBe(0);
    expect(result.current.error).toBeNull();
  });

  it("surfaces the oldest pending request as current, and the rest as waitingCount", () => {
    const controller = makeController();
    controller.ingestRequest("agt_1", toolRequest("perm_1"));
    controller.ingestRequest("agt_1", toolRequest("perm_2"));
    controller.ingestRequest("agt_1", toolRequest("perm_3"));

    const { result } = renderHook(() => useApprovalsQueue({ controller }));
    expect(result.current.current?.requestId).toBe("perm_1");
    expect(result.current.waitingCount).toBe(2);
  });

  it("scopes the queue to sessionId when provided", () => {
    const controller = makeController();
    controller.ingestRequest("agt_other", toolRequest("perm_other"));
    controller.ingestRequest("agt_mine", toolRequest("perm_mine"));

    const { result } = renderHook(() => useApprovalsQueue({ controller, sessionId: "agt_mine" }));
    expect(result.current.current?.requestId).toBe("perm_mine");
    expect(result.current.waitingCount).toBe(0);
  });

  it("without a client, respond() still records the local answer and advances the queue", () => {
    const controller = makeController();
    controller.ingestRequest("agt_1", toolRequest("perm_1"));
    controller.ingestRequest("agt_1", toolRequest("perm_2"));

    const { result } = renderHook(() => useApprovalsQueue({ controller }));
    expect(result.current.current?.requestId).toBe("perm_1");

    act(() => {
      result.current.respond({ behavior: "allow" });
    });

    expect(controller.get("perm_1")?.status).toBe("answered");
    expect(result.current.current?.requestId).toBe("perm_2");
  });

  it("with a client, respond() sends the answer over the wire and advances the queue", async () => {
    const controller = makeController();
    const client = new FakeDaemonPermissionsSource();
    controller.ingestRequest("agt_1", toolRequest("perm_1"));

    const { result } = renderHook(() => useApprovalsQueue({ controller, client }));
    const allowAction = result.current.current?.actions.find((action) => action.id === "allow");
    if (!allowAction) throw new Error("expected an allow action");

    act(() => {
      result.current.respond(permissions.buildActionResponse(allowAction));
    });

    await waitFor(() => expect(client.respondCalls).toHaveLength(1), SETTLE_WAIT);
    expect(client.respondCalls[0]).toEqual({
      agentId: "agt_1",
      requestId: "perm_1",
      response: { behavior: "allow", selectedActionId: "allow" },
    });
    expect(result.current.current).toBeNull();
  });

  it("surfaces a send failure as `error`, which persists after the queue advances, until dismissed", async () => {
    const controller = makeController();
    const client = new FakeDaemonPermissionsSource();
    client.respondImpl = async () => {
      throw new Error("relay unreachable");
    };
    controller.ingestRequest("agt_1", toolRequest("perm_1"));
    controller.ingestRequest("agt_1", toolRequest("perm_2"));

    const { result } = renderHook(() => useApprovalsQueue({ controller, client }));

    act(() => {
      result.current.respond({ behavior: "deny" });
    });

    await waitFor(() => expect(result.current.error).toBe("relay unreachable"), SETTLE_WAIT);
    // The queue has already advanced to the next request even though the
    // previous one's send failed (plan.md §7.2 optimistic local answer).
    expect(result.current.current?.requestId).toBe("perm_2");

    act(() => {
      result.current.dismissError();
    });
    expect(result.current.error).toBeNull();
  });

  it("reflects a live daemon push (wired via wirePermissionsController) without a manual refresh", () => {
    const controller = makeController();
    const client = new FakeDaemonPermissionsSource();
    const unwire = wirePermissionsController(controller, client);

    const { result } = renderHook(() => useApprovalsQueue({ controller, client }));
    expect(result.current.current).toBeNull();

    act(() => {
      client.emitRequest("agt_1", toolRequest("perm_live"));
    });

    expect(result.current.current?.requestId).toBe("perm_live");
    unwire();
  });

  it("is inert (no-op) when respond() is called with no current request", () => {
    const controller = makeController();
    const { result } = renderHook(() => useApprovalsQueue({ controller }));
    expect(() => {
      act(() => {
        result.current.respond({ behavior: "deny" });
      });
    }).not.toThrow();
    expect(result.current.current).toBeNull();
  });

  describe("T47A2: notice — a request contested or superseded by another client", () => {
    function makeArbitrator() {
      return new actions.RequestArbitrator<permissions.AgentPermissionResponse>({
        clock: new FakeClock(),
      });
    }

    it("surfaces a readable notice when this client's own answer is superseded by another client's", async () => {
      const controller = makeController();
      const client = new FakeDaemonPermissionsSource();
      const arbitrator = makeArbitrator();
      const unwirePermissions = wirePermissionsController(controller, client);
      const unwireArbitration = wireRequestArbitrator(arbitrator, client);

      client.emitRequest("agt_1", toolRequest("perm_1"));

      const { result } = renderHook(() => useApprovalsQueue({ controller, client, arbitrator }));
      expect(result.current.current?.requestId).toBe("perm_1");

      act(() => {
        result.current.respond({ behavior: "allow", selectedActionId: "allow" });
      });
      await waitFor(() => expect(client.respondCalls).toHaveLength(1), SETTLE_WAIT);
      // The dialog already advanced past `perm_1` optimistically (plan.md
      // §7.2) — exactly the "vanishes" behavior this task fixes with `notice`.
      expect(result.current.current).toBeNull();
      expect(result.current.notice).toBeNull();

      // The daemon's authoritative resolution disagrees with what this
      // client submitted: another client's "deny" won.
      act(() => {
        client.emitResolved("agt_1", "perm_1", { behavior: "deny", selectedActionId: "deny" });
      });

      expect(result.current.notice).not.toBeNull();
      expect(result.current.notice?.requestId).toBe("perm_1");
      expect(result.current.notice?.statusLabel).toBe("Superseded");
      expect(result.current.notice?.message).toContain('"Deny"');
      expect(result.current.notice?.answeredByLabel).toBe("an unknown client");

      act(() => {
        result.current.dismissNotice();
      });
      expect(result.current.notice).toBeNull();

      unwireArbitration();
      unwirePermissions();
    });

    it("surfaces a readable notice when another client answers a request this client was still looking at (never answered locally)", () => {
      const controller = makeController();
      const client = new FakeDaemonPermissionsSource();
      const arbitrator = makeArbitrator();
      const unwirePermissions = wirePermissionsController(controller, client);
      const unwireArbitration = wireRequestArbitrator(arbitrator, client);

      client.emitRequest("agt_1", toolRequest("perm_1"));

      const { result } = renderHook(() => useApprovalsQueue({ controller, client, arbitrator }));
      expect(result.current.current?.requestId).toBe("perm_1");

      // Nobody clicked anything on this client — another client answered first.
      act(() => {
        client.emitResolved("agt_1", "perm_1", { behavior: "allow", selectedActionId: "allow" });
      });

      expect(result.current.current).toBeNull();
      expect(result.current.notice).not.toBeNull();
      expect(result.current.notice?.statusLabel).toBe("Answered elsewhere");
      expect(result.current.notice?.message).toContain('"Allow"');

      unwireArbitration();
      unwirePermissions();
    });

    it("does NOT surface a notice for a request that was only ever queued behind current (never displayed)", () => {
      const controller = makeController();
      const client = new FakeDaemonPermissionsSource();
      const arbitrator = makeArbitrator();
      const unwirePermissions = wirePermissionsController(controller, client);
      const unwireArbitration = wireRequestArbitrator(arbitrator, client);

      client.emitRequest("agt_1", toolRequest("perm_1"));
      client.emitRequest("agt_1", toolRequest("perm_2"));

      const { result } = renderHook(() => useApprovalsQueue({ controller, client, arbitrator }));
      expect(result.current.current?.requestId).toBe("perm_1");
      expect(result.current.waitingCount).toBe(1);

      // perm_2 is still queued behind perm_1 — this user was never looking
      // at it — so another client answering it must not pop a notice.
      act(() => {
        client.emitResolved("agt_1", "perm_2", { behavior: "deny" });
      });

      expect(result.current.notice).toBeNull();
      expect(result.current.current?.requestId).toBe("perm_1");

      unwireArbitration();
      unwirePermissions();
    });

    it("mutation proof: deleting the arbitrator subscription (as if this task's wiring were removed) leaves the dialog silently vanishing again, with no notice", async () => {
      const controller = makeController();
      const client = new FakeDaemonPermissionsSource();
      const unwirePermissions = wirePermissionsController(controller, client);
      // Deliberately no arbitrator passed — reproduces the pre-T47A2 gap.

      client.emitRequest("agt_1", toolRequest("perm_1"));
      const { result } = renderHook(() => useApprovalsQueue({ controller, client }));
      expect(result.current.current?.requestId).toBe("perm_1");

      act(() => {
        result.current.respond({ behavior: "allow", selectedActionId: "allow" });
      });
      await waitFor(() => expect(client.respondCalls).toHaveLength(1), SETTLE_WAIT);

      act(() => {
        client.emitResolved("agt_1", "perm_1", { behavior: "deny", selectedActionId: "deny" });
      });

      // Without the arbitrator, the losing client gets nothing: this is
      // exactly the defect T47A2 closes when `arbitrator` is supplied.
      expect(result.current.notice).toBeNull();
      unwirePermissions();
    });
  });
});
