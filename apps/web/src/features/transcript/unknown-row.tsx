import { memo, useRef } from "react";
import type { timeline } from "@picompanion/frontend-core";

import { Card, CodeBlock } from "../../ui/primitives/index.js";

/** The `unknown` transcript entry kind (`transcript-view.ts`'s
 * forward-compatibility fallback for a timeline item type this build has
 * never seen — a newer daemon/protocol version, never a normal case).
 * This task's sibling to `tool-call-row.tsx`'s safe generic card: never
 * thrown away, and never rendered as raw payload.
 *
 * The entry is never dropped and never fails the transcript — the same
 * "never fail the transcript" rule the tools domain's safe generic card
 * follows — and it is never rendered as anything but inert text, the same
 * way `UnknownToolCard` boxes every payload inside a JSON `CodeBlock`. */
export type UnknownTranscriptEntry = Extract<timeline.TranscriptEntry, { kind: "unknown" }>;

export function isUnknownEntry(entry: timeline.TranscriptEntry): entry is UnknownTranscriptEntry {
  return entry.kind === "unknown";
}

export interface TranscriptUnknownRowProps {
  entry: UnknownTranscriptEntry;
  testId?: string;
}

/** Bound on the raw-payload disclosure so one runaway future shape cannot
 * balloon this row's DOM — the same cap
 * `features/rail/rail-element-card.tsx` puts on its own raw-payload
 * disclosure. */
const RAW_PAYLOAD_CHAR_LIMIT = 4000;

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2) ?? "(none)";
  } catch {
    return "(unable to display this payload)";
  }
}

function rawPayloadDisplay(raw: unknown): string {
  const text = safeStringify(raw);
  if (text.length <= RAW_PAYLOAD_CHAR_LIMIT) {
    return text;
  }
  return `${text.slice(0, RAW_PAYLOAD_CHAR_LIMIT)}\n… (truncated)`;
}

/**
 * Renders one `unknown` transcript entry as a safe diagnostic card: the
 * unrecognized wire type in words (never colour or kind alone), an
 * honest "update the app" note, and the payload boxed behind a native
 * `<details>` disclosure as inert JSON text — never interpreted as
 * markup, never executed.
 */
function TranscriptUnknownRowImpl({ entry, testId }: TranscriptUnknownRowProps) {
  // Same render-count instrumentation as `TranscriptErrorRow`, for the
  // same reason — see that component's doc comment.
  const renderCount = useRef(0);
  renderCount.current += 1;

  return (
    <div data-render-count={renderCount.current}>
      <Card data-testid={testId}>
        <p className="pc-tool-call__meta">
          Unsupported entry &ldquo;{entry.rawType}&rdquo; — this app version does not recognize it.
          It is shown here so history stays complete; update the app for full details.
        </p>
        <details className="pc-tool-call__details">
          <summary>Details</summary>
          <CodeBlock code={rawPayloadDisplay(entry.raw)} language="json" />
        </details>
      </Card>
    </div>
  );
}

function areUnknownRowPropsEqual(
  previous: TranscriptUnknownRowProps,
  next: TranscriptUnknownRowProps,
): boolean {
  return (
    previous.entry.id === next.entry.id &&
    previous.entry.rawType === next.entry.rawType &&
    JSON.stringify(previous.entry.raw) === JSON.stringify(next.entry.raw) &&
    previous.testId === next.testId
  );
}

export const TranscriptUnknownRow = memo(TranscriptUnknownRowImpl, areUnknownRowPropsEqual);
