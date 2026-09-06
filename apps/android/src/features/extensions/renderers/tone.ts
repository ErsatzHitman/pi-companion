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
