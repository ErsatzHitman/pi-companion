import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * `SlashCommandPicker.tsx` imports `react-native` (via `Button` from
 * `../../ui/primitives`), which cannot be rendered under this
 * workspace's plain `vitest` setup — the RolldownError on
 * `node_modules/react-native/index.js:1:0`, proven 27+ times across
 * this codebase (see `./ModelThinkingPicker.test.ts`'s doc comment for
 * the identical constraint and the `readCode()`/`readComponentCode()`
 * pattern this file copies). All real logic (the trigger rule, the
 * daemon-sourced list, the "no client yet" degrade, "never blocks a
 * send") already has render-free behavioural proof in
 * `slash-command-model.test.ts`; this file only proves the `.tsx`
 * actually wires that into the render tree, and proves the specific
 * safety properties this task's brief calls out: no `Modal`, composed
 * only from already-audited primitives, and a command list built from
 * `state.commands` rather than any hard-coded array.
 *
 * Every assertion below was mutation-checked by hand (delete the real
 * construct, re-run this file, confirm the specific `it` fails, restore
 * byte-identically). See this task's (T292) report for the run log.
 */
function readSource(): string {
  return readFileSync(fileURLToPath(new URL("./SlashCommandPicker.tsx", import.meta.url)), "utf8");
}

function readCode(): string {
  return readSource()
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");
}

/** Slices `readCode()` down to the one top-level `function SlashCommandPicker(...)` declaration. */
function readComponentCode(): string {
  const code = readCode();
  const body = code
    .split(/^(?:export default |export )?function /m)
    .map((part) => `function ${part}`)
    .find((part) => part.startsWith("function SlashCommandPicker("));
  expect(
    body,
    "SlashCommandPicker.tsx should declare a top-level function SlashCommandPicker",
  ).toBeDefined();
  return body ?? "";
}

describe("SlashCommandPicker: no Modal, no bespoke Pressable — plan.md §9.3 keyboard ownership", () => {
  it("renders no <Modal> element and does not import Modal from react-native", () => {
    const code = readCode();
    expect(code).not.toMatch(/<Modal\b/);
    const reactNativeImportLine = readSource()
      .split("\n")
      .find((line) => line.includes('from "react-native"'));
    expect(reactNativeImportLine).toBeDefined();
    expect(reactNativeImportLine).not.toMatch(/\bModal\b/);
  });

  it("declares no raw Pressable/Touchable* of its own", () => {
    expect(readCode()).not.toMatch(/<(Pressable|TouchableOpacity|TouchableHighlight)\b/);
  });

  it("imports Button from ../../ui/primitives, the component already in touch-targets.test.ts's 48dp audit", () => {
    expect(readCode()).toMatch(/import \{ Button \} from "\.\.\/\.\.\/ui\/primitives";/);
  });
});

describe("SlashCommandPicker: renders nothing when closed", () => {
  it("returns null before rendering anything when state.isOpen is false", () => {
    const code = readComponentCode();
    expect(code).toMatch(/if \(!state\.isOpen\) return null;/);
  });
});

describe("SlashCommandPicker: the command list comes from state.commands, never a hard-coded array", () => {
  it("maps state.commands to rows, one Button per command, keyed by the command's own name", () => {
    const code = readComponentCode();
    expect(code).toMatch(/\{state\.commands\.map\(\(command\) => \(/);
    expect(code).toMatch(/key=\{command\.name\}/);
  });

  it("builds each row's label from the command's own name and describeSlashCommand(command), not an inline literal", () => {
    const code = readComponentCode();
    expect(code).toMatch(
      /label=\{`\/\$\{command\.name\} — \$\{describeSlashCommand\(command\)\}`\}/,
    );
  });

  it("imports describeSlashCommand from ./slash-command-model rather than re-deriving the description text", () => {
    expect(readCode()).toMatch(/describeSlashCommand[\s\S]{0,80}from "\.\/slash-command-model"/);
  });
});

describe("SlashCommandPicker: dismissible without sending", () => {
  it("the Close button calls onDismiss directly, and nothing else in this file calls onSelect or onDismiss together", () => {
    const code = readComponentCode();
    expect(code).toMatch(/label="Close" onPress=\{onDismiss\}/);
    // onSelect is called exactly once, from the per-command row, with
    // that row's own command — never from the header/close row.
    const onSelectCalls = code.match(/onPress=\{\(\) => onSelect\(command\)\}/g) ?? [];
    expect(onSelectCalls).toHaveLength(1);
  });

  it("never references onSubmit/handleSend — this component has no path to sending anything itself", () => {
    const code = readCode();
    expect(code).not.toMatch(/onSubmit/);
    expect(code).not.toMatch(/handleSend/);
  });
});

describe("SlashCommandPicker: tapped rows and Close both carry distinct testIds", () => {
  it("the root, dismiss button, and each option row carry testId-derived testIDs", () => {
    const code = readComponentCode();
    expect(code).toMatch(/testID=\{testId\}/);
    expect(code).toMatch(/testId=\{`\$\{testId\}-dismiss`\}/);
    expect(code).toMatch(/testId=\{`\$\{testId\}-option-\$\{command\.name\}`\}/);
  });
});
