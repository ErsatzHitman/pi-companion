/**
 * `features/rail` barrel (T29R1, T29R2, T29C2; plan.md §8.3, §11.5).
 *
 * The right web Pi extension rail container, plus the context-window/
 * cache-hit meter it mounts (T29C2). T29R1 built the container and placement
 * rules; T29R2 wired full per-kind fidelity (fleet/workflow/loop/goal) into
 * `RailElementCard` via the T29A1-T29B4 renderer registry.
 */
export { ContextMeter } from "./context-meter.js";
export type { ContextMeterProps } from "./context-meter.js";
export { PiExtensionRail } from "./pi-extension-rail.js";
export type { PiExtensionRailProps } from "./pi-extension-rail.js";
export { RailElementCard } from "./rail-element-card.js";
export type { RailElementCardProps } from "./rail-element-card.js";
export { selectRailElements } from "./select-rail-elements.js";
export { progressValueOf, statusToneOf, summarizeRailElement } from "./summarize-rail-element.js";
export { usePiUiRailElements } from "./use-pi-ui-rail-elements.js";
