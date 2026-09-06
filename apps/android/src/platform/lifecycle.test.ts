/**
 * T32S1B coverage for the Android `AppLifecycle` adapter.
 *
 * `react-native` cannot be transformed by this workspace's plain `vitest`
 * setup (its entry point carries a Flow type header), so `AppState` is
 * replaced with a controllable fixture via a `vi.mock` factory — which
 * means the real module is never loaded. That keeps the *binding* itself
 * under test (does `subscribe()` actually reach `AppState`? does
 * unsubscribing call `remove()`?) instead of settling for a source-text
 * assertion, which is all the `expo-router`-importing modules in this app
 * can manage.
 */
import { describe, expect, it, vi } from "vitest";

const appStateFixture = vi.hoisted(() => {
  const listeners = new Set<(status: string) => void>();
  return {
    currentState: "active" as string | null,
    addEventListenerCalls: [] as string[],
    removeCalls: 0,
    listenerCount: () => listeners.size,
    addEventListener(type: string, listener: (status: string) => void) {
      appStateFixture.addEventListenerCalls.push(type);
      listeners.add(listener);
      return {
        remove: () => {
          appStateFixture.removeCalls += 1;
          listeners.delete(listener);
        },
      };
    },
    emit(status: string) {
      // A copy: a listener may unsubscribe from inside its own callback.
      const notifying = Array.from(listeners);
      for (const listener of notifying) listener(status);
    },
    reset() {
      listeners.clear();
      appStateFixture.addEventListenerCalls = [];
      appStateFixture.removeCalls = 0;
      appStateFixture.currentState = "active";
    },
  };
});

vi.mock("react-native", () => ({ AppState: appStateFixture }));

const { createAppStateLifecycle, mapAppStateStatus } = await import("./lifecycle");

describe("mapAppStateStatus", () => {
  it("maps the two states Android actually reports", () => {
    expect(mapAppStateStatus("active")).toBe("active");
    expect(mapAppStateStatus("background")).toBe("background");
  });

  it('maps AppState\'s own "inactive" through unchanged', () => {
    expect(mapAppStateStatus("inactive")).toBe("inactive");
  });

  it('maps unknown, extension, and a not-yet-reported currentState to "inactive"', () => {
    // Never "active" (that would swallow the next real foreground signal)
    // and never "background" (that would over-claim an unreported state).
    expect(mapAppStateStatus("unknown")).toBe("inactive");
    expect(mapAppStateStatus("extension")).toBe("inactive");
    expect(mapAppStateStatus(null)).toBe("inactive");
    expect(mapAppStateStatus(undefined)).toBe("inactive");
  });
});

describe("createAppStateLifecycle", () => {
  it("getState() reads AppState.currentState through the mapping", () => {
    appStateFixture.reset();
    const lifecycle = createAppStateLifecycle();
    expect(lifecycle.getState()).toBe("active");
    appStateFixture.currentState = "background";
    expect(lifecycle.getState()).toBe("background");
  });

  it('subscribes to AppState\'s "change" event and calls through with the mapped state', () => {
    appStateFixture.reset();
    const lifecycle = createAppStateLifecycle();
    const seen: string[] = [];
    const unsubscribe = lifecycle.subscribe((state) => seen.push(state));

    expect(appStateFixture.addEventListenerCalls).toEqual(["change"]);

    appStateFixture.emit("background");
    appStateFixture.emit("unknown");
    appStateFixture.emit("active");

    expect(seen).toEqual(["background", "inactive", "active"]);
    unsubscribe();
  });

  it("unsubscribing removes the native subscription and stops notifications", () => {
    appStateFixture.reset();
    const lifecycle = createAppStateLifecycle();
    const seen: string[] = [];
    const unsubscribe = lifecycle.subscribe((state) => seen.push(state));
    unsubscribe();

    expect(appStateFixture.removeCalls).toBe(1);
    expect(appStateFixture.listenerCount()).toBe(0);

    appStateFixture.emit("background");
    expect(seen).toEqual([]);
  });

  it("supports independent subscribers", () => {
    appStateFixture.reset();
    const lifecycle = createAppStateLifecycle();
    const a: string[] = [];
    const b: string[] = [];
    const unsubA = lifecycle.subscribe((state) => a.push(state));
    const unsubB = lifecycle.subscribe((state) => b.push(state));

    appStateFixture.emit("background");

    expect(a).toEqual(["background"]);
    expect(b).toEqual(["background"]);
    unsubA();
    unsubB();
    expect(appStateFixture.listenerCount()).toBe(0);
  });
});
