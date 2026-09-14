/**
 * plan.md §9.2 compact status strip (T33A1) — the transcript screen's
 * `CompactSessionShell` `statusStrip` slot.
 *
 * `status-model.ts` owns every decision (tone, status word, the
 * announced sentence); this file is a thin native mapping onto the
 * `StatusIndicator` primitive, which already pairs the coloured dot with
 * visible status text and carries `accessibilityLiveRegion="polite"`
 * (`../../ui/primitives/StatusIndicator.tsx`) — exactly the "status is
 * conveyed in text as well as colour" and "TalkBack announces status
 * changes" acceptance criteria, satisfied by composing that primitive
 * rather than re-implementing it.
 *
 * **UI-A3: collapses to nothing at rest.** The mockup's S7 frame
 * (`docs/ui-reference/pi-companion-app.html`, `.fr[data-frame="s7"]`)
 * goes straight from `.bar` to the transcript with zero persistent
 * chrome beneath the bar while the connection is healthy and idle — this
 * component used to render `StatusIndicator` unconditionally, so a
 * resting session showed a permanent "Connection: Connected" line the
 * artifact never draws. `status-model.ts`'s `isRestingTranscriptStatus`
 * is the one place that decision lives (mirroring `app-shell/
 * compact-shell.tsx`'s existing `liveExtension` slot, which collapses
 * the same way when it has nothing pinned); this file renders `null`
 * for that one status and is otherwise unchanged.
 */
import { StatusIndicator } from "../../ui/primitives";
import {
  buildTranscriptStatusViewModel,
  isRestingTranscriptStatus,
  type TranscriptStatus,
} from "./status-model";

export interface TranscriptStatusStripProps {
  status: TranscriptStatus;
  /** Extra context folded into the announced text, e.g. an error message or reconnect attempt count. */
  detail?: string;
  testId?: string;
}

export function TranscriptStatusStrip({
  status,
  detail,
  testId = "transcript-status-strip",
}: TranscriptStatusStripProps) {
  if (isRestingTranscriptStatus(status)) {
    return null;
  }

  const model = buildTranscriptStatusViewModel(status, detail);

  return (
    <StatusIndicator
      label={model.label}
      tone={model.tone}
      statusText={model.statusText}
      testId={testId}
    />
  );
}
