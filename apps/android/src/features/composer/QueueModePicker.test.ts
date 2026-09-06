import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * `QueueModePicker.tsx` imports `react-native` (via `Select` from
 * `../../ui/primitives`), which cannot be rendered under this
 * workspace's plain `vitest` setup — the RolldownError on
 * `node_modules/react-native/index.js:1:0`, proven 27+ times across this
 * codebase (see `./ModelThinkingPicker.test.ts`'s identical constraint
 * and the `readCode()`/`readComponentCode()` pattern this file copies).
 * All real logic (availability derivation, mode labels, the round trip)
 * already has render-free behavioural proof in `./queue-mode-model.test.ts`;
 * this file only proves the `.tsx` actually wires that into the render
 * tree — the unavailable-state gate, the always-visible summary line,
 * both `Select`s' wiring, and the error/notice rows — rather than
 * silently dropping any of it.
 *
 * `readComponentCode()` anchors every assertion below to the one
 * top-level `QueueModePicker` function (CLAUDE.md's "a sibling
 * occurrence of the same code satisfying a whole-file toMatch" defect
 * class).
 *
 * Every assertion below was mutation-checked by hand (delete the real
 * construct, re-run this file, confirm the specific `it` fails, restore
 * byte-identically). See this task's (T39C) report for the run log.
 */
function readSource(): string {
  return readFileSync(fileURLToPath(new URL("./QueueModePicker.tsx", import.meta.url)), "utf8");
}

function readCode(): string {
  return readSource()
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");
}

/** Slices `readCode()` down to the one top-level `function QueueModePicker(...)` declaration. */
function readComponentCode(): string {
  const code = readCode();
  const body = code
    .split(/^(?:export default |export )?function /m)
    .map((part) => `function ${part}`)
    .find((part) => part.startsWith("function QueueModePicker("));
  expect(
    body,
    "QueueModePicker.tsx should declare a top-level function QueueModePicker",
  ).toBeDefined();
  return body ?? "";
}

describe("QueueModePicker: composes only already-audited primitives, no bespoke Pressable", () => {
  it("declares no raw Pressable/Touchable* of its own", () => {
    const code = readCode();
    expect(code).not.toMatch(/<(Pressable|TouchableOpacity|TouchableHighlight)\b/);
  });

  it("imports Select from ../../ui/primitives, the component already in touch-targets.test.ts's 48dp audit", () => {
    expect(readCode()).toMatch(
      /import \{ Select, type SelectOption \} from "\.\.\/\.\.\/ui\/primitives";/,
    );
  });
});

describe("QueueModePicker: a truthful unavailable/loading state, never an enabled control", () => {
  it('gates the whole ready-state render behind state.availability !== "ready"', () => {
    expect(readComponentCode()).toMatch(/if \(state\.availability !== "ready"\) \{/);
  });

  it("renders state.unavailableReason's own text, never a hand-typed fallback string, for a non-loading unavailable state", () => {
    const code = readComponentCode();
    expect(code).toMatch(
      /const label =\s*\n\s*state\.availability === "loading" \? "Loading queue mode…" : state\.unavailableReason;/,
    );
    expect(code).toMatch(/testID=\{`\$\{testId\}-unavailable`\}>\s*\{label\}/);
  });

  it("never renders a Select at all while unavailable (the early return has no Select in its branch)", () => {
    const code = readComponentCode();
    const earlyReturnBranch = code.slice(
      code.indexOf('if (state.availability !== "ready") {'),
      code.indexOf("const steeringValue"),
    );
    expect(earlyReturnBranch).not.toMatch(/<Select\b/);
  });
});

describe("QueueModePicker: the current value is visible without opening either menu", () => {
  it("renders a summary line built from the model's own queueModeLabel, not inline derivation", () => {
    const code = readComponentCode();
    expect(code).toMatch(/testID=\{`\$\{testId\}-summary`\}/);
    expect(code).toMatch(
      /\{`Steering: \$\{queueModeLabel\(state\.steeringMode\)\} · Follow-up: \$\{queueModeLabel\(state\.followUpMode\)\}`\}/,
    );
  });
});

describe("QueueModePicker: no cancel/reorder affordance", () => {
  it("offers no button at all beyond the two Selects — no cancel/reorder/remove wording anywhere in source", () => {
    const code = readCode();
    expect(code).not.toMatch(/cancel|reorder|remove\b/i);
  });
});

describe("QueueModePicker: both Selects are wired to their own handler with the tapped option's raw mode", () => {
  it("the steering Select's value falls back to the not-reported sentinel exactly when steeringMode is null", () => {
    const code = readComponentCode();
    expect(code).toMatch(/const steeringValue = state\.steeringMode \?\? NOT_REPORTED_VALUE;/);
    expect(code).toMatch(/label="Steering queue delivery"/);
  });

  it("the steering Select only forwards a real QueueMode literal to onSelectSteeringMode", () => {
    expect(readComponentCode()).toMatch(
      /if \(value === "all" \|\| value === "one-at-a-time"\) onSelectSteeringMode\(value\);/,
    );
  });

  it("the follow-up Select's value falls back to the not-reported sentinel exactly when followUpMode is null", () => {
    const code = readComponentCode();
    expect(code).toMatch(/const followUpValue = state\.followUpMode \?\? NOT_REPORTED_VALUE;/);
    expect(code).toMatch(/label="Follow-up queue delivery"/);
  });

  it("the follow-up Select only forwards a real QueueMode literal to onSelectFollowUpMode", () => {
    expect(readComponentCode()).toMatch(
      /if \(value === "all" \|\| value === "one-at-a-time"\) onSelectFollowUpMode\(value\);/,
    );
  });
});

describe("QueueModePicker: change error and provider notice rows", () => {
  it("renders state.changeError only when set, never unconditionally", () => {
    const code = readComponentCode();
    expect(code).toMatch(/\{state\.changeError \? \(/);
    expect(code).toMatch(/testID=\{`\$\{testId\}-change-error`\}/);
  });

  it("renders state.steeringNotice.message only when a notice is present", () => {
    const code = readComponentCode();
    expect(code).toMatch(/\{state\.steeringNotice \? \(/);
    expect(code).toMatch(/\{state\.steeringNotice\.message\}/);
  });

  it("renders state.followUpNotice.message only when a notice is present", () => {
    const code = readComponentCode();
    expect(code).toMatch(/\{state\.followUpNotice \? \(/);
    expect(code).toMatch(/\{state\.followUpNotice\.message\}/);
  });
});
