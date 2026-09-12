import { Banner } from "../../ui/primitives/index.js";
import { describeOfflineTranscript } from "../../platform/offline/index.js";

export interface OfflineTranscriptBannerProps {
  /** `true` only while the connection status is `"connected"`. */
  connected: boolean;
  /** Whether the transcript has rows to show behind the banner. */
  hasEntries: boolean;
  /** `CacheEnvelope.cachedAt` for the tail on screen, when known. */
  cachedAt: number | null;
  /** Epoch ms "now", for relative-time phrasing; omit to use the real clock. */
  now?: number;
  testId?: string;
}

/**
 * The transcript's offline banner (T393, plan.md §2.2/§12.5).
 *
 * Renders nothing while the connection is up or there is nothing on screen
 * to caveat; otherwise `describeOfflineTranscript`'s honest, last-seen-time
 * sentence goes into the shared `Banner` primitive (colour paired with
 * visible text, plan.md §10.5 — never colour alone). The transcript behind
 * it is display-only cached data: this never claims the cached rows are
 * current.
 */
export function OfflineTranscriptBanner({
  connected,
  hasEntries,
  cachedAt,
  now,
  testId,
}: OfflineTranscriptBannerProps) {
  const announcement = describeOfflineTranscript({ connected, hasEntries, cachedAt, now });
  if (!announcement) {
    return null;
  }
  return <Banner tone="warning" message={announcement.text} testId={testId} />;
}
