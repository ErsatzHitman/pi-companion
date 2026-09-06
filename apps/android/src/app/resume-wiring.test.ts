/**
 * T32S1B end-to-end wiring proof: a real `AppState` `change` event, through
 * this app's `AppCore`, reaching a real T46A2 `ResumeController`'s
 * `reconcile()`.
 *
 * `resume-signals.test.ts` proves the decision rules and the subscription
 * glue in isolation; this file proves the *app* is wired to them —
 * `createAppCore()` builds the `AppState`-backed adapter and
 * `AppCore.attachResumeSignals` connects it — which is the part a unit
 * test of either half alone would miss. `react-native` is replaced with a
 * controllable `AppState` fixture (the real module cannot be transformed
 * by plain `vitest`), so the event that starts the chain is the same
 * `AppState.addEventListener("change", …)` callback the OS invokes.
 *
 * The `useResumeSignals()` hook in `core-context.tsx` is asserted at
 * source level, matching `navigation-shell.test.ts`'s precedent for this
 * app's React modules: rendering it would need `react-native` for real.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it, vi } from "vitest";

import type { Clock, TimerHandle } from "@picompanion/frontend-core";
import { connection as coreConnection, timeline as coreTimeline } from "@picompanion/frontend-core";

const appStateFixture = vi.hoisted(() => {
  const listeners = new Set<(status: string) => void>();
  return {
    currentState: "active" as string | null,
    addEventListener(_type: string, listener: (status: string) => void) {
      listeners.add(listener);
      return {
        remove: () => {
          listeners.delete(listener);
        },
      };
    },
    emit(status: string) {
      appStateFixture.currentState = status;
      // A copy: a listener may unsubscribe from inside its own callback.
      const notifying = Array.from(listeners);
      for (const listener of notifying) listener(status);
    },
    listenerCount: () => listeners.size,
  };
});

// T32S4: `createAppCore()` now also constructs a `PiUiSession`
// (`../features/extensions/registry-index.ts`'s `createPiUiSession`),
// which imports `./renderers` unconditionally — reaching
// `react-native-reanimated` (`thinking-row.tsx`, transitively
// `react-native-worklets`) at module-eval time, not just this file's own
// `AppState` surface. Stubbed the same enumerated set
// `pi-ui-session.test.ts`/`registry-index.test.ts` already established
// for exactly this import-only concern, merged with this file's own
// `AppState` fixture — see those files' doc comments for why an uncalled
// stub is sufficient here (this file never renders a Pi UI element, it
// only proves `createAppCore()` still constructs and wires without
// throwing).
vi.mock("react-native", () => {
  function Stub(): null {
    return null;
  }
  return {
    AppState: appStateFixture,
    StyleSheet: { create: (styles: unknown) => styles, hairlineWidth: 1 },
    Text: Stub,
    View: Stub,
    Pressable: Stub,
    ScrollView: Stub,
    Modal: Stub,
    TextInput: Stub,
    AccessibilityInfo: {
      isReduceMotionEnabled: async () => false,
      addEventListener: () => ({ remove: () => undefined }),
    },
    BackHandler: { addEventListener: () => ({ remove: () => undefined }) },
    findNodeHandle: () => null,
    useColorScheme: () => "light",
    Linking: { openURL: async () => true },
  };
});

vi.mock("react-native-reanimated", () => {
  function Stub(): null {
    return null;
  }
  const Animated = { View: Stub, Text: Stub, createAnimatedComponent: (c: unknown) => c };
  return {
    default: Animated,
    Easing: { ease: (v: number) => v, out: (fn: unknown) => fn, linear: (v: number) => v },
    useAnimatedStyle: () => ({}),
    useSharedValue: (value: unknown) => ({ value }),
    withTiming: (value: unknown) => value,
    withRepeat: (value: unknown) => value,
  };
});

// `createAppCore()` now also constructs a real `KeyValueStorage`
// (`../platform/key-value-storage.ts`), which imports `expo-secure-store`
// — a second `react-native`-reaching module this file's `react-native`
// mock alone does not cover (it reaches `expo-modules-core`, not
// `react-native` directly). Stubbed the same way, for the same reason.
vi.mock("expo-secure-store", () => ({
  getItemAsync: async () => null,
  setItemAsync: async () => {},
  deleteItemAsync: async () => {},
  isAvailableAsync: async () => true,
}));

// T69: `../app-shell/core.ts` now imports
// `../features/share/share-intent-native-port.js` (T36F), which reaches
// `expo-modules-core` at its top level — same reason as `expo-secure-store`
// above. `requireOptionalNativeModule` always returning `null` here is the
// same "no native module linked in this sandbox" fallback production
// itself hits.
vi.mock("expo-modules-core", () => ({
  requireOptionalNativeModule: () => null,
}));

const { createAppCore } = await import("../app-shell/core");

/** A `Clock` that never fires: this file never exercises the bounded periodic check. */
class NoopClock implements Clock {
  now(): number {
    return 0;
  }
  setTimeout(): TimerHandle {
    return 0 as unknown as TimerHandle;
  }
  clearTimeout(): void {}
  setInterval(): TimerHandle {
    return 0 as unknown as TimerHandle;
  }
  clearInterval(): void {}
}

