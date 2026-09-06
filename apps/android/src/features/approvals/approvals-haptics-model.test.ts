import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { permissions } from "@picompanion/frontend-core";

import { createFakeVibrationPlatform } from "../../platform/haptics/fake-vibration-platform.js";

import {
  EMPTY_APPROVALS_QUEUE_SNAPSHOT,
  fireApprovalDecisionHaptic,
  fireBlockedHapticOnNewRequest,
} from "./approvals-haptics-model.js";
import { getApprovalsQueueSnapshot } from "./approvals-queue-model.js";

/** Comment-stripped source, per this repo's source-text-assertion convention (`readCode()` in `../../app/h/[serverId]/session/[agentId]/index.test.ts`). */
function readCode(relativePath: string): string {
  return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");
}

/**
 * T32S9 acceptance: the "blocked" and "approval" haptic triggers actually
 * fire off *real* `ApprovalsQueueSnapshot` transitions produced by a real
 * `permissions.PermissionsController` (never a hand-typed snapshot fixture)
 * — the same "a value of the mounted kind actually arrives" standard the
 * P5-W12 merge gate held `DiffRenderer` to.
 */

class FakeNowClock {
  private ms = 0;
  now(): number {
    return this.ms;
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

function makeController() {
  return new permissions.PermissionsController({ clock: new FakeNowClock() });
}

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

describe("fireBlockedHapticOnNewRequest", () => {
  it("fires 'blocked' the moment a real controller surfaces its first request as current", () => {
    const controller = makeController();
    const platform = createFakeVibrationPlatform();
    const before = getApprovalsQueueSnapshot(controller);
    expect(before).toEqual(EMPTY_APPROVALS_QUEUE_SNAPSHOT);

    controller.ingestRequest("agt_1", toolRequest("perm_1"));
    const after = getApprovalsQueueSnapshot(controller);

    const fired = fireBlockedHapticOnNewRequest(platform, true, before, after);

    expect(fired).toBe(true);
    expect(platform.calls).toHaveLength(1);
  });

  it("does not refire while the same request stays current across an unrelated recompute", () => {
    const controller = makeController();
    const platform = createFakeVibrationPlatform();
    controller.ingestRequest("agt_1", toolRequest("perm_1"));
    const snapshotA = getApprovalsQueueSnapshot(controller);
    const snapshotB = getApprovalsQueueSnapshot(controller); // same current.requestId, freshly recomputed

    const fired = fireBlockedHapticOnNewRequest(platform, true, snapshotA, snapshotB);

    expect(fired).toBe(false);
    expect(platform.calls).toHaveLength(0);
  });

  it("fires again when the queue advances to a genuinely different second request", () => {
    const controller = makeController();
    const platform = createFakeVibrationPlatform();
    controller.ingestRequest("agt_1", toolRequest("perm_1"));
    controller.ingestRequest("agt_1", toolRequest("perm_2"));
    const beforeAnswer = getApprovalsQueueSnapshot(controller);
    expect(beforeAnswer.current?.requestId).toBe("perm_1");
    expect(beforeAnswer.waitingCount).toBe(1);

    controller.answer(beforeAnswer.current!.requestId, { behavior: "allow" });
    const afterAnswer = getApprovalsQueueSnapshot(controller);
    expect(afterAnswer.current?.requestId).toBe("perm_2");

    const fired = fireBlockedHapticOnNewRequest(platform, true, beforeAnswer, afterAnswer);

    expect(fired).toBe(true);
    expect(platform.calls).toHaveLength(1);
  });

  it("respects hapticsEnabled: false — the transition is still detected but the platform is never touched", () => {
    const controller = makeController();
    const platform = createFakeVibrationPlatform();
    const before = getApprovalsQueueSnapshot(controller);
    controller.ingestRequest("agt_1", toolRequest("perm_1"));
    const after = getApprovalsQueueSnapshot(controller);

    const fired = fireBlockedHapticOnNewRequest(platform, false, before, after);

    // fireHaptic itself still reports `fired: false` via its own return
    // value in that case (see haptic.test.ts); this wrapper's boolean
    // return tracks "was a new-request transition detected", which is
    // independent of suppression, so it stays true here.
    expect(fired).toBe(true);
    expect(platform.calls).toHaveLength(0);
  });

  it("never fires from the empty snapshot to itself", () => {
    const platform = createFakeVibrationPlatform();
    const fired = fireBlockedHapticOnNewRequest(
      platform,
      true,
      EMPTY_APPROVALS_QUEUE_SNAPSHOT,
      EMPTY_APPROVALS_QUEUE_SNAPSHOT,
    );
    expect(fired).toBe(false);
    expect(platform.calls).toHaveLength(0);
  });
});

describe("fireApprovalDecisionHaptic", () => {
  it("fires 'approval' with the documented pattern when the user's decision is registered", () => {
    const controller = makeController();
    const platform = createFakeVibrationPlatform();
    controller.ingestRequest("agt_1", toolRequest("perm_1"));
    const snapshot = getApprovalsQueueSnapshot(controller);
    expect(snapshot.current).not.toBeNull();

    controller.answer(snapshot.current!.requestId, { behavior: "allow" });
    fireApprovalDecisionHaptic(platform, true);

    expect(platform.calls).toHaveLength(1);
    // approval's own documented pattern (haptic.ts) — one short, light pulse.
    expect(platform.calls[0]).toEqual([0, 40]);
  });

  it("is suppressed by hapticsEnabled: false", () => {
    const platform = createFakeVibrationPlatform();
    fireApprovalDecisionHaptic(platform, false);
    expect(platform.calls).toHaveLength(0);
  });
});

/**
 * T32S9 item (2): `haptic.ts`'s own doc comment discloses that
 * `VibrationPlatform.vibrate` is *reachable* directly — nothing in this
 * module's types stops a call site from skipping `fireHaptic` and
 * calling `platform.vibrate(...)` itself, bypassing both the
 * `hapticsEnabled` gate and the `visibleSignal` requirement. Every call
 * site this task adds goes through `fireHaptic(` exclusively; this test
 * proves that positively (a full call expression, never a bare
 * identifier — `fireHaptic` alone would be satisfied by this file's own
 * import line, see this repo's source-text-assertion rules) across every
 * file this task wired a real haptic trigger into.
 */
describe("no direct VibrationPlatform.vibrate() bypass in this task's call sites", () => {
  // Every file this task touches that holds a `VibrationPlatform` value at
  // all (`ApprovalsContainer.tsx` only forwards the prop it was given, so
  // it is checked for the bypass but not required to call `fireHaptic`
  // itself — it never fires a trigger directly).
  const filesTouchingVibrationPlatform = [
    "./approvals-haptics-model.ts",
    "./use-approvals-queue.ts",
    "./ApprovalsContainer.tsx",
  ];
  const filesThatFireHaptics = ["./approvals-haptics-model.ts"];

  it("calls fireHaptic(...) at least once in every file that fires a haptic trigger", () => {
    for (const file of filesThatFireHaptics) {
      expect(readCode(file)).toMatch(/fireHaptic\(/);
    }
  });

  it("never calls .vibrate(...) directly outside of fireHaptic's own implementation", () => {
    for (const file of filesTouchingVibrationPlatform) {
      expect(readCode(file)).not.toMatch(/\.vibrate\(/);
    }
  });
});
