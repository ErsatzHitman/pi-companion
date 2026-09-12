/**
 * Web rewind/checkpoint surface barrel — T395, `plan.md` §4.2.
 *
 * Exposes the hook that drives `RewindController`, the dialog that renders
 * its state, and the pure scope/undone-turns models. `features/transcript/
 * index.ts` re-exports the pieces a route mounts.
 */
export { REWIND_SCOPE_OPTIONS, rewindScopeLabel, rewindScopeOption } from "./rewind-scopes.js";
export type { RewindMode, RewindScopeOption } from "./rewind-scopes.js";
export {
  addUndoneTurn,
  buildUndoneTurn,
  MAX_UNDONE_TURNS,
  SNIPPET_MAX_CHARS,
  snippetFor,
} from "./undone-turns.js";
export type { UndoneTurn } from "./undone-turns.js";
export { useRewindToHere } from "./use-rewind-to-here.js";
export type {
  RewindDialogModel,
  RewindStatus,
  RewindTarget,
  RewindToHereController,
  RewindToHereOptions,
} from "./use-rewind-to-here.js";
export { RewindDialog } from "./RewindDialog.js";
export type { RewindDialogProps } from "./RewindDialog.js";
