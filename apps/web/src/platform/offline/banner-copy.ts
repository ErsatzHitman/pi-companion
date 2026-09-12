/**
 * The offline banner's copy (T393), kept out of the component so the
 * wording is testable without a DOM.
 *
 * The sentence is deliberately concrete about two things a user cannot
 * otherwise tell apart: *when* the rows on screen were last seen, and
 * *what* is unavailable while the daemon is unreachable. It never claims
 * the cached rows are current, and it never invents a time when none was
 * recorded — an unknown `cachedAt` drops the time clause rather than
 * guessing.
 */

/** Inputs the banner already knows; all of them are facts it holds, never derived guesses. */
export interface OfflineTranscriptCopyInput {
  /** `true` only while the connection status is `"connected"`. */
  connected: boolean;
  /** Whether there is anything on screen for the banner to caveat. */
  hasEntries: boolean;
  /** When the tail was last written, or `null` when nothing was recorded. */
  cachedAt: number | null;
  /** Epoch ms "now"; omit to use the real clock. */
  now?: number;
}

export interface OfflineTranscriptCopy {
  text: string;
}

/** "5 minutes", "1 hour", "just now" — whole units, no seconds arithmetic on screen. */
function describeAge(ageMs: number): string {
  if (ageMs < 45_000) {
    return "just now";
  }
  const minutes = Math.round(ageMs / 60_000);
  if (minutes < 60) {
    return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  }
  const hours = Math.round(minutes / 60);
  if (hours < 24) {
    return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  }
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

/**
 * `null` while there is nothing honest to say (connected, or an empty
 * transcript), otherwise the banner sentence.
 */
export function describeOfflineTranscript(
  input: OfflineTranscriptCopyInput,
): OfflineTranscriptCopy | null {
  if (input.connected || !input.hasEntries) {
    return null;
  }
  const now = input.now ?? Date.now();
  const seen =
    input.cachedAt === null
      ? "This is the last copy saved on this device, and it has not been confirmed since."
      : `Showing the copy saved ${describeAge(Math.max(0, now - input.cachedAt))}, not a live transcript.`;
  return {
    text: `Offline — the daemon is unreachable, so push notifications are unavailable and new messages cannot be sent. ${seen}`,
  };
}
