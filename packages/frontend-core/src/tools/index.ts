/**
 * Tools domain — plan.md §6/§7.1/§11.6.
 *
 * Owns typed tool-call view models for the §11.6 tool families
 * (`buildToolCallViewModel`) plus the safe generic fallback card model for
 * arbitrary/unrecognized tools (`buildGenericToolCallViewModel`), and the
 * `ToolCallViewModelRegistry` that keeps streaming updates attached to
 * their call by `callId` (§7.4).
 *
 * Implemented by T23 ("Implement core tool-call view models with
 * fallback"). Consumers: `timeline/` (T20A/T20B) attaches these to
 * rendered transcript items; `apps/web`/`apps/android` renderer registries
 * (T29A/T34A and friends) map `ToolCallViewModel.family` to a component.
 *
 * Repository invariant: this module must never import React, React
 * Native, Expo, DOM types, or browser globals.
 */
export {
  KNOWN_TOOL_CALL_FAMILIES,
  type EditToolCallViewModel,
  type FetchToolCallViewModel,
  type GenericToolCallViewModel,
  type KnownToolCallFamily,
  type PlainTextToolCallViewModel,
  type PlanToolCallViewModel,
  type ReadToolCallViewModel,
  type SearchToolCallViewModel,
  type ShellToolCallViewModel,
  type SubAgentActionView,
  type SubAgentToolCallViewModel,
  type ToolCallBuildOptions,
  type ToolCallViewModel,
  type ToolCallViewModelBase,
  type ToolCallViewStatus,
  type WorktreeSetupCommandView,
  type WorktreeSetupToolCallViewModel,
  type WriteToolCallViewModel,
} from "./types.js";

export { buildToolCallViewModel } from "./view-model.js";
export { buildGenericToolCallViewModel, type BuildGenericOptions } from "./fallback.js";
export { ToolCallViewModelRegistry, type ToolCallUpsertOptions } from "./registry.js";
