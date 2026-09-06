/**
 * Offline domain — plan.md §6/§7.1.
 *
 * Owns display-only cache serialization with stale marking (T22 —
 * "Implement core drafts, outbox, and offline cache"), so a cached
 * timeline or other daemon-derived view can render immediately after
 * restart or reconnect while staying flagged stale until the owning
 * domain confirms it against authoritative daemon state.
 *
 * Repository invariant: this module must never import React, React
 * Native, Expo, DOM types, or browser globals.
 */

export type { CacheEnvelope } from "./cache.js";
export { OfflineCache } from "./cache.js";
