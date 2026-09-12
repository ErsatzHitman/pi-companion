/**
 * `Transcript` + `useEditFromHere` composed into one drop-in surface
 * (T105, plan.md §11.1). This is the production wiring a route mounts
 * instead of a bare `<Transcript>`: it renders the transcript itself,
 * gives every eligible user message a working "Edit from here" button
 * (`message-row.tsx`), and shows the fork's outcome once one lands — the
 * value ARRIVING, not just a promise resolving somewhere off-screen.
 *
 * Kept router- and daemon-agnostic on purpose (a plain `client?:
 * EditFromHereForkClient` and `onOpenSession` callback, never
 * `@tanstack/react-router`'s `useNavigate` or `@picompanion/client`'s
 * `DaemonClient` directly) so it is directly testable with fakes, the
 * same way `features/sessions/SessionsScreen.tsx` stays "directly
 * testable without going through the router" per its own doc comment.
 * `routes/screens/host-session-screen.tsx` is the one place that adapts
 * the real `DaemonClient` and calls the real `navigate()` on
 * `onOpenSession` — see that file's own doc comment.
 *
 * ## Gating decision (T114)
 *
 * T105 shipped every eligible user message with an ENABLED "Edit from
 * here" button whose only possible outcome, absent a fork-capable
 * client, was the "Not connected — can't branch this conversation yet."
 * banner below — and left the decision of whether to gate it explicitly
 * open (see `host-session-screen.tsx`'s adapter doc for the P6-W4 record
 * of that). Verified before settling this: no `fork_agent`/`clone_agent`/
 * `rename_agent` wire message exists at all
 * (`grep -ciE "fork_agent|clone_agent|rename_agent"` over
 * `packages/protocol/src/messages.ts` and
 * `packages/server/src/server/session.ts` both return `0`), no task owns
 * adding the six schemas T110 named that would be required, and T110
 * landing (`5806cff`) did not and could not have changed any of that —
 * so a real `DaemonClient` implements `forkAgent` on no production path
 * today and this control's only real-world outcome would stay the
 * failure banner indefinitely.
 *
 * Decision: gate it. `editFromHereTargets` is handed to `Transcript` only
 * when `client` is present, so `canEditFromHere` (`edit-from-here-
 * target.ts`) is `false` for every row whenever no fork-capable client is
 * wired — the SAME "disabled, not hidden" treatment `message-row.tsx`
 * already gives a message with no valid fork predecessor (see that
 * file's own doc comment: "a reasoned rejection, not a hidden
 * affordance"). The affordance stays visible (so a reader can see the
 * capability exists and is coming, not that it silently vanished) but
 * cannot be clicked into a guaranteed failure. `useEditFromHere`'s own
 * "not connected" error path is untouched and stays covered
 * (`use-edit-from-here.test.ts`) as defense in depth for any caller that
 * invokes `editFromHere` directly rather than through this gated button.
 * The ungated path — a live `client` — stays fully reachable and tested
 * here (`EditFromHereSurface.test.tsx`'s "clicking Edit from here on an
 * eligible message forks through the client" case), so the day the wire
 * gap closes and `host-session-screen.tsx`'s `adaptEditFromHereForkClient`
 * starts returning a real adapter, this control lights up with no change
 * to this file.
 */
import { useState } from "react";

import type { Clock, timeline } from "@picompanion/frontend-core";

import { Banner } from "../../ui/primitives/index.js";
import type { ResolveImageSrc } from "./message-attachments.js";
import { Transcript } from "./transcript.js";
import { useEditFromHere } from "./use-edit-from-here.js";
import type { EditFromHereForkClient, EditFromHereOutcome } from "./use-edit-from-here.js";

export interface EditFromHereSurfaceProps {
  sessionId: string;
  entries: readonly timeline.TranscriptEntry[];
  clock: Clock;
  /** See `use-edit-from-here.ts`'s module doc for why this is optional and what it means when it is `undefined`. */
  client?: EditFromHereForkClient;
  streamingEntryId?: string | null;
  resolveImageSrc?: ResolveImageSrc;
  /**
   * T395: forwarded straight to `Transcript`'s own `onRewindToHere` — the
   * "Rewind to here" per-row affordance and its dialog are composed by
   * the caller (see `features/transcript/rewind/`), not by this surface.
   */
  onRewindToHere?: (messageId: string) => void;
  /** T395: forwarded to `Transcript`; `true` disables every row's rewind button. */
  rewindToHereDisabled?: boolean;
  /**
   * Called when the reader activates the confirmation banner's "Open
   * branch" action, after a fork has landed. This surface never
   * navigates itself — see this file's module doc.
   */
  onOpenSession?: (outcome: EditFromHereOutcome) => void;
  testId?: string;
}

/** Visible, human-readable confirmation text for a landed fork — never colour alone (plan.md §10.5). */
function describeOutcome(outcome: EditFromHereOutcome): string {
  const preview =
    outcome.draftText.length > 80 ? `${outcome.draftText.slice(0, 80)}…` : outcome.draftText;
  return `Branched into a new session at "${preview}".`;
}

export function EditFromHereSurface({
  sessionId,
  entries,
  clock,
  client,
  streamingEntryId,
  resolveImageSrc,
  onRewindToHere,
  rewindToHereDisabled,
  onOpenSession,
  testId,
}: EditFromHereSurfaceProps) {
  const [lastOutcome, setLastOutcome] = useState<EditFromHereOutcome | null>(null);

  const { targets, editFromHere, error } = useEditFromHere({
    sessionId,
    entries,
    clock,
    client,
    onForked: (outcome) => {
      setLastOutcome(outcome);
    },
  });

  const errorTestId = testId ? `${testId}-edit-from-here-error` : undefined;
  const bannerTestId = testId ? `${testId}-edit-from-here-banner` : undefined;

  return (
    <>
      <Transcript
        entries={entries}
        streamingEntryId={streamingEntryId}
        resolveImageSrc={resolveImageSrc}
        // Gated on a live fork-capable `client` (see this file's module
        // doc, "Gating decision (T114)") — `undefined` here makes every
        // row's `canEditFromHere` false, disabling (never hiding) the
        // button rather than shipping one that can only ever fail.
        editFromHereTargets={client ? targets : undefined}
        onEditFromHere={editFromHere}
        onRewindToHere={onRewindToHere}
        rewindToHereDisabled={rewindToHereDisabled}
        testId={testId}
      />
      {error ? <Banner tone="danger" message={error} testId={errorTestId} /> : null}
      {lastOutcome ? (
        <Banner
          tone="success"
          message={describeOutcome(lastOutcome)}
          actionLabel="Open branch"
          onAction={() => onOpenSession?.(lastOutcome)}
          testId={bannerTestId}
        />
      ) : null}
    </>
  );
}

export default EditFromHereSurface;
