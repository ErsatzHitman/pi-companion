import type {
  PiUiElement,
  PiUiElementPayload,
  PiUiTone,
} from "@picompanion/protocol/pi-ui-bridge/schema";
import type { StatusTone } from "../../ui/primitives/index.js";

/**
 * Generic, kind-aware one-line summary for a rail element (plan.md §11.6
 * "safe generic card"'s spirit, applied to the container rather than a
 * specific tool/kind renderer, which is out of this task's scope — the
 * full-fidelity per-kind visuals are T29A2/T29A3/T29B1-4's `features/
 * extensions/renderers/`). Never throws: an element with no payload, or a
 * payload shape this function does not recognize, still gets a safe
 * fallback string rather than crashing the rail.
 */
export function summarizeRailElement(element: PiUiElement): string {
  const payload = element.payload;
  if (!payload) return "No further details";

  switch (payload.kind) {
    case "status":
      return payload.text ?? payload.detail ?? "Status update";
    case "widget":
      if (payload.text) return payload.text;
      if (payload.lines?.length) return `${payload.lines.length} line(s)`;
      if (payload.rows?.length) return `${payload.rows.length} row(s)`;
      return "Widget";
    case "panel":
      return payload.sections.length > 0
        ? `${payload.sections.length} section(s)`
        : "Composed panel";
    case "progress":
      if (payload.indeterminate) return "In progress";
      if (payload.value != null && payload.max != null) return `${payload.value}/${payload.max}`;
      if (payload.value != null) return `${Math.round(payload.value * 100)}%`;
      return "Progress";
    case "roster": {
      const total = payload.rows.length;
      const running = payload.rows.filter((row) => row.state === "running").length;
      return running > 0 ? `${total} row(s) • ${running} running` : `${total} row(s)`;
    }
    case "log":
      return `${payload.lines.length} line(s)`;
    case "markdown":
      return truncate(payload.text, 96);
    case "diff":
      return payload.filePath ?? "Unified diff";
    case "form":
      return `${payload.fields.length} field(s)`;
    case "composer":
      return payload.mode ? `Draft ${payload.mode}` : "Composer update";
    default:
      return "No further details";
  }
}

function truncate(text: string, max: number): string {
  const trimmed = text.trim();
  return trimmed.length > max ? `${trimmed.slice(0, max - 1)}…` : trimmed;
}

/** Progress value normalized to the `Progress` primitive's `0-1 | null` contract. */
export function progressValueOf(payload: Extract<PiUiElementPayload, { kind: "progress" }>) {
  if (payload.indeterminate) return null;
  if (payload.value != null && payload.max != null && payload.max > 0) {
    return payload.value / payload.max;
  }
  if (payload.value != null) return payload.value;
  return null;
}

const TONE_TO_STATUS: Record<PiUiTone, StatusTone> = {
  default: "neutral",
  accent: "info",
  success: "success",
  warning: "warning",
  error: "danger",
};

/** Maps a Pi UI Bridge tone (plan.md §11.3) to the `StatusIndicator` primitive's tone. */
export function statusToneOf(tone: PiUiTone | undefined): StatusTone {
  return TONE_TO_STATUS[tone ?? "default"];
}
