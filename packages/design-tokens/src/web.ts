/**
 * @picompanion/design-tokens — web output (plan.md §10.2, §6).
 *
 * Converts the token source of truth into CSS custom properties. Web
 * components must read tokens through `var(--...)`, never through raw hex
 * literals or numeric magic values.
 */

import {
  type BreakpointTokens,
  type ColorScheme,
  type ColorTokens,
  type ElevationTokens,
  type MotionTokens,
  type RadiiTokens,
  type ShadowTokens,
  type SpacingTokens,
  type StatusTone,
  type TypographyTokens,
  breakpoints,
  darkHighContrastTheme,
  darkTheme,
  elevation,
  lightHighContrastTheme,
  lightTheme,
  motion,
  reducedMotion,
  spacing,
  radii,
  typography,
} from "./tokens.js";

function toKebabCase(key: string): string {
  return key.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();
}

/** Turns a token name into its CSS custom property name, e.g. `colorAccent` -> `--color-accent`. */
export function cssVarName(name: string): string {
  return `--${toKebabCase(name)}`;
}

/** Wraps a token name in `var(...)` for direct use in CSS-in-JS or stylesheets. */
export function cssVar(name: string): string {
  return `var(${cssVarName(name)})`;
}

function colorDeclarations(colors: ColorTokens): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(colors)) {
    if (key === "status" || key === "code") continue;
    out[cssVarName(`color-${key}`)] = value as string;
  }
  for (const [tone, value] of Object.entries(colors.status) as Array<[string, StatusTone]>) {
    for (const [prop, hex] of Object.entries(value) as Array<[string, string]>) {
      out[cssVarName(`status-${tone}-${prop}`)] = hex;
    }
  }
  const { syntax, ...codeRest } = colors.code;
  for (const [key, value] of Object.entries(codeRest)) {
    out[cssVarName(`code-${key}`)] = value;
  }
  for (const [key, value] of Object.entries(syntax)) {
    out[cssVarName(`syntax-${key}`)] = value;
  }
  return out;
}

function typographyDeclarations(tokens: TypographyTokens): Record<string, string> {
  const out: Record<string, string> = {};
  out[cssVarName("font-family-sans")] = tokens.fontFamily.sans;
  out[cssVarName("font-family-mono")] = tokens.fontFamily.mono;
  for (const [key, value] of Object.entries(tokens.fontSize)) {
    out[cssVarName(`font-size-${key}`)] = `${value / 16}rem`;
  }
  for (const [key, value] of Object.entries(tokens.fontWeight)) {
    out[cssVarName(`font-weight-${key}`)] = String(value);
  }
  for (const [key, value] of Object.entries(tokens.lineHeight)) {
    out[cssVarName(`line-height-${key}`)] = String(value);
  }
  for (const [key, value] of Object.entries(tokens.letterSpacing)) {
    out[cssVarName(`letter-spacing-${key}`)] = `${value}em`;
  }
  return out;
}

function spacingDeclarations(tokens: SpacingTokens): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(tokens)) {
    out[cssVarName(`spacing-${key}`)] = `${value / 16}rem`;
  }
  return out;
}

function radiiDeclarations(tokens: RadiiTokens): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(tokens)) {
    out[cssVarName(`radius-${key}`)] = value >= 9999 ? "9999px" : `${value / 16}rem`;
  }
  return out;
}

function shadowDeclarations(tokens: ShadowTokens): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(tokens)) {
    out[cssVarName(`shadow-${key}`)] = value;
  }
  return out;
}

function elevationDeclarations(tokens: ElevationTokens): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, level] of Object.entries(tokens)) {
    out[cssVarName(`elevation-${key}`)] =
      level.opacity === 0
        ? "none"
        : `0 ${level.offsetY}px ${level.blurRadius}px rgba(0, 0, 0, ${level.opacity})`;
  }
  return out;
}

function motionDeclarations(tokens: MotionTokens): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(tokens.duration)) {
    out[cssVarName(`motion-duration-${key}`)] = `${value}ms`;
  }
  for (const [key, value] of Object.entries(tokens.easing)) {
    out[cssVarName(`motion-easing-${key}`)] = `cubic-bezier(${value.join(", ")})`;
  }
  return out;
}

function breakpointDeclarations(tokens: BreakpointTokens): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(tokens)) {
    out[cssVarName(`breakpoint-${key}`)] = `${value}px`;
  }
  return out;
}

function renderBlock(selector: string, declarations: Record<string, string>): string {
  const body = Object.entries(declarations)
    .map(([name, value]) => `  ${name}: ${value};`)
    .join("\n");
  return `${selector} {\n${body}\n}`;
}

/**
 * Platform-independent (theme-independent) tokens: typography, spacing,
 * radii, elevation, breakpoints, and the standard motion tokens. Emitted
 * once under `:root`.
 */
export function generateBaseCss(): string {
  const declarations: Record<string, string> = {
    ...typographyDeclarations(typography),
    ...spacingDeclarations(spacing),
    ...radiiDeclarations(radii),
    ...elevationDeclarations(elevation),
    ...breakpointDeclarations(breakpoints),
    ...motionDeclarations(motion),
  };
  return renderBlock(":root", declarations);
}

/** Reduced-motion override, scoped to `prefers-reduced-motion: reduce`. */
export function generateReducedMotionCss(): string {
  return `@media (prefers-reduced-motion: reduce) {\n${renderBlock(
    ":root",
    motionDeclarations(reducedMotion),
  )}\n}`;
}

const colorSchemeSelectors: Record<ColorScheme, string> = {
  light: '[data-theme="light"]',
  dark: '[data-theme="dark"]',
};

/**
 * Full stylesheet: base tokens, light/dark theme color blocks (scoped by
 * `data-theme`), high-contrast overrides (scoped by `data-theme` +
 * `data-contrast="high"`), and the reduced-motion media query.
 *
 * Consumers apply `data-theme="light|dark"` on `<html>` (or another
 * ancestor) and `data-contrast="high"` when the platform requests more
 * contrast.
 */
export function generateThemeCss(): string {
  const blocks = [
    generateBaseCss(),
    renderBlock(colorSchemeSelectors.light, {
      ...colorDeclarations(lightTheme.colors),
      ...shadowDeclarations(lightTheme.shadows),
    }),
    renderBlock(colorSchemeSelectors.dark, {
      ...colorDeclarations(darkTheme.colors),
      ...shadowDeclarations(darkTheme.shadows),
    }),
    renderBlock(
      `${colorSchemeSelectors.light}[data-contrast="high"]`,
      colorDeclarations(lightHighContrastTheme.colors),
    ),
    renderBlock(
      `${colorSchemeSelectors.dark}[data-contrast="high"]`,
      colorDeclarations(darkHighContrastTheme.colors),
    ),
    generateReducedMotionCss(),
  ];
  return blocks.join("\n\n");
}

/** Media query string for the "wide" breakpoint, e.g. `(min-width: 720px)`. */
export function wideBreakpointMediaQuery(): string {
  return `(min-width: ${breakpoints.wide}px)`;
}
