/**
 * WCAG AA contrast guard (T54A1, docs/issues-from-plan.md, plan.md §10.5).
 *
 * A real-browser axe run (Phase 4 batch F) found the Beautiful UI palette
 * failing WCAG AA (4.5:1 for normal text) at values as low as 2.61:1, after
 * hundreds of jsdom axe assertions never caught it — jsdom doesn't compute
 * real contrast. This file replaces "trust axe" with an explicit,
 * programmatic computation of the standard WCAG relative-luminance
 * contrast formula (https://www.w3.org/TR/WCAG21/#dfn-relative-luminance)
 * against every text-on-background pair actually painted by `apps/web` and
 * `apps/android`, in both themes, so the palette cannot regress below AA
 * again without a test failure here.
 *
 * Audited call sites (grep, 2026-09-03): `ink`/`ink-2`/`ink-3` and
 * `accent`/`accent-ink` painted as literal text color on `page`/`canvas`/
 * `surface`/`inset` (message text, muted captions, timestamps, links,
 * field labels — apps/web/src/ui/primitives/primitives.css,
 * apps/web/src/ui/recipes/recipes.css); `green`/`orange`/`red`/`accent`
 * painted as literal text on those same backgrounds (field/placeholder
 * error labels) and as `status.<tone>.foreground` on `status.<tone>.background`
 * (chip/toast/badge text, both platforms — Chip.tsx, Toast.tsx,
 * `.pc-chip--*`/`.pc-toast--*`); `accentContrast`/`textInverse` painted on
 * a solid `accent`/`red` fill (Button primary/danger — Button.tsx, both
 * platforms).
 *
 * `field` and `hover` ARE text backdrops and are audited here. An earlier
 * draft of this file excluded them on the claim that "no call site paints
 * ink-2/ink-3/accent/status tones on these backdrops"; that claim was
 * false. `apps/android/src/ui/primitives/TextField.tsx:34`,
 * `TextArea.tsx:28`, `SearchField.tsx:25`,
 * `apps/android/src/ui/recipes/CommandSearch.tsx:66` and `PromptBar.tsx:49`
 * all pass `theme.colors["ink-3"]` as `placeholderTextColor` on an input
 * whose `backgroundColor` is `theme.colors.field`. Excluding `field` let
 * dark `ink-3` ship at 4.08:1. Every text role is now measured against
 * every backdrop it could be painted on, so narrowing this matrix again
 * requires deleting an assertion rather than quietly omitting a key.
 *
 * `hover-2` is the one backdrop still excluded, and only because no call
 * site paints anything on it: `grep -rn "hover-2" apps/web/src
 * apps/android/src` returns nothing (verified 2026-09-03). It is kept in
 * the `ink`-only check below as a tripwire — if it ever becomes a real
 * backdrop, add it to TEXT_BACKDROPS.
 */
import { describe, expect, it } from "vitest";
import { darkTheme, lightTheme, type ColorTokens } from "./tokens.js";

// ---------------------------------------------------------------------------
// The standard WCAG relative-luminance / contrast-ratio formula.
// https://www.w3.org/TR/WCAG21/#dfn-relative-luminance
// ---------------------------------------------------------------------------

function hexToRgb(hex: string): [number, number, number] {
  const clean = hex.replace("#", "");
  const full =
    clean.length === 3
      ? clean
          .split("")
          .map((c) => c + c)
          .join("")
      : clean;
  const num = Number.parseInt(full.slice(0, 6), 16);
  return [(num >> 16) & 255, (num >> 8) & 255, num & 255];
}

function srgbChannelToLinear(c: number): number {
  const normalized = c / 255;
  return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
}

function relativeLuminance(rgb: [number, number, number]): number {
  const [r, g, b] = rgb.map(srgbChannelToLinear) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio between two opaque hex colors, 1:1 (none) to 21:1 (max). */
function contrastRatio(hexA: string, hexB: string): number {
  const lumA = relativeLuminance(hexToRgb(hexA));
  const lumB = relativeLuminance(hexToRgb(hexB));
  const [lighter, darker] = lumA > lumB ? [lumA, lumB] : [lumB, lumA];
  return (lighter + 0.05) / (darker + 0.05);
}

/** Parses `rgba(r, g, b, a)`; used for the dark theme's alpha-overlay tints. */
function parseRgba(value: string): { r: number; g: number; b: number; a: number } {
  const match = /rgba?\(([^)]+)\)/.exec(value);
  if (!match) throw new Error(`not an rgba() string: ${value}`);
  const parts = match[1]!.split(",").map((part) => Number.parseFloat(part.trim()));
  return { r: parts[0]!, g: parts[1]!, b: parts[2]!, a: parts[3] ?? 1 };
}

