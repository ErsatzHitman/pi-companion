/**
 * Pi UI Bridge tone -> primitive tone mapping (plan.md §11.3, §10.5; T29A2).
 *
 * `PiUiTone` (`"default" | "accent" | "success" | "warning" | "error"`) is a
 * wire-level vocabulary shared by every kind that carries a tone. The web
 * design system's `StatusTone`/`ChipTone` primitives (plan.md §10.3) use a
 * slightly different five-way vocabulary (`"success" | "warning" | "danger"
 * | "info" | "neutral"`). This module is the one place that reconciles
 * them, so every per-kind renderer maps a wire tone identically instead of
 * re-deriving its own mapping.
 */
import type { PiUiTone } from "@picompanion/protocol/pi-ui-bridge/schema";

/** Shared by `StatusTone` and `ChipTone` — both primitives use this exact vocabulary. */
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
