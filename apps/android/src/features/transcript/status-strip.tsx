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
 */
import { StatusIndicator } from "../../ui/primitives";
import { buildTranscriptStatusViewModel, type TranscriptStatus } from "./status-model";

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
