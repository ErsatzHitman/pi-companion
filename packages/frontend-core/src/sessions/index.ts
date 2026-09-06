/**
 * Sessions domain — plan.md §6/§7.1.
 *
 * Owns normalized daemon session/agent entities and session-level
 * lifecycle state (list, switch, create) shared by web and Android.
 *
 * `tree.ts` (T38A1a) is real as of Phase 6: it models the parent/child
 * (fork) and provenance-only (clone) relationships between sessions,
 * framework-neutrally. See that file for the fork/clone distinction and
 * the "cycles are impossible by construction" guarantee. The rest of this
 * domain (session list/switch/create state) remains a Phase 2 stub; do
 * not add logic here outside the Phase 2+ core tasks in
 * docs/issues-from-plan.md (e.g. T19B) that own it.
 *
 * Repository invariant: this module must never import React, React
 * Native, Expo, DOM types, or browser globals.
 */
export const SESSIONS_DOMAIN_STUB = true;

export type {
  CloneSessionParams,
  CreateRootSessionParams,
  ForkSessionParams,
  SessionBranchKind,
  SessionForkPoint,
  SessionTreeIndex,
  SessionTreeNode,
} from "./tree.js";
export {
  buildSessionTreeIndex,
  cloneSession,
  createRootSession,
  forkSession,
  getAncestors,
  getPathFromRoot,
  isDescendantOf,
} from "./tree.js";

// P6-W3 merge gate: T38A1b added `tree-edit-shortcut.ts` but never named it
// here, and `frontend-core`'s `package.json` `exports` map has a single "."
// entry (no `./sessions` subpath), so this barrel is the ONLY route
// `apps/web`/`apps/android` have to the module. Without these two lines
// `editFromHere` is reachable from nothing but its own colocated test —
// "registration is not receipt". T38A1b disclosed the gap and nominated
// T38A3 as the next owner; T38A3 did not touch this file.
export type {
  EditFromHereMessageRef,
  EditFromHereParams,
  EditFromHereResult,
  EditFromHereTarget,
} from "./tree-edit-shortcut.js";
export {
  editFromHere,
  InvalidEditFromHereTargetError,
  resolveEditFromHereForkPoint,
} from "./tree-edit-shortcut.js";
