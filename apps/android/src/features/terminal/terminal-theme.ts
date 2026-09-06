import { nativeFontFamily, type NativeTheme } from "@picompanion/design-tokens";

/**
 * Terminal theming (T35B1, plan.md §10.1 "Beautiful UI is the visual
 * language of the entire product").
 *
 * `xterm.js`'s `ITheme` shape (the object a `Terminal` instance is
 * constructed or `.options.theme`-assigned with) is background,
 * foreground, cursor, selection, and sixteen named ANSI slots, every one
 * of them a plain color string. This module builds exactly that shape —
 * but every value traces back to a `NativeTheme` field from
 * `@picompanion/design-tokens`, never a literal. There is no ANSI-palette
 * token group in `design-tokens` today (grepped — none exists), so this
 * is a deliberate *mapping* of the existing Beautiful UI semantic roles
 * onto the sixteen ANSI slots a terminal needs, not an invented palette:
 * every field below is a direct reference to a `theme.colors.*` (or
 * `theme.typography`) value, so re-theming (light/dark/high-contrast,
 * or any future palette edit under `packages/design-tokens`) repaints
 * the terminal automatically with no change here.
 *
 * `theme.colors.code` (already Beautiful UI's code-block/diff surface —
 * see `packages/design-tokens/src/tokens.ts`'s `CodeDiffColors`) is the
 * natural terminal-shaped surface: `codeBackground`/`codeForeground` are
 * already a monospace-content background/foreground pair, and
 * `code.syntax.*` already carries eight more distinct, theme-aware hues
 * this mapping borrows for the ANSI slots that aren't `status`/`tone`
 * roles.
 */
export interface TerminalAnsiPalette {
  readonly black: string;
  readonly red: string;
  readonly green: string;
  readonly yellow: string;
  readonly blue: string;
  readonly magenta: string;
  readonly cyan: string;
  readonly white: string;
  readonly brightBlack: string;
  readonly brightRed: string;
  readonly brightGreen: string;
  readonly brightYellow: string;
  readonly brightBlue: string;
  readonly brightMagenta: string;
  readonly brightCyan: string;
  readonly brightWhite: string;
}

export interface TerminalTheme extends TerminalAnsiPalette {
  readonly background: string;
  readonly foreground: string;
  readonly cursor: string;
  readonly cursorAccent: string;
  readonly selectionBackground: string;
  /** RN font family name for the embedded WebView's terminal font, e.g. `"GeistMono_400Regular"`. */
  readonly fontFamily: string;
}

/** Builds an `xterm.js`-shaped theme object from `@picompanion/design-tokens` alone. */
export function buildTerminalTheme(theme: NativeTheme): TerminalTheme {
  const { colors } = theme;
  const { syntax } = colors.code;
  return {
    background: colors.code.codeBackground,
    foreground: colors.code.codeForeground,
    cursor: colors.accent,
    cursorAccent: colors.page,
    selectionBackground: colors["accent-tint"],
    fontFamily: nativeFontFamily("mono", "regular"),

    black: colors.ink,
    red: colors.status.danger.icon,
    green: colors.status.success.icon,
    yellow: colors.status.warning.icon,
    blue: colors.accent,
    magenta: syntax.keyword,
    cyan: syntax.function,
    white: colors["ink-3"],

    brightBlack: colors["ink-2"],
    brightRed: colors.red,
    brightGreen: colors.green,
    brightYellow: colors.orange,
    brightBlue: colors.link,
    brightMagenta: syntax.type,
    brightCyan: syntax.number,
    brightWhite: colors.textInverse,
  };
}
