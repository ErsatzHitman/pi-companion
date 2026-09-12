/**
 * `features/transcript/rewind` barrel — T395, `plan.md` §4.2 ("Workspace
 * checkpoint snapshots").
 *
 * Exposes the Android "Rewind to here" surface: the hook driving
 * `frontend-core`'s `RewindController`, the sheet that draws its state, and
 * the pure modules behind both (the scope list, the local undone-turns
 * record, and the sheet model every label and gate lives in).
 */
export { REWIND_SCOPE_OPTIONS, rewindScopeLabel, rewindScopeOption } from "./rewind-scopes";
export type { RewindMode, RewindScopeOption } from "./rewind-scopes";
export {
  addUndoneTurn,
  buildUndoneTurn,
  MAX_UNDONE_TURNS,
  SNIPPET_MAX_CHARS,
  snippetFor,
} from "./undone-turns";
export type { UndoneTurn } from "./undone-turns";
export {
  buildRewindSheetModel,
  REWIND_CANCEL_LABEL,
  REWIND_DISCONNECTED_REASON,
  REWIND_UNDONE_HEADING,
  REWIND_RESTORE_ANYWAY_LABEL,
  REWIND_SHEET_TITLE,
  REWIND_SUBMIT_LABEL,
  REWIND_TURN_RUNNING_REASON,
  rewindSubmitBlockedReason,
} from "./rewind-sheet-model";
export type {
  RewindActionId,
  RewindDialogState,
  RewindSheetAction,
  RewindSheetModel,
  RewindStatus,
  RewindTarget,
  RewindUndoneRow,
} from "./rewind-sheet-model";
export { useRewindToHere } from "./use-rewind-to-here";
export type { RewindToHereController, RewindToHereOptions } from "./use-rewind-to-here";
export { RewindSheet } from "./RewindSheet";
export type { RewindSheetProps } from "./RewindSheet";
