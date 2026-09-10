import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * T354 source-level contract for `SessionControlsPicker.tsx`. It
 * imports `react-native` (directly, and via `Toggle`), so it cannot
 * render under this workspace's plain `vitest` setup — the same
 * constraint `./ModelThinkingPicker.test.ts`'s header documents at
 * length, with the same `readCode()` treatment.
 *
 * Every behaviour worth arguing about already has render-free proof by
 * execution in `./session-controls-model.test.ts`. What these cases pin
 * is that the view actually draws it: the unavailable gate, the
 * always-visible summary, the segments' selected state and their
 * accessible role, the switch's `null`-means-unknown branch, and the
 * error/notice rows.
 *
 * `readCode()` strips comments first, so a claim made only in a doc
 * comment can never satisfy an assertion below.
 */
function readCode(): string {
  return readFileSync(
    fileURLToPath(new URL("./SessionControlsPicker.tsx", import.meta.url)),
    "utf8",
  )
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");
}

describe("SessionControlsPicker source", () => {
  it("renders the model's own truthful sentence instead of an enabled control that can only fail", () => {
    const code = readCode();
    expect(code).toMatch(/if \(state\.availability !== "ready"\)/);
    expect(code).toMatch(/\{state\.unavailableReason\}|state\.unavailableReason;/);
    expect(code).toMatch(/testID=\{`\$\{testId\}-unavailable`\}/);
  });

  it("shows the current mode and compaction reading without opening anything", () => {
    const code = readCode();
    expect(code).toMatch(/currentModeLabel\(state\)/);
    expect(code).toMatch(/describeAutoCompaction\(state\.autoCompaction\)/);
    expect(code).toMatch(/testID=\{`\$\{testId\}-summary`\}/);
  });

  it("draws one segment per provider-reported mode, never a hardcoded Build/Plan pair", () => {
    const code = readCode();
    expect(code).toMatch(/state\.modes\.map\(\(mode\)/);
    expect(code).not.toMatch(/"Build"/);
    expect(code).not.toMatch(/"Plan"/);
  });

  it("makes the one-of-N choice a radio group, so the accent tint is never the only signal", () => {
    const code = readCode();
    expect(code).toMatch(/accessibilityRole="radiogroup"/);
    expect(code).toMatch(/accessibilityRole="radio"/);
    expect(code).toMatch(/accessibilityState=\{\{ selected/);
  });

  it("keeps a 48dp reach around a pill the artifact draws small", () => {
    expect(readCode()).toMatch(/hitSlop=\{14\}/);
  });

  it("locks the segments while a mode change is in flight", () => {
    const code = readCode();
    expect(code).toMatch(/disabled=\{state\.isChangingMode\}/);
  });

  it("says unknown rather than drawing a switch in a position nobody has confirmed", () => {
    const code = readCode();
    expect(code).toMatch(/state\.autoCompaction === null \?/);
    expect(code).toMatch(/testID=\{`\$\{testId\}-auto-compaction-unknown`\}/);
  });

  it("wires the switch to the controller and locks it mid-write", () => {
    const code = readCode();
    expect(code).toMatch(/<Toggle\b/);
    expect(code).toMatch(/checked=\{state\.autoCompaction\}/);
    expect(code).toMatch(/onCheckedChange=\{onSetAutoCompaction\}/);
    expect(code).toMatch(/disabled=\{state\.isChangingAutoCompaction\}/);
  });

  it("surfaces a failed change and a provider notice rather than swallowing either", () => {
    const code = readCode();
    expect(code).toMatch(/\{state\.changeError\}/);
    expect(code).toMatch(/\{state\.notice\.message\}/);
  });

  it("reads every colour from the theme and hardcodes no product colour", () => {
    const code = readCode();
    expect(code).toMatch(/useTheme\(\)/);
    expect(code).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(code).not.toMatch(/rgba?\(/);
  });
});
