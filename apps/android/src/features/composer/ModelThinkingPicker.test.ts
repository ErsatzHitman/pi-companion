import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * `ModelThinkingPicker.tsx` imports `react-native`, which cannot be
 * rendered under this workspace's plain `vitest` setup — the
 * RolldownError on `node_modules/react-native/index.js:1:0`, proven
 * 27+ times across this codebase (see `../sessions/session-tree-sheet.test.ts`'s
 * doc comment for the identical constraint and the `readCode()`/
 * `readComponentCode()` pattern this file copies). All real logic
 * (availability derivation, current-selection labels, thinking-option
 * derivation, the round trip) already has render-free behavioural proof
 * in `./model-thinking-model.test.ts`; this file only proves the `.tsx`
 * actually wires that into the render tree — the unavailable-state
 * gate, the always-visible summary line, the model rows, the effort
 * segment control, and the error/notice rows — rather than silently
 * dropping any of it.
 *
 * UI-A4 rewrote this file's assertions for the `Select`-free rebuild
 * onto `docs/ui-reference/pi-companion-app.html`'s own `.pm-row`/
 * `.tick`/`.seg` shape — an inline row per model with a leading tick on
 * the selected one, and a segmented effort control whose steps beyond
 * the selected model's ceiling render disabled rather than being
 * filtered out.
 *
 * `readComponentCode()` anchors every assertion below to the one
 * top-level `ModelThinkingPicker` function (CLAUDE.md's "a sibling
 * occurrence of the same code satisfying a whole-file toMatch" defect
 * class).
 */
function readSource(): string {
  return readFileSync(fileURLToPath(new URL("./ModelThinkingPicker.tsx", import.meta.url)), "utf8");
}

function readCode(): string {
  return readSource()
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");
}

/** Slices `readCode()` down to the one top-level `function ModelThinkingPicker(...)` declaration. */
function readComponentCode(): string {
  const code = readCode();
  const body = code
    .split(/^(?:export default |export )?function /m)
    .map((part) => `function ${part}`)
    .find((part) => part.startsWith("function ModelThinkingPicker("));
  expect(
    body,
    "ModelThinkingPicker.tsx should declare a top-level function ModelThinkingPicker",
  ).toBeDefined();
  return body ?? "";
}

describe("ModelThinkingPicker: rebuilt off pm-row/tick/seg, no Select left", () => {
  it("imports no Select from ../../ui/primitives", () => {
    expect(readCode()).not.toMatch(/from "\.\.\/\.\.\/ui\/primitives"/);
  });

  it("declares its own Pressable rows, each a real accessibility button", () => {
    expect(readCode()).toMatch(/accessibilityRole="button"/);
  });
});

describe("ModelThinkingPicker: a truthful unavailable/loading state, never an enabled control", () => {
  it('gates the whole ready-state render behind state.availability !== "ready"', () => {
    expect(readComponentCode()).toMatch(/if \(state\.availability !== "ready"\) \{/);
  });

  it("renders state.unavailableReason's own text, never a hand-typed fallback string, for a non-loading unavailable state", () => {
    const code = readComponentCode();
    expect(code).toMatch(
      /const label = state\.availability === "loading" \? "Loading model…" : state\.unavailableReason;/,
    );
    expect(code).toMatch(/testID=\{`\$\{testId\}-unavailable`\}>\s*\{label\}/);
  });

  it("never renders a model row at all while unavailable (the early return has no Pressable in its branch)", () => {
    const code = readComponentCode();
    const earlyReturnBranch = code.slice(
      code.indexOf('if (state.availability !== "ready") {'),
      code.indexOf("const { unsupportedReason }"),
    );
    expect(earlyReturnBranch).not.toMatch(/<Pressable\b/);
  });
});

describe("ModelThinkingPicker: the current selection is visible without opening either row's own menu", () => {
  it("renders a summary line built from the model's own currentModelLabel/currentThinkingLabel, not inline derivation", () => {
    const code = readComponentCode();
    expect(code).toMatch(/testID=\{`\$\{testId\}-summary`\}/);
    expect(code).toMatch(
      /\{`Model: \$\{currentModelLabel\(state\)\} · Thinking: \$\{currentThinkingLabel\(state\)\}`\}/,
    );
  });
});

describe("ModelThinkingPicker: one row per model, with a leading tick on the selected row", () => {
  it("maps state.models to rows, each calling onSelectModel with that model's own id", () => {
    const code = readComponentCode();
    expect(code).toMatch(/\{state\.models\.map\(\(model\) => \{/);
    expect(code).toMatch(/onPress=\{\(\) => onSelectModel\(model\.id\)\}/);
  });

  it("a row's tick is only visible when that model is the selected one", () => {
    const code = readComponentCode();
    expect(code).toMatch(/const selected = model\.id === state\.modelId;/);
    expect(code).toMatch(/selected \? styles\.tickOn : null/);
  });

  it("a row's trailing value is that model's own thinking ceiling, never a shared/global one", () => {
    expect(readComponentCode()).toMatch(
      /const ceiling = model\.thinkingOptions\?\.\[model\.thinkingOptions\.length - 1\]\?\.label;/,
    );
  });
});

describe("ModelThinkingPicker: the effort segment shows every reachable step, disabling those past the selected model's ceiling", () => {
  it("derives its steps via the model's own thinkingOptionsForSelection for the unsupported gate, never a private re-derivation", () => {
    expect(readComponentCode()).toMatch(
      /const \{ unsupportedReason \} = thinkingOptionsForSelection\(state\);/,
    );
  });

  it("builds the segment's steps from every model's own thinking options, not only the selected model's", () => {
    expect(readComponentCode()).toMatch(/const effortSteps = allThinkingOptions\(state\.models\);/);
  });

  it("shows unsupportedReason's text instead of the segment control whenever it is non-null", () => {
    const code = readComponentCode();
    expect(code).toMatch(/\{unsupportedReason \? \(/);
    expect(code).toMatch(/testID=\{`\$\{testId\}-thinking-unavailable`\}/);
  });

  it("disables exactly the steps outside the selected model's own reachable set, rather than filtering them out", () => {
    const code = readComponentCode();
    expect(code).toMatch(
      /const reachable = reachableIds\.has\(option\.id\);/,
    );
    expect(code).toMatch(/disabled=\{!reachable\}/);
    expect(code).not.toMatch(/effortSteps\.filter/);
  });

  it("keeps a Default segment so onSelectThinking(null) stays reachable, matching the sentinel-to-null mapping the old Select used", () => {
    const code = readComponentCode();
    expect(code).toMatch(/onPress=\{\(\) => onSelectThinking\(null\)\}/);
    expect(code).toMatch(/onPress=\{\(\) => reachable && onSelectThinking\(option\.id\)\}/);
  });
});

describe("ModelThinkingPicker: change error and provider notice rows", () => {
  it("renders state.changeError only when set, never unconditionally", () => {
    const code = readComponentCode();
    expect(code).toMatch(/\{state\.changeError \? \(/);
    expect(code).toMatch(/testID=\{`\$\{testId\}-change-error`\}/);
  });

  it("renders state.thinkingNotice.message only when a notice is present", () => {
    const code = readComponentCode();
    expect(code).toMatch(/\{state\.thinkingNotice \? \(/);
    expect(code).toMatch(/\{state\.thinkingNotice\.message\}/);
  });
});
