/**
 * The rewind scopes `agent.rewind.request` accepts, with the one honest
 * sentence each carries in the sheet — T395, `plan.md` §4.2 ("Workspace
 * checkpoint snapshots").
 *
 * `AgentRewindModeSchema` (`@picompanion/protocol/messages`) is exactly
 * `"conversation" | "files" | "both"`, and the daemon has no fourth mode;
 * keeping the three options here, typed to the wire union, is what stops
 * the sheet from inventing one. The descriptions are deliberately literal
 * about what each scope touches, because the three restores are not
 * interchangeable: a conversation rewind navigates Pi's session tree, a
 * files rewind restores the snapshot, and only `"both"` does the two
 * together (`plan.md` §4.2, "A restore is a plan, not a checkout" and
 * "Conversation rewind is unchanged").
 *
 * Android renders these through `RewindSheet.tsx`; the identical module
 * exists on web (`apps/web/src/features/transcript/rewind/rewind-scopes.ts`),
 * because the two surfaces share no code but must offer the same three
 * choices with the same meanings.
 *
 * This module imports nothing at all — not React, not React Native, not
 * Expo — so its tests are plain data assertions, the shape this workspace
 * requires of every module carrying real logic.
 */
import type { rewind } from "@picompanion/frontend-core";

/** The rewind modes the daemon accepts — re-exported from the shared controller. */
export type RewindMode = rewind.RewindMode;

export interface RewindScopeOption {
  readonly mode: RewindMode;
  readonly label: string;
  /** One honest sentence about what this scope restores. */
  readonly description: string;
}

const BY_MODE: Record<RewindMode, RewindScopeOption> = {
  conversation: {
    mode: "conversation",
    label: "Conversation only",
    description:
      "Rewinds the chat to this message. The files on disk are left exactly as they are.",
  },
  files: {
    mode: "files",
    label: "Files only",
    description:
      "Restores the workspace's files to how they were at this turn. The chat is left as it is.",
  },
  both: {
    mode: "both",
    label: "Conversation and files",
    description: "Rewinds the chat and restores the files to this turn at the same time.",
  },
};

/** The three scopes, in the order the sheet offers them (chat, files, both). */
export const REWIND_SCOPE_OPTIONS: readonly RewindScopeOption[] = [
  BY_MODE.conversation,
  BY_MODE.files,
  BY_MODE.both,
];

/** The option for `mode`; total over `RewindMode`, so it never returns `undefined`. */
export function rewindScopeOption(mode: RewindMode): RewindScopeOption {
  return BY_MODE[mode];
}

/** The human label for `mode`, e.g. `"Files only"`. */
export function rewindScopeLabel(mode: RewindMode): string {
  return BY_MODE[mode].label;
}
