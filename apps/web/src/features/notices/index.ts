/**
 * Notices feature (T112, plan.md §8.3, §11.5): surfaces the Pi
 * provider's `pi_notice` `agent_stream` events — its only channel for
 * out-of-band operator-visible warnings and errors — as dismissible
 * banners next to `features/telemetry`'s session-cost meter. Before this
 * task the daemon produced `pi_notice` and nothing consumed it (P6-W4
 * import-graph walk + grep).
 */
export { attachPiNoticeStore } from "./daemon-pi-notice-client.js";
export type {
  DaemonPiNoticeClient,
  DaemonPiNoticeStreamMessage,
  DaemonPiNoticeWireEvent,
} from "./daemon-pi-notice-client.js";
export { PiNoticeBanner } from "./PiNoticeBanner.js";
export type { PiNoticeBannerProps } from "./PiNoticeBanner.js";
export { PiNoticeBannerContainer } from "./PiNoticeBannerContainer.js";
export type { PiNoticeBannerContainerProps } from "./PiNoticeBannerContainer.js";
export { PiNoticeStore } from "./pi-notice-store.js";
export type {
  PiNoticeEntry,
  PiNoticeLevel,
  PiNoticeListener,
  PiNoticeSourceEvent,
} from "./pi-notice-store.js";
export { usePiNotices } from "./use-pi-notices.js";
