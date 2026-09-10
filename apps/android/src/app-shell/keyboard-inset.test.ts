import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { keyboardInsetFromEvent } from "./keyboard-inset-model";

describe("keyboardInsetFromEvent (T329)", () => {
  it("returns the reported keyboard height for a show event", () => {
    expect(keyboardInsetFromEvent({ endCoordinates: { height: 258.5 } })).toBe(258.5);
  });

  it("returns 0 for a hide event, a missing payload, or a non-finite height", () => {
    expect(keyboardInsetFromEvent({ endCoordinates: { height: 0 } })).toBe(0);
    expect(keyboardInsetFromEvent({ endCoordinates: null })).toBe(0);
    expect(keyboardInsetFromEvent(null)).toBe(0);
    expect(keyboardInsetFromEvent(undefined)).toBe(0);
    expect(keyboardInsetFromEvent({ endCoordinates: { height: Number.NaN } })).toBe(0);
    expect(keyboardInsetFromEvent({ endCoordinates: { height: -10 } })).toBe(0);
  });
});

/**
 * `apps/android`'s plain `vitest` setup cannot import `react-native`
 * (see `compact-shell.test.ts`'s doc comment), so the hook is held to a
 * source-level contract the same way every RN component in this app is.
 */
describe("useKeyboardInset source (T329)", () => {
  const code = readFileSync(fileURLToPath(new URL("./keyboard-inset.ts", import.meta.url)), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");

  it("subscribes to keyboardDidShow and keyboardDidHide, and removes both subscriptions on cleanup", () => {
    expect(code).toMatch(/Keyboard\.addListener\("keyboardDidShow"/);
    expect(code).toMatch(/Keyboard\.addListener\("keyboardDidHide"/);
    expect(code).toMatch(/show\.remove\(\);\s*hide\.remove\(\);/);
  });

  it("derives the show inset through the RN-free model, and resets to 0 on hide", () => {
    expect(code).toMatch(/setInset\(keyboardInsetFromEvent\(event\)\)/);
    expect(code).toMatch(/keyboardDidHide"[\s\S]*?setInset\(0\)/);
  });
});