async function settle(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

/** Fake interval scheduler for `AppCore.network`'s polling — mirrors `../platform/network-reachability.test.ts`'s. */
function createFakeIntervalScheduler() {
  const callbacks = new Map<number, () => void>();
  let nextHandle = 1;
  return {
    setInterval: (callback: () => void) => {
      const handle = nextHandle++;
      callbacks.set(handle, callback);
      return handle;
    },
    clearInterval: (handle: number) => {
      callbacks.delete(handle);
    },
    advance: () => {
      for (const callback of [...callbacks.values()]) callback();
    },
  };
}

function harness(overrides?: Parameters<typeof createAppCore>[0]) {
  appStateFixture.currentState = "active";
  const core = createAppCore(overrides);
  const reconcile = vi.fn<coreConnection.ResumeReconcile>(async () => undefined);
  const controller = new coreConnection.ResumeController({
    runGeneration: new coreTimeline.RunGenerationTracker(),
    clock: new NoopClock(),
    reconcile,
  });
  return { core, controller, reconcile };
}

describe("AppCore resume-signal wiring (T32S1B)", () => {
  it("exposes the real AppState-backed lifecycle adapter", () => {
    const { core } = harness();
    expect(core.lifecycle.getState()).toBe("active");
    appStateFixture.currentState = "background";
    expect(core.lifecycle.getState()).toBe("background");
  });

  it("an OS foreground event reaches a real ResumeController's reconcile()", async () => {
    const { core, controller, reconcile } = harness();
    const dispose = core.attachResumeSignals(controller);
    await settle();

    appStateFixture.emit("background");
    appStateFixture.emit("active");
    await settle();

    expect(reconcile).toHaveBeenCalledTimes(1);
    expect(reconcile).toHaveBeenCalledWith("resume-signal");

    dispose();
    controller.dispose();
  });

  it("a connectivity change reaches the same controller", async () => {
    const scheduler = createFakeIntervalScheduler();
    let reachable = true;
    const { core, controller, reconcile } = harness({
      network: {
        probe: () => Promise.resolve(reachable),
        setInterval: scheduler.setInterval,
        clearInterval: scheduler.clearInterval,
      },
    });
    const dispose = core.attachResumeSignals(controller);
    await settle();

    // `AppCore.network` is the real, probe-based `PollingNetworkReachability`
    // (`../platform/network-reachability.ts`) here, with the scripted probe
    // above standing in for a real device network check (see
    // `createDefaultAndroidProbe`'s own doc comment for why the real one
    // isn't exercised here): online -> offline raises nothing, and the
    // return to online reconciles.
    reachable = false;
    scheduler.advance();
    await settle();
    expect(reconcile).not.toHaveBeenCalled();

    reachable = true;
    scheduler.advance();
    await settle();
    expect(reconcile).toHaveBeenCalledTimes(1);
    expect(reconcile).toHaveBeenCalledWith("resume-signal");

    dispose();
    controller.dispose();
  });

  it("passes churn options through, and disposing detaches the AppState listener", async () => {
    const { core, controller, reconcile } = harness();
    let nowMs = 0;
    const dispose = core.attachResumeSignals(controller, {
      minIntervalMs: 2_000,
      now: () => nowMs,
      schedule: () => () => {},
    });
    await settle();
    expect(appStateFixture.listenerCount()).toBe(1);

    appStateFixture.emit("background");
    appStateFixture.emit("active");
    nowMs += 100;
    appStateFixture.emit("background");
    appStateFixture.emit("active");
    await settle();

    // Rate-limited: the second foreground inside the window is deferred to
    // the (here inert) scheduler rather than reconciling again.
    expect(reconcile).toHaveBeenCalledTimes(1);

    dispose();
    expect(appStateFixture.listenerCount()).toBe(0);

    nowMs += 10_000;
    appStateFixture.emit("background");
    appStateFixture.emit("active");
    await settle();
    expect(reconcile).toHaveBeenCalledTimes(1);

    controller.dispose();
  });
});

describe("core-context.tsx source", () => {
  // Comments stripped: this file's own doc comments name every symbol
  // the T32S3 assertions below check for (`listHostProfiles`,
  // `useColdStartProfile`, ...) — see
  // `h/[serverId]/session/[agentId]/index.test.ts`'s identical `readCode()`
  // rationale.
  function readCode(): string {
    const raw = readFileSync(fileURLToPath(new URL("./core-context.tsx", import.meta.url)), "utf8");
    return raw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  }
  const source = readCode();

  it("exposes useResumeSignals() through the existing AppCoreProvider rather than a second provider", () => {
    expect(source).toMatch(/export function useResumeSignals\(/);
    expect(source).toMatch(/useAppCore\(\)/);
    // Three contexts (T32S3 added `ColdStartProfileContext` alongside the
    // original `AppCoreContext`; T32S15 added `ColdStartHasShareContext`
    // alongside that), but still exactly one provider component — see
    // the next test.
    expect((source.match(/createContext</g) ?? []).length).toBe(3);
  });

  it("attaches in an effect and returns the dispose function as the cleanup", () => {
    expect(source).toMatch(
      /useEffect\(\(\) => \{[\s\S]*?return core\.attachResumeSignals\(target\)/,
    );
  });

  // --- T32S3 item (3): the cold-start gate -----------------------------

  it("AppCoreProvider renders null before the cold-start profile read settles", () => {
    expect(source).toMatch(
      /export function AppCoreProvider\([\s\S]*?if \(!coldStart\.resolved\) \{\s*return null;/,
    );
  });

  it("resolves via listHostProfiles(), using AppCore's own secureStorage/keyValueStorage", () => {
    expect(source).toMatch(
      /listHostProfiles\(\{\s*secureStorage:\s*core\.secureStorage,\s*plainStorage:\s*core\.keyValueStorage\s*\}\)/,
    );
  });

  it("a read failure resolves to no profile and no pending share rather than hanging the gate", () => {
    expect(source).toMatch(
      /\.catch\(\(\) => \{\s*if \(!cancelled\) setColdStart\(\{ resolved: true, profile: null, hasInitialShare: false \}\);/,
    );
  });

  it("exposes the resolved profile via useColdStartProfile()", () => {
    expect(source).toMatch(/export function useColdStartProfile\(\)/);
    expect(source).toMatch(/return useContext\(ColdStartProfileContext\);/);
  });

  /**
   * T32S15: `../app/share.tsx`'s own doc comment named this exact gap
   * against this task by name — "nothing yet *navigates to* `/share`
   * automatically" on a cold start launched by a real OS share intent.
   * `core-context.tsx`'s own doc comment on this effect explains why
   * `getInitialShareIntent()` is safe to peek here as well as read again
   * inside `../app/share.tsx`'s own `start()`.
   */
  it("peeks AppCore.shareIntentPort.getInitialShareIntent() alongside the profile read, resolving hasInitialShare from it", () => {
    expect(source).toMatch(
      /Promise\.all\(\[\s*listHostProfiles\(\{\s*secureStorage:\s*core\.secureStorage,\s*plainStorage:\s*core\.keyValueStorage\s*\}\),\s*core\.shareIntentPort\.getInitialShareIntent\(\)\.catch\(\(\) => null\),\s*\]\)/,
    );
    expect(source).toMatch(
      /\.then\(\(\[profiles, initialShare\]\) => \{\s*if \(!cancelled\) \{\s*setColdStart\(\{\s*resolved: true,\s*profile: profiles\[0\] \?\? null,\s*hasInitialShare: initialShare !== null,\s*\}\);/,
    );
  });

  it("exposes the resolved hasInitialShare flag via useColdStartHasShareIntent()", () => {
    expect(source).toMatch(/export function useColdStartHasShareIntent\(\)/);
    expect(source).toMatch(/return useContext\(ColdStartHasShareContext\);/);
  });

  /**
   * T32S15: the other half of the same disclosed gap — a live share
   * arriving while some other screen is on screen used to have no
   * subscriber at all, since `../app/share.tsx`'s own runtime only
   * exists while `/share` itself is mounted. Deleting this
   * `core.shareIntentPort.subscribe(...)` call (leaving `/share`'s own
   * separate subscription in `share-chooser-runtime.ts` untouched) is
   * the mutation that falsifies this test — see this task's report for
   * the real run.
   */
  it("subscribes to AppCore.shareIntentPort independently and pushes /share on a live event, guarded by the current pathname", () => {
    expect(source).toMatch(
      /useEffect\(\(\) => \{\s*return core\.shareIntentPort\.subscribe\(\(\) => \{\s*if \(pathnameRef\.current !== "\/share"\) \{\s*router\.push\("\/share"\);\s*\}\s*\}\);\s*\}, \[core, router\]\);/,
    );
  });

  it("still exactly one AppCoreProvider component exported", () => {
    expect((source.match(/export function AppCoreProvider\(/g) ?? []).length).toBe(1);
  });

  /**
   * T74: `AppCore.shutdown()`'s one production caller. `readCode()` above
   * strips both block and line comments before this file's `source`
   * assertions run — this test's own doc comment (and this task's whole
   * new `useEffect`'s doc comment, which also happens to mention
   * `core.shutdown()` in prose) are stripped along with everything else,
   * so this only passes against the real `return () => { void
   * core.shutdown(); }` cleanup, never a doc-comment mention of the same
   * words. Deleting the real cleanup and re-running is the check that
   * proves this — `AppCore.shutdown()`'s own behaviour is proven directly
   * in `../app-shell/core.test.ts`'s "AppCore.shutdown() (T74)" suite;
   * this file proves only that `AppCoreProvider` is wired to call it.
   */
  it("calls core.shutdown() from its own unmount cleanup — the process-lifetime teardown hook T74 added", () => {
    expect(source).toMatch(
      /useEffect\(\(\) => \{\s*return \(\) => \{\s*void core\.shutdown\(\);\s*\};\s*\}, \[core\]\);/,
    );
  });
});
