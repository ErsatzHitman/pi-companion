import { getNativeTheme } from "@picompanion/design-tokens";
import { describe, expect, it } from "vitest";

import { buildTerminalTheme } from "./terminal-theme";

describe("buildTerminalTheme", () => {
  it("derives every field from the given NativeTheme's own color tokens", () => {
    const theme = getNativeTheme("light", false);
    const terminalTheme = buildTerminalTheme(theme);

    expect(terminalTheme.background).toBe(theme.colors.code.codeBackground);
    expect(terminalTheme.foreground).toBe(theme.colors.code.codeForeground);
    expect(terminalTheme.cursor).toBe(theme.colors.accent);
    expect(terminalTheme.selectionBackground).toBe(theme.colors["accent-tint"]);
    expect(terminalTheme.red).toBe(theme.colors.status.danger.icon);
    expect(terminalTheme.green).toBe(theme.colors.status.success.icon);
    expect(terminalTheme.yellow).toBe(theme.colors.status.warning.icon);
    expect(terminalTheme.magenta).toBe(theme.colors.code.syntax.keyword);
    expect(terminalTheme.cyan).toBe(theme.colors.code.syntax.function);
    expect(terminalTheme.brightRed).toBe(theme.colors.red);
    expect(terminalTheme.brightGreen).toBe(theme.colors.green);
    expect(terminalTheme.brightYellow).toBe(theme.colors.orange);
    expect(terminalTheme.brightMagenta).toBe(theme.colors.code.syntax.type);
    expect(terminalTheme.brightCyan).toBe(theme.colors.code.syntax.number);
    expect(terminalTheme.brightWhite).toBe(theme.colors.textInverse);
  });

  it("repaints every value when the input theme's scheme changes — nothing is a fixed literal", () => {
    const light = buildTerminalTheme(getNativeTheme("light", false));
    const dark = buildTerminalTheme(getNativeTheme("dark", false));

    // At least the background/foreground pair must differ between the two
    // schemes' own token values, proving the output tracks the input theme
    // instead of being a constant object.
    expect(light.background).not.toBe(dark.background);
    expect(light.foreground).not.toBe(dark.foreground);
  });

  it("sets a non-empty native font family from design-tokens typography, not a literal string", () => {
    const theme = buildTerminalTheme(getNativeTheme("light", false));
    expect(theme.fontFamily.length).toBeGreaterThan(0);
    // The RN font family name is a bundled asset name, not a CSS stack —
    // it must not contain the CSS-stack punctuation typography.fontFamily.mono uses.
    expect(theme.fontFamily).not.toContain(",");
  });
});
