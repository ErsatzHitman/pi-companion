import { describe, expect, it } from "vitest";

import type { KeyValueStorage, permissions } from "@picompanion/frontend-core";

import { createFakeVibrationPlatform } from "../../platform/haptics/fake-vibration-platform.js";
import {
  fireApprovalDecisionHaptic,
  fireBlockedHapticOnNewRequest,
} from "../approvals/approvals-haptics-model.js";
import type { ApprovalsQueueSnapshot } from "../approvals/approvals-queue-model.js";
import { fireTranscriptStatusHaptic } from "../transcript/transcript-status-haptics-model.js";

import { createSettingsController } from "./settings-model.js";

/**
 * T32C1's boundary problem, made honest: `use-approvals-queue.ts` and
 * `apps/android/src/app/h/[serverId]/session/[agentId]/index.tsx` (the
 * two real call sites named in this task's brief) both live outside
 * this task's `Owns` grant, so this file cannot edit them to read
 * `SettingsController` and cannot render-test them (this repo's vitest
 * cannot import anything reaching `react-native`, and both are `.tsx`
 * anyway).
 *
 * What this test *can* do, and does: compose this task's real
 * `createSettingsController` with the *actual* unowned-but-importable
 * firing functions those two call sites already use
 * (`fireApprovalDecisionHaptic`, `fireBlockedHapticOnNewRequest`,
 * `fireTranscriptStatusHaptic` — imported, never reimplemented), and
 * prove that reading `settings.getSnapshot().hapticsEnabled` and
 * threading it into those real functions, exactly as the seam filed
 * against `app/`/`app-shell/` below asks the two call sites to do,
 * makes a suppressed trigger reach the platform's `vibrate` zero times.
 * This is the real call path from the settings store's write forward;
 * it is not a proof that the two call sites have actually been edited
 * yet — see this task's report for that gap.
 */
function makeMemoryStorage(): KeyValueStorage {
  const store = new Map<string, string>();
  return {
    async getItem(key) {
      return store.has(key) ? (store.get(key) as string) : null;
    },
    async setItem(key, value) {
      store.set(key, value);
    },
    async removeItem(key) {
      store.delete(key);
    },
    async clear() {
      store.clear();
    },
    async keys(prefix) {
      const all = [...store.keys()];
      return prefix ? all.filter((k) => k.startsWith(prefix)) : all;
    },
  };
}

describe("settings.hapticsEnabled threaded into the real approvals firing functions", () => {
  it("hapticsEnabled=true (default): 'blocked' and 'approval' both reach the fake platform", async () => {
    const settings = createSettingsController({ storage: makeMemoryStorage() });
    await settings.load();
    const platform = createFakeVibrationPlatform();

    const empty: ApprovalsQueueSnapshot = { current: null, waitingCount: 0 };
    const withRequest: ApprovalsQueueSnapshot = {
      current: { requestId: "req-1" } as unknown as permissions.PermissionDialogViewModel,
      waitingCount: 0,
    };

    fireBlockedHapticOnNewRequest(
      platform,
      settings.getSnapshot().hapticsEnabled,
      empty,
      withRequest,
    );
    fireApprovalDecisionHaptic(platform, settings.getSnapshot().hapticsEnabled);

    expect(platform.calls).toHaveLength(2);
  });

  it("hapticsEnabled=false: the same two real triggers reach the platform ZERO times", async () => {
    const settings = createSettingsController({ storage: makeMemoryStorage() });
    await settings.load();
    await settings.setHapticsEnabled(false);
    const platform = createFakeVibrationPlatform();

    const empty: ApprovalsQueueSnapshot = { current: null, waitingCount: 0 };
    const withRequest: ApprovalsQueueSnapshot = {
      current: { requestId: "req-1" } as unknown as permissions.PermissionDialogViewModel,
      waitingCount: 0,
    };

    fireBlockedHapticOnNewRequest(
      platform,
      settings.getSnapshot().hapticsEnabled,
      empty,
      withRequest,
    );
    fireApprovalDecisionHaptic(platform, settings.getSnapshot().hapticsEnabled);

    expect(platform.calls).toHaveLength(0);
  });
});

describe("settings.hapticsEnabled threaded into the real transcript-status firing function", () => {
  it("hapticsEnabled=true (default): an error transition reaches the fake platform", async () => {
    const settings = createSettingsController({ storage: makeMemoryStorage() });
    await settings.load();
    const platform = createFakeVibrationPlatform();

    fireTranscriptStatusHaptic(
      platform,
      settings.getSnapshot().hapticsEnabled,
      "streaming",
      "error",
    );

    expect(platform.calls).toHaveLength(1);
  });

  it("hapticsEnabled=false: the same real error/finished transitions reach the platform ZERO times", async () => {
    const settings = createSettingsController({ storage: makeMemoryStorage() });
    await settings.load();
    await settings.setHapticsEnabled(false);
    const platform = createFakeVibrationPlatform();

    fireTranscriptStatusHaptic(
      platform,
      settings.getSnapshot().hapticsEnabled,
      "streaming",
      "error",
    );
    fireTranscriptStatusHaptic(
      platform,
      settings.getSnapshot().hapticsEnabled,
      "streaming",
      "connected",
    );

    expect(platform.calls).toHaveLength(0);
  });
});
