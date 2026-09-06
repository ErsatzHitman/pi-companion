import { describe, expect, it } from "vitest";
import * as frontendCore from "./index.js";
import type { CorePlatform } from "./index.js";

// Smoke tests only: prove the package's directory layout (plan.md §6) and
// platform interfaces (plan.md §7.3) are wired into the workspace build,
// typecheck, and test pipeline. Real domain coverage arrives with the
// Phase 2+ tasks listed in docs/issues-from-plan.md; the import-purity
// guard itself is covered by ./import-guard.test.ts.
//
// `extensions` graduated from a T14 stub to real Pi UI element state and
// revision handling in T21B (see ./extensions/*.test.ts for full coverage);
// the remaining namespaces stay stubs until their own Phase 2+ task lands.
describe("@picompanion/frontend-core", () => {
  it("exposes every §6 domain namespace", () => {
    // connection/ is real as of T19A; its own tests cover behavior. This
    // smoke test only proves the namespace is wired into the package build.
    expect(typeof frontendCore.connection.DaemonClientLifecycle).toBe("function");
    // hosts/ is real as of T19B; its own tests cover behavior. This smoke
    // test only proves the namespace is wired into the package build.
    expect(typeof frontendCore.hosts.HostController).toBe("function");
    expect(typeof frontendCore.hosts.HostProfileStore).toBe("function");
    expect(typeof frontendCore.hosts.ConnectionProber).toBe("function");
    expect(typeof frontendCore.hosts.ReconnectPolicy).toBe("function");
    // sessions/ is still a stub for session list/switch/create state, but
    // sessions/tree.ts (T38A1a) is real as of Phase 6 — assert its public
    // surface is wired into the barrel export. Behavior is covered by
    // sessions/tree.test.ts.
    expect(frontendCore.sessions.SESSIONS_DOMAIN_STUB).toBe(true);
    expect(typeof frontendCore.sessions.createRootSession).toBe("function");
    expect(typeof frontendCore.sessions.forkSession).toBe("function");
    expect(typeof frontendCore.sessions.cloneSession).toBe("function");
    expect(typeof frontendCore.sessions.buildSessionTreeIndex).toBe("function");
    // timeline/ is no longer a stub as of T20A/T20B; assert its real
    // exports instead (its own fixture-driven invariant coverage lives in
    // timeline/reducer.test.ts and timeline/reducer-pagination.test.ts).
    expect(typeof frontendCore.timeline.createEmptyTimelineState).toBe("function");
    expect(typeof frontendCore.timeline.ingestAgentStreamMessage).toBe("function");
    expect(typeof frontendCore.timeline.ingestTimelineWindow).toBe("function");
    expect(typeof frontendCore.timeline.addOptimisticUserMessage).toBe("function");
    expect(typeof frontendCore.timeline.planGapBackfillRequest).toBe("function");
    expect(typeof frontendCore.timeline.restoreCachedTimeline).toBe("function");
    expect(typeof frontendCore.timeline.getVisibleTimelineRows).toBe("function");
    expect(frontendCore.timeline.createEmptyTimelineState()).toEqual({
      epoch: null,
      rows: [],
      pendingRows: [],
      gap: null,
      stale: false,
    });
    // permissions/ is real as of T21A (docs/issues-from-plan.md); assert its
    // public surface is wired into the barrel export instead of a stub flag.
    expect(typeof frontendCore.permissions.PermissionsController).toBe("function");
    // extensions/ is real as of T21B; Pi UI element state lives here.
    expect(frontendCore.extensions.PiUiElementStore).toBeTypeOf("function");
    expect(frontendCore.extensions.ExtensionActionController).toBeTypeOf("function");
    // tools/ is implemented (T23): it exports real builders, not a stub flag.
    expect(typeof frontendCore.tools.buildToolCallViewModel).toBe("function");
    expect(typeof frontendCore.tools.buildGenericToolCallViewModel).toBe("function");
    expect(typeof frontendCore.tools.ToolCallViewModelRegistry).toBe("function");
    expect(frontendCore.files.FILES_DOMAIN_STUB).toBe(true);
    // navigation/ and testing/ are no longer stubs as of T24; their own
    // tests cover behavior (navigation/intents.test.ts,
    // testing/recorded-session.test.ts). Assert their real exports below.
    expect(typeof frontendCore.navigation.applyNavigationIntent).toBe("function");
    expect(typeof frontendCore.navigation.navigationIntentToPath).toBe("function");
    // telemetry/ is real as of T29C1; its own tests cover behavior
    // (telemetry/derive.test.ts). This smoke test only proves the
    // namespace is wired into the package build.
    expect(typeof frontendCore.telemetry.deriveContextWindowUsage).toBe("function");
    expect(typeof frontendCore.telemetry.deriveCacheShare).toBe("function");
    expect(typeof frontendCore.telemetry.deriveContextWindowTelemetry).toBe("function");
    expect(typeof frontendCore.testing.loadRecordedSessionFixture).toBe("function");
    expect(typeof frontendCore.testing.buildDirectHostProfileFixture).toBe("function");
  });

  it("exposes the composer domain (T22: DraftStore, OutboxController)", () => {
    expect(typeof frontendCore.composer.DraftStore).toBe("function");
    expect(typeof frontendCore.composer.OutboxController).toBe("function");
  });

  it("exposes the offline domain (T22: OfflineCache)", () => {
    expect(typeof frontendCore.offline.OfflineCache).toBe("function");
  });

  it("type-checks a CorePlatform value built from the §7.3 interfaces", () => {
    // This function body never runs; its purpose is compile-time proof
    // that every platform interface is exported and assembles into the
    // CorePlatform aggregate. Kept inside the test file so `tsc` for the
    // real `src/**/*.ts` build stays free of unused, never-called code.
    function assertShapeCompiles(platform: CorePlatform): CorePlatform {
      return platform;
    }
    expect(typeof assertShapeCompiles).toBe("function");
  });
});
