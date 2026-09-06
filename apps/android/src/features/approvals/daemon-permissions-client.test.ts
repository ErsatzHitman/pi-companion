import { describe, expect, it } from "vitest";

import { permissions } from "@picompanion/frontend-core";

import { sendPermissionAnswer, wirePermissionsController } from "./daemon-permissions-client.js";
import { FakeClock, FakeDaemonPermissionsSource } from "./test-doubles.js";

/**
 * T33B5 criterion 2 ("the decision round-trips") over a live
 * `DaemonPermissionsSource`: `sendPermissionAnswer` sends the exact
 * wire message `PermissionsController.answer` produced, and
 * `wirePermissionsController` reflects a live daemon push (a request
 * arriving, or a request being resolved out from under this client —
 * the withdrawn case) without any manual poll.
 *
 * This exercises the same interface `@picompanion/client`'s real
 * `DaemonClient` satisfies structurally (see this module's own doc
 * comment); it does not itself construct a real `DaemonClient` or open
 * a socket — `apps/web/src/features/approvals/daemon-permissions-
 * client.fixture.test.ts` already proves that wire-compatibility once
 * for this exact adapter shape, and this Android port did not change
 * that shape.
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

describe("sendPermissionAnswer", () => {
  it("sends the exact wire message controller.answer produced, and resolves it", async () => {
    const controller = makeController();
    const client = new FakeDaemonPermissionsSource();
    controller.ingestRequest("agt_1", toolRequest("perm_1"));

    const wireMessage = await sendPermissionAnswer(controller, client, "perm_1", {
      behavior: "allow",
      selectedActionId: "allow",
    });

    expect(wireMessage).toEqual({
      type: "agent_permission_response",
      agentId: "agt_1",
      requestId: "perm_1",
      response: { behavior: "allow", selectedActionId: "allow" },
    });
    expect(client.respondCalls).toEqual([
      {
        agentId: "agt_1",
        requestId: "perm_1",
        response: { behavior: "allow", selectedActionId: "allow" },
      },
    ]);
  });

  it("sends nothing and resolves null for a stale (already-answered) request", async () => {
    const controller = makeController();
    const client = new FakeDaemonPermissionsSource();
    controller.ingestRequest("agt_1", toolRequest("perm_1"));
    controller.answer("perm_1", { behavior: "deny" });

    const result = await sendPermissionAnswer(controller, client, "perm_1", { behavior: "allow" });

    expect(result).toBeNull();
    expect(client.respondCalls).toHaveLength(0);
  });

  it("propagates a transport failure so the caller can surface it (this client's own answer already applied locally)", async () => {
    const controller = makeController();
    const client = new FakeDaemonPermissionsSource();
    client.respondImpl = async () => {
      throw new Error("relay unreachable");
    };
    controller.ingestRequest("agt_1", toolRequest("perm_1"));

    await expect(
      sendPermissionAnswer(controller, client, "perm_1", { behavior: "deny" }),
    ).rejects.toThrow("relay unreachable");
    expect(controller.get("perm_1")?.status).toBe("answered");
  });
});

describe("wirePermissionsController", () => {
  it("reflects a live daemon request push without a manual refresh", () => {
    const controller = makeController();
    const client = new FakeDaemonPermissionsSource();
    const unwire = wirePermissionsController(controller, client);

    expect(controller.getPending()).toHaveLength(0);
    client.emitRequest("agt_1", toolRequest("perm_live"));
    expect(controller.getPending().map((v) => v.requestId)).toEqual(["perm_live"]);

    unwire();
  });

  it("reflects a live daemon resolution pushed before this client answered locally — the withdrawn case", () => {
    const controller = makeController();
    const client = new FakeDaemonPermissionsSource();
    const unwire = wirePermissionsController(controller, client);

    client.emitRequest("agt_1", toolRequest("perm_withdrawn"));
    expect(controller.getPending()).toHaveLength(1);

    client.emitResolved("agt_1", "perm_withdrawn", { behavior: "deny", interrupt: true });

    expect(controller.getPending()).toHaveLength(0);
    const entry = controller.get("perm_withdrawn");
    expect(entry?.status).toBe("answered");
    expect(entry?.localResponse).toBeUndefined();
    expect(entry?.resolution).toEqual({ behavior: "deny", interrupt: true });

    unwire();
  });

  it("unsubscribes both handlers", () => {
    const controller = makeController();
    const client = new FakeDaemonPermissionsSource();
    const unwire = wirePermissionsController(controller, client);
    unwire();

    client.emitRequest("agt_1", toolRequest("perm_after_unwire"));
    expect(controller.getPending()).toHaveLength(0);
  });
});
