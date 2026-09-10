/**
 * Public barrel for the Live (A2) screen feature (T350). The route
 * (`app/h/[serverId]/session/[agentId]/live.tsx`) imports from here;
 * the pure model is re-exported so a sibling feature can read the same
 * selections without reaching through the view.
 */
export { LiveScreen } from "./live-screen";
export type { LiveScreenProps } from "./live-screen";
export {
  buildLiveScreenViewModel,
  formatLiveElapsed,
  resolveWorkflowFraction,
} from "./live-screen-model";
export type {
  LiveRowGlyph,
  LiveScreenViewModel,
  LiveSubagentRow,
  LiveSubagentsCard,
  LiveWorkflowCard,
  LiveWorkflowRow,
} from "./live-screen-model";
