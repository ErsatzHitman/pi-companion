/**
 * Rewind/checkpoint domain — `plan.md` §4.2 ("Workspace checkpoint
 * snapshots"), T395.
 *
 * Owns the platform-neutral rewind controller shared by the web and
 * Android surfaces (the screens themselves land in a follow-up task):
 * `RewindController` drives `DaemonClient.rewindAgent` — conversation,
 * files, or both — through a client-like port and maps success, a refused
 * checkpoint restore, an unsupported mode, and a generic daemon failure
 * into one typed `RewindOutcome`. See `rewind-controller.ts` for why the
 * conflict classification is a documented wire code rather than a
 * sentence match in a screen.
 *
 * Repository invariant: this module must never import React, React
 * Native, Expo, DOM types, or browser globals.
 */

export { RewindController } from "./rewind-controller.js";
export type {
  RewindClientPort,
  RewindMode,
  RewindOutcome,
  RewindRequest,
} from "./rewind-controller.js";
