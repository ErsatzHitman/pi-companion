/**
 * `apps/web`'s offline-cache platform module (T393): the browser-backed
 * half of `frontend-core`'s offline domain.
 *
 * It exists so feature code has one import to reach — the timeline cache
 * bridge and the banner copy — and so the primitive this app needs
 * (`StructuredStorage` over the browser's own storage, already in
 * `../storage.ts`) stays the only thing the cache knows about a platform.
 */
export {
  cacheTimelineTail,
  confirmTimelineCatchUp,
  createTimelineCache,
  loadTimelineCacheEnvelope,
  timelineCacheKey,
} from "./timeline-cache.js";
export type { TimelineCache } from "./timeline-cache.js";
export { describeOfflineTranscript } from "./banner-copy.js";
export type { OfflineTranscriptCopy, OfflineTranscriptCopyInput } from "./banner-copy.js";
