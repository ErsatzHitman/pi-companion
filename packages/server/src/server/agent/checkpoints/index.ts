export {
  createWorkspaceCheckpointStore,
  defaultCheckpointStorageRoot,
  WorkspaceCheckpointStore,
} from "./checkpoint-store.js";
export type {
  CaptureCheckpointInput,
  CheckpointPhase,
  RestoreCheckpointInput,
  WorkspaceCheckpointStoreOptions,
} from "./checkpoint-store.js";
export { CheckpointConflictError, applyRestorePlan } from "./shadow-repository.js";
export type { RepositoryRestorePlan } from "./shadow-repository.js";
export {
  isExcludedPath,
  MAX_UNTRACKED_BINARY_BYTES,
  MAX_UNTRACKED_FILE_BYTES,
  shouldCaptureFile,
} from "./exclusions.js";
export type { FileCandidate } from "./exclusions.js";
