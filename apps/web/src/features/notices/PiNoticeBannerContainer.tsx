/**
 * Wires a per-session `PiNoticeStore` to a live `client` (when given) and
 * renders `PiNoticeBanner` from it (T112, plan.md §8.3, §11.5).
 *
 * Mounted as a sibling of `ContextMeter`/`SessionCostMeterContainer`
 * inside `root-route.tsx`'s `ExtensionRailContent` — see that file's own
 * mount for the live wiring. A fresh `PiNoticeStore` is created per
 * `agentId` (not reused across a session switch), so a notice from one
 * session never leaks into another.
 */
import { useEffect, useMemo } from "react";

import { attachPiNoticeStore } from "./daemon-pi-notice-client.js";
import type { DaemonPiNoticeClient } from "./daemon-pi-notice-client.js";
import { PiNoticeBanner } from "./PiNoticeBanner.js";
import { PiNoticeStore } from "./pi-notice-store.js";
import { usePiNotices } from "./use-pi-notices.js";

export interface PiNoticeBannerContainerProps {
  /** Session this queue collects live `pi_notice` events for. */
  agentId: string;
  /**
   * Live daemon adapter (T112). Defaults to `undefined`: with no live
   * client the banner renders `PiNoticeStore`'s initial empty state
   * (nothing), matching every other rail surface's "no connection is a
   * normal state" convention (`SessionCostMeterContainer`'s own doc).
   */
  client?: DaemonPiNoticeClient;
  testId?: string;
}

export function PiNoticeBannerContainer({ agentId, client, testId }: PiNoticeBannerContainerProps) {
  const store = useMemo(() => new PiNoticeStore(), [agentId]);

  useEffect(() => {
    if (!client) return undefined;
    return attachPiNoticeStore(client, agentId, store);
  }, [client, agentId, store]);

  const notices = usePiNotices(store);

  return <PiNoticeBanner notices={notices} onDismiss={(id) => store.dismiss(id)} testId={testId} />;
}

export default PiNoticeBannerContainer;
