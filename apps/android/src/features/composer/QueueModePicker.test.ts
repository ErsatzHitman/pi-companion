import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * `QueueModePicker.tsx` imports `react-native`, which cannot be
 * rendered under this workspace's plain `vitest` setup — the
 * RolldownError on `node_modules/react-native/index.js:1:0`, proven
 * 27+ times across this codebase (see `./ModelThinkingPicker.test.ts`'s
 * identical constraint and the `readCode()`/`readComponentCode()`
 * pattern this file copies). All real logic (availability derivation,
 * mode labels, the round trip) already has render-free behavioural
 * proof in `./queue-mode-model.test.ts`; this file only proves the
 * `.tsx` actually wires that into the render tree — the
 * unavailable-state gate, the always-visible summary line, both rows'
 * wiring, and the error/notice rows — rather than silently dropping
 * any of it.
 *
 * UI-A4 rewrote this file's assertions for the `Select`-free rebuild
 * onto `docs/ui-reference/pi-companion-app.html`'s own `.pm-row`
 * shape — two rows that cycle their own value in place on tap, instead
 * of two dropdown menus.
 *
 * `readComponentCode()` anchors every assertion below to the one
 * top-level `QueueModePicker` function (CLAUDE.md's "a sibling
 * occurrence of the same code satisfying a whole-file toMatch" defect
 * class).
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

describe("QueueModePicker: rebuilt off pm-row, no Select left", () => {
  it("imports no Select from ../../ui/primitives", () => {
    expect(readCode()).not.toMatch(/from "\.\.\/\.\.\/ui\/primitives"/);
  });

  it("declares its own Pressable rows, each a real accessibility button", () => {
    const code = readCode();
    expect(code.match(/<Pressable\b/g)?.length).toBe(2);
    expect(code).toMatch(/accessibilityRole="button"/);
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

  it("never renders a queue row at all while unavailable (the early return has no pm-row Pressable in its branch)", () => {
    const code = readComponentCode();
    const earlyReturnBranch = code.slice(
      code.indexOf('if (state.availability !== "ready") {'),
      code.indexOf(
        "return (\n    <View style={styles.root} testID={testId}>\n      <Text style={styles.help}>",
      ),
    );
    expect(earlyReturnBranch).not.toMatch(/<Pressable\b/);
  });
});

describe("QueueModePicker: the current value is visible without opening either row's own menu", () => {
  it("renders a summary line built from the model's own queueModeLabel, not inline derivation", () => {
    const code = readComponentCode();
    expect(code).toMatch(/testID=\{`\$\{testId\}-summary`\}/);
    expect(code).toMatch(
      /\{`Steering: \$\{queueModeLabel\(state\.steeringMode\)\} · Follow-up: \$\{queueModeLabel\(state\.followUpMode\)\}`\}/,
    );
  });

  it("each row shows its own current value as trailing text", () => {
    const code = readComponentCode();
    expect(code).toMatch(/\{queueModeLabel\(state\.steeringMode\)\} ›<\/Text>/);
    expect(code).toMatch(/\{queueModeLabel\(state\.followUpMode\)\} ›<\/Text>/);
  });
});

describe("QueueModePicker: no cancel/reorder affordance", () => {
  it("offers no button at all beyond the two cycling rows — no cancel/reorder/remove wording anywhere in source", () => {
    const code = readCode();
    expect(code).not.toMatch(/cancel|reorder|remove\b/i);
  });
});

describe("QueueModePicker: both rows cycle in place and call their own handler with the concrete next mode", () => {
  it("defines a two-value cycle shared by both rows", () => {
    expect(readCode()).toMatch(
      /function nextQueueMode\(current: QueueMode \| null\): QueueMode \{/,
    );
  });

  it("the steering row calls onSelectSteeringMode with nextQueueMode(state.steeringMode)", () => {
    expect(readComponentCode()).toMatch(
      /onPress=\{\(\) => onSelectSteeringMode\(nextQueueMode\(state\.steeringMode\)\)\}/,
    );
  });

  it("the follow-up row calls onSelectFollowUpMode with nextQueueMode(state.followUpMode)", () => {
    expect(readComponentCode()).toMatch(
      /onPress=\{\(\) => onSelectFollowUpMode\(nextQueueMode\(state\.followUpMode\)\)\}/,
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
