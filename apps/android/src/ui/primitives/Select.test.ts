import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * UI-A2 source-level contract for `Select.tsx`. The primitive imports
 * `react-native`, so it cannot render under this workspace's plain
 * `vitest` setup (the same constraint `Sheet.test.ts`'s doc comment
 * names); `readCode()` strips comments first, so a claim made only in a
 * doc comment can never satisfy an assertion.
 *
 * Before this task, `Select` opened its option list inside a React
 * Native `<Modal>` — a second native Android `Window` that competed
 * with the composer's `TextInput` for IME focus whenever a `Select`
 * (via `ModelThinkingPicker`/`QueueModePicker`) opened from inside
 * `PromptControlsMenu`'s own `Sheet`. This file pins the fix (no
 * `Modal`, built on `Sheet` instead) and every piece of the pre-existing
 * public contract `ModelThinkingPicker.tsx`/`QueueModePicker.tsx`'s own
 * doc comments quote, so a regression back to `Modal` — or a silent
 * drift in the trigger/option accessibility contract those two files
 * depend on — fails here first.
 */
function readSource(): string {
  return readFileSync(fileURLToPath(new URL("./Select.tsx", import.meta.url)), "utf8");
}

function readCode(): string {
  return readSource()
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");
}

describe("Select: no detached Modal, built on Sheet instead (UI-A2)", () => {
  it("imports nothing named Modal from react-native", () => {
    expect(readCode()).not.toMatch(/\bModal\b/);
  });

  it("imports Sheet from the sibling primitive, and renders the option list through it", () => {
    const code = readCode();
    expect(code).toMatch(/import \{ Sheet \} from "\.\/Sheet";/);
    expect(code).toMatch(/<Sheet\b/);
  });

  it("gives the sheet the field's own label as its required title", () => {
    expect(readCode()).toMatch(/<Sheet\s+open=\{open\}\s+title=\{label\}/);
  });
});

describe("Select: the trigger's contract is unchanged (quoted by ModelThinkingPicker.tsx/QueueModePicker.tsx)", () => {
  it("is a real button with the current value in its accessible name", () => {
    const code = readCode();
    expect(code).toMatch(/accessibilityRole="button"/);
    expect(code).toMatch(
      /accessibilityLabel=\{`\$\{label\}: \$\{current\?\.label \?\? "Not selected"\}`\}/,
    );
    expect(code).toMatch(/accessibilityHint="Opens a list of options"/);
  });

  it("shows Select… on the trigger's own face until a value is chosen", () => {
    expect(readCode()).toMatch(/\{current\?\.label \?\? "Select…"\}/);
  });

  it("declares the trigger's 48dp touch target under the exact key ModelThinkingPicker.tsx quotes", () => {
    const code = readCode();
    const triggerStyle = /trigger: \{\s*minHeight: 48,/;
    expect(code).toMatch(triggerStyle);
  });
});

describe("Select: every option row keeps its menuitem contract and 48dp target", () => {
  it("marks each row a menuitem, names it, and states which one is selected", () => {
    const code = readCode();
    expect(code).toMatch(/accessibilityRole="menuitem"/);
    expect(code).toMatch(/accessibilityState=\{\{ selected: option\.value === value \}\}/);
    expect(code).toMatch(/accessibilityLabel=\{option\.label\}/);
  });

  it("closes the sheet and reports the tapped option's own value, in that order", () => {
    expect(readCode()).toMatch(
      /onPress=\{\(\) => \{\s*onValueChange\(option\.value\);\s*setOpen\(false\);\s*\}\}/,
    );
  });

  it("declares the option row's 48dp touch target under the exact key ModelThinkingPicker.tsx quotes", () => {
    expect(readCode()).toMatch(/menuItem: \{ minHeight: 48,/);
  });
});

describe("Select: reads every colour from the theme and hardcodes no product colour", () => {
  it("calls useTheme() and never a raw hex or rgba literal", () => {
    const code = readCode();
    expect(code).toMatch(/useTheme\(\)/);
    expect(code).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(code).not.toMatch(/rgba?\(/);
  });
});
