import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * T395 source-level contract for the Android rewind hook.
 *
 * `use-rewind-to-here.ts` imports `react` and the shared domain package but
 * never `react-native`, so it parses here — but a hook cannot be CALLED
 * outside a renderer and this workspace has none (any import graph that
 * reaches `react-native` dies on a RolldownError, which rules out
 * `@testing-library/react-native`). Everything worth executing lives in
 * `./rewind-sheet-model.ts`, `./undone-turns.ts` and `frontend-core`'s own
 * `RewindController` test; what this file pins are the properties a render
 * pass would otherwise be the only witness to.
 */
function readCode(): string {
  return readFileSync(fileURLToPath(new URL("./use-rewind-to-here.ts", import.meta.url)), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");
}

describe("T395 Android useRewindToHere", () => {
  it("drives the platform-neutral controller rather than framing its own request", () => {
    const source = readCode();
    expect(source).toMatch(/new rewind\.RewindController\(client\)/);
    expect(source).toMatch(/controller\s*\n?\s*\.rewind\(/);
    // The force override is a second, explicit request — never a default.
    expect(source).toMatch(/force: true/);
  });

  it("resolves a rewind target from a user-message row and requires a daemon id", () => {
    const source = readCode();
    expect(source).toMatch(/entry\.kind !== "user-message"/);
    expect(source).toMatch(/entry\.messageId \?\? entry\.clientMessageId/);
  });

  it("refuses to send while a turn is in flight or a request is already away", () => {
    expect(readCode()).toMatch(
      /if \(!target \|\| !controller \|\| turnRunning \|\| status === "submitting"\) return;/,
    );
  });

  it("drops a response that lands after the sheet closed or the session changed", () => {
    const source = readCode();
    expect(source).toMatch(/runRef\.current \+= 1;/);
    expect(source).toMatch(/if \(runRef\.current !== run\) return;/);
  });

  it("records the rewound-to turn locally only on success, and tells the caller to re-read", () => {
    const source = readCode();
    expect(source).toMatch(/outcome\.status === "success"/);
    expect(source).toMatch(/addUndoneTurn\(current, buildUndoneTurn\(nextTarget, nextMode\)\)/);
    expect(source).toMatch(/onRewoundRef\.current\?\.\(\)/);
  });

  it("resets the sheet and the local record when the session changes", () => {
    expect(readCode()).toMatch(/\}, \[sessionId\]\);/);
  });

  it("imports nothing from react-native or expo, so its logic stays renderer-free", () => {
    const source = readCode();
    expect(source).not.toMatch(/react-native/);
    expect(source).not.toMatch(/expo-/);
  });
});
