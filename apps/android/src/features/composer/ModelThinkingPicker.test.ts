import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * `ModelThinkingPicker.tsx` imports `react-native` (via `Select` from
 * `../../ui/primitives`), which cannot be rendered under this
 * workspace's plain `vitest` setup — the RolldownError on
 * `node_modules/react-native/index.js:1:0`, proven 27+ times across
 * this codebase (see `../sessions/session-tree-sheet.test.ts`'s doc
 * comment for the identical constraint and the `readCode()`/
 * `readComponentCode()` pattern this file copies). All real logic
 * (availability derivation, current-selection labels, thinking-option
 * derivation, the round trip) already has render-free behavioural proof
 * in `./model-thinking-model.test.ts`; this file only proves the `.tsx`
 * actually wires that into the render tree — the unavailable-state
 * gate, the always-visible summary line, both `Select`s' wiring, and
 * the error/notice rows — rather than silently dropping any of it.
 *
 * `readComponentCode()` anchors every assertion below to the one
 * top-level `ModelThinkingPicker` function (CLAUDE.md's "a sibling
 * occurrence of the same code satisfying a whole-file toMatch" defect
 * class) — this file declares no second top-level function today, but
 * the anchor costs nothing and stops that defect class from ever
 * silently reappearing.
 *
 * Every assertion below was mutation-checked by hand (delete the real
 * construct, re-run this file, confirm the specific `it` fails, restore
 * byte-identically). See this task's (T39B) report for the run log.
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

describe("ModelThinkingPicker: composes only already-audited primitives, no bespoke Pressable", () => {
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

  it("never renders a Select at all while unavailable (the early return has no Select in its branch)", () => {
    const code = readComponentCode();
    const earlyReturnBranch = code.slice(
      code.indexOf('if (state.availability !== "ready") {'),
      code.indexOf("const modelOptions"),
    );
    expect(earlyReturnBranch).not.toMatch(/<Select\b/);
  });
});

describe("ModelThinkingPicker: the current selection is visible without opening either picker", () => {
  it("renders a summary line built from the model's own currentModelLabel/currentThinkingLabel, not inline derivation", () => {
    const code = readComponentCode();
    expect(code).toMatch(/testID=\{`\$\{testId\}-summary`\}/);
    expect(code).toMatch(
      /\{`Model: \$\{currentModelLabel\(state\)\} · Thinking: \$\{currentThinkingLabel\(state\)\}`\}/,
    );
  });
});

describe("ModelThinkingPicker: the model Select is wired to onSelectModel with the tapped option's raw value", () => {
  it("passes state.models mapped to {value, label} as the model Select's options", () => {
    expect(readComponentCode()).toMatch(
      /const modelOptions: SelectOption\[\] = state\.models\.map\(\(model\) => \(\{\s*\n\s*value: model\.id,\s*\n\s*label: model\.label,\s*\n\s*\}\)\);/,
    );
  });

  it("the model Select's value is state.modelId, and onValueChange is onSelectModel directly (no wrapper)", () => {
    const code = readComponentCode();
    expect(code).toMatch(/label="Model"\s*\n\s*options=\{modelOptions\}/);
    expect(code).toMatch(/value=\{state\.modelId \?\? ""\}/);
    expect(code).toMatch(/onValueChange=\{onSelectModel\}/);
  });
});

describe("ModelThinkingPicker: the thinking Select maps the sentinel default value back to null", () => {
  it("derives its options via the model's own thinkingOptionsForSelection, never a private re-derivation", () => {
    expect(readComponentCode()).toMatch(
      /const \{ options: thinkingOptions, unsupportedReason \} = thinkingOptionsForSelection\(state\);/,
    );
  });

  it("shows unsupportedReason's text instead of a Select whenever it is non-null", () => {
    const code = readComponentCode();
    expect(code).toMatch(/\{unsupportedReason \? \(/);
    expect(code).toMatch(/testID=\{`\$\{testId\}-thinking-unavailable`\}/);
  });

  it("prepends a Default option, and the current value falls back to the sentinel exactly when thinkingOptionId is null", () => {
    const code = readComponentCode();
    expect(code).toMatch(
      /\{ value: DEFAULT_THINKING_VALUE, label: "Default" \},\s*\n\s*\.\.\.thinkingOptions\.map/,
    );
    expect(code).toMatch(
      /const thinkingValue = state\.thinkingOptionId \?\? DEFAULT_THINKING_VALUE;/,
    );
  });

  it("maps the sentinel value back to null before calling onSelectThinking, and passes any real id straight through", () => {
    expect(readComponentCode()).toMatch(
      /onSelectThinking\(value === DEFAULT_THINKING_VALUE \? null : value\)/,
    );
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
