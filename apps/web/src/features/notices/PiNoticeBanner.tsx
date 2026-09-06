/**
 * Renders every live `pi_notice` (T112, plan.md §10.3) as a dismissible
 * `Banner`, oldest first. Renders nothing while the queue is empty — an
 * absent-is-normal state, matching `SessionCostMeterContainer`'s own
 * "no fabricated placeholder" convention.
 *
 * Reuses the existing `Banner` primitive rather than a bespoke element:
 * `role="status"`/polite live region and a real `<button>` action come
 * for free, and every notice's level maps onto `Banner`'s existing
 * `StatusTone` (`info`/`warning` pass through; `error` maps to `danger`,
 * `Banner`'s tone for a failure state).
 */
import { Banner } from "../../ui/primitives/index.js";
import type { PiNoticeEntry, PiNoticeLevel } from "./pi-notice-store.js";

export interface PiNoticeBannerProps {
  notices: readonly PiNoticeEntry[];
  onDismiss?: (id: string) => void;
  testId?: string;
}

const TONE_BY_LEVEL: Record<PiNoticeLevel, "info" | "warning" | "danger"> = {
  info: "info",
  warning: "warning",
  error: "danger",
};

export function PiNoticeBanner({
  notices,
  onDismiss,
  testId = "pi-notice-banner",
}: PiNoticeBannerProps) {
  if (notices.length === 0) return null;

  return (
    <div data-testid={testId}>
      {notices.map((notice) => (
        <Banner
          key={notice.id}
          tone={TONE_BY_LEVEL[notice.level]}
          message={notice.message}
          actionLabel={onDismiss ? "Dismiss" : undefined}
          onAction={onDismiss ? () => onDismiss(notice.id) : undefined}
          testId={`${testId}-item-${notice.id}`}
        />
      ))}
    </div>
  );
}
