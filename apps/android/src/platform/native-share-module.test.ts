/**
 * T78 coverage for the Android `NativeShareModule` binding.
 *
 * Same technique as `./haptics/vibration-platform.test.ts`: `react-native`
 * cannot be transformed by this workspace's plain `vitest` setup, so
 * `Share` is replaced with a controllable fixture via a `vi.mock` factory
 * before the module under test is imported. That proves the binding
 * itself — does `share()` actually reach `Share.share` with the exact
 * content/options, and does its resolved value actually arrive back at
 * the caller? — rather than settling for a source-text assertion.
 */
import { describe, expect, it, vi } from "vitest";

const shareFixture = vi.hoisted(() => {
  return {
    calls: [] as unknown[][],
    resolveWith: { action: "sharedAction" } as { action: string; activityType?: string | null },
    async share(...args: unknown[]) {
      shareFixture.calls.push(args);
      return shareFixture.resolveWith;
    },
    reset() {
      shareFixture.calls = [];
      shareFixture.resolveWith = { action: "sharedAction" };
    },
  };
});

vi.mock("react-native", () => ({ Share: shareFixture }));

const { createRNShareModule } = await import("./native-share-module.js");

describe("createRNShareModule", () => {
  it("forwards share(content, options) straight through to Share.share", async () => {
    shareFixture.reset();
    const module_ = createRNShareModule();

    await module_.share({ message: "hello" }, { dialogTitle: "Share" });

    expect(shareFixture.calls).toEqual([[{ message: "hello" }, { dialogTitle: "Share" }]]);
  });

  it("resolves with Share.share's exact resolved value — a value actually arrives back, not just a registered call", async () => {
    shareFixture.reset();
    shareFixture.resolveWith = { action: "sharedAction", activityType: "com.example.app" };
    const module_ = createRNShareModule();

    const result = await module_.share({ message: "hi" });

    expect(result).toEqual({ action: "sharedAction", activityType: "com.example.app" });
  });

  it("forwards each call independently across repeated calls", async () => {
    shareFixture.reset();
    const module_ = createRNShareModule();

    await module_.share({ message: "one" });
    await module_.share({ message: "two" }, { dialogTitle: "Two" });

    expect(shareFixture.calls).toEqual([
      [{ message: "one" }, undefined],
      [{ message: "two" }, { dialogTitle: "Two" }],
    ]);
  });
});