/** Composites a (possibly alpha) color over an opaque hex backdrop. */
function compositeOver(color: string, backdropHex: string): string {
  if (!color.startsWith("rgba")) return color;
  const { r, g, b, a } = parseRgba(color);
  const [br, bg, bb] = hexToRgb(backdropHex);
  const out = [a * r + (1 - a) * br, a * g + (1 - a) * bg, a * b + (1 - a) * bb];
  return `#${out.map((c) => Math.round(c).toString(16).padStart(2, "0")).join("")}`;
}

const AA_NORMAL_TEXT = 4.5;

function expectAA(label: string, foreground: string, background: string) {
  const ratio = contrastRatio(foreground, background);
  expect(
    ratio,
    `${label}: ${foreground} on ${background} = ${ratio.toFixed(2)}:1, needs ${AA_NORMAL_TEXT}:1`,
  ).toBeGreaterThanOrEqual(AA_NORMAL_TEXT);
}

/**
 * Every backdrop text is actually painted on: the plan §10.2 surface stack,
 * plus the two interactive-state fills that real call sites put text on.
 */
const TEXT_BACKDROPS: Array<
  keyof ColorTokens & ("page" | "canvas" | "surface" | "inset" | "field" | "hover")
> = ["page", "canvas", "surface", "inset", "field", "hover"];

/**
 * The subset of the above that a status chip/toast tint is composited over.
 * Chips and toasts sit in content regions, never inside a field or a hover
 * fill, so tint compositing is measured against the content backdrops only.
 */
const CONTENT_BACKDROPS: Array<keyof ColorTokens & ("page" | "canvas" | "surface" | "inset")> = [
  "page",
  "canvas",
  "surface",
  "inset",
];

const TEXT_ROLES = ["ink", "ink-2", "ink-3", "accent", "accent-ink"] as const;
const STATUS_TONES = ["green", "orange", "red"] as const;

describe.each([
  ["light", lightTheme],
  ["dark", darkTheme],
] as const)("%s theme WCAG AA contrast", (_name, theme) => {
  const colors = theme.colors;

  it("text ramp and accent roles reach 4.5:1 on every backdrop they are painted on", () => {
    for (const role of TEXT_ROLES) {
      for (const bg of TEXT_BACKDROPS) {
        expectAA(`${role} on ${bg}`, colors[role], colors[bg]);
      }
    }
  });

  it("status tone colors reach 4.5:1 as direct text (field/placeholder error labels)", () => {
    for (const tone of STATUS_TONES) {
      for (const bg of TEXT_BACKDROPS) {
        expectAA(`${tone} on ${bg}`, colors[tone], colors[bg]);
      }
    }
  });

  it("every status tone's foreground reaches 4.5:1 on its own background (chips/toasts/badges)", () => {
    for (const tone of Object.values(colors.status)) {
      // Dark theme tints are alpha overlays (plan §10.2 note); composite
      // over each realistic backdrop before measuring, since that's what a
      // real browser actually renders.
      for (const bg of CONTENT_BACKDROPS) {
        const backdrop = colors[bg];
        const rendered = compositeOver(tone.background, backdrop);
        expectAA(`status foreground on its own background, over ${bg}`, tone.foreground, rendered);
      }
    }
  });

  it("text-on-solid-fill (accentContrast/textInverse) reaches 4.5:1 on the accent and red fills it's used against", () => {
    // apps/web/src/ui/primitives/primitives.css .pc-button--primary and
    // apps/android/src/ui/primitives/Button.tsx button_primary/button_danger.
    expectAA("accentContrast on accent", colors.accentContrast, colors.accent);
    expectAA("accentContrast on red (Android danger button)", colors.accentContrast, colors.red);
    expectAA("textInverse on accent", colors.textInverse, colors.accent);
  });

  it("ink reaches 4.5:1 on hover-2, the one backdrop nothing is painted on yet", () => {
    // `hover-2` has no call site at all today (see the file header), so it is
    // not in TEXT_BACKDROPS. This keeps a tripwire on it anyway.
    expectAA("ink on hover-2", colors.ink, colors["hover-2"]);
  });

  it("tooltip foreground and muted text reach 4.5:1 on the tooltip background", () => {
    // apps/web/src/ui/primitives/primitives.css .pc-tooltip and
    // apps/android/src/ui/primitives/Tooltip.tsx paint these two roles on
    // `tooltip-bg`, which is outside the surface stack and so is missed by
    // every loop above.
    expectAA("tooltip-fg on tooltip-bg", colors["tooltip-fg"], colors["tooltip-bg"]);
    expectAA("tooltip-muted on tooltip-bg", colors["tooltip-muted"], colors["tooltip-bg"]);
  });
});
