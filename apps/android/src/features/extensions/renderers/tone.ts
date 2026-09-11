/**
 * Pi UI Bridge tone -> primitive tone mapping for the Android renderers
 * (plan.md §11.3, §10.5; T34A2).
 *
 * `PiUiTone` (`"default" | "accent" | "success" | "warning" | "error"`) is
 * the wire-level vocabulary every kind that carries a tone uses. The
 * §10.3 primitive layer (`StatusIndicator`'s `StatusTone`, `Chip`'s
 * `ChipTone`) uses a different five-way vocabulary (`"success" |
 * "warning" | "danger" | "info" | "neutral"`). This module is the one
 * place the two are reconciled on Android, so every per-kind renderer
 * maps a wire tone identically instead of re-deriving its own mapping.
 *
 * The mapping is deliberately identical to the web counterpart
 * (`apps/web/src/features/extensions/renderers/tone.ts`): the same
 * element must mean the same thing on both platforms (plan.md §18.3 —
 * separate renderers, one shared meaning). This module contains no React
 * Native import, so it is directly unit testable in this workspace (see
 * `renderers-model.test.ts`).
 */
import type { PiUiTone } from "@picompanion/protocol/pi-ui-bridge/schema";

/** Shared by the `StatusIndicator`/`Chip`/`Banner` primitives — one vocabulary. */
export type PiPrimitiveTone = "success" | "warning" | "danger" | "info" | "neutral";

const TONE_MAP: Record<PiUiTone, PiPrimitiveTone> = {
  default: "neutral",
  accent: "info",
  success: "success",
  warning: "warning",
  error: "danger",
};

/** Maps a Pi UI Bridge tone to the primitive tone vocabulary; `undefined` -> `"neutral"`. */
export function piUiToneToPrimitiveTone(tone: PiUiTone | undefined): PiPrimitiveTone {
  return tone ? TONE_MAP[tone] : "neutral";
}

/** Title-cases a `kebab-case`/`snake_case` extension namespace for display. */
export function humanizeNamespace(ns: string): string {
  return ns
    .split(/[-_]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

/**
 * Visible label for a tone chip, e.g. `"success"` -> `"Success"`. The chip
 * is what keeps a tone from being conveyed by colour alone (plan.md
 * §10.5); the web renderer capitalizes the wire tone the same way.
 */
export function toneChipLabel(tone: PiUiTone): string {
  return tone.charAt(0).toUpperCase() + tone.slice(1);
}

const PI_UI_TONES: readonly PiUiTone[] = ["default", "accent", "success", "warning", "error"];

/**
 * The element envelope schema is `.passthrough()`, so a tone-carrying
 * element arrives here with `tone` present but typed `unknown`. Accept
 * only the five wire values; anything else reads as "carries no tone".
 */
export function readPiUiElementTone(element: object): PiUiTone | undefined {
  const tone = (element as { readonly tone?: unknown }).tone;
  return typeof tone === "string" && (PI_UI_TONES as readonly string[]).includes(tone)
    ? (tone as PiUiTone)
    : undefined;
}

/** The `theme.colors.status` keys a severity glyph may be painted with. */
export type PiUiToneGlyphStatusKey = "success" | "warning" | "danger";

export interface PiUiToneGlyphModel {
  /** The artifact's leading glyph for this severity. */
  glyph: string;
  /** Which `theme.colors.status` tone paints it. */
  statusKey: PiUiToneGlyphStatusKey;
}

/**
 * The artifact's severity glyphs (E2: `! warn · ✕ block · ✓ clean`).
 * `default`/`accent` carry none — they are not severities. The glyph is
 * never the only signal: callers keep `toneChipLabel` visible beside it
 * (plan.md §10.5).
 */
export function piUiToneGlyph(tone: PiUiTone | undefined): PiUiToneGlyphModel | undefined {
  switch (tone) {
    case "warning":
      return { glyph: "!", statusKey: "warning" };
    case "error":
      return { glyph: "✕", statusKey: "danger" };
    case "success":
      return { glyph: "✓", statusKey: "success" };
    default:
      return undefined;
  }
}
