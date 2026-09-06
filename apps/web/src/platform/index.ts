/**
 * `apps/web` platform adapters (plan.md §7.3, §8.1).
 *
 * Implements every narrow interface `packages/frontend-core/src/platform`
 * defines, backed by real browser globals. `frontend-core` itself never
 * touches these globals; consumers there receive a `CorePlatform` object
 * constructed here and injected at the app root.
 */
import type { CorePlatform } from "@picompanion/frontend-core";

import { createBrowserAudioInput } from "./audio-input.js";
import { createBrowserClipboard } from "./clipboard.js";
import { createBrowserClock } from "./clock.js";
import { createBrowserFilePicker } from "./file-picker.js";
import { createDocumentVisibilityLifecycle } from "./lifecycle.js";
import { createConsoleLogger } from "./logging.js";
import { createBrowserNetworkReachability } from "./network.js";
import { createBrowserNotifications } from "./notifications.js";
import { createWebCryptoSecureStorage } from "./secure-storage.js";
import { createWebShareSharing } from "./sharing.js";
import { createLocalStorageKeyValueStorage } from "./storage.js";
import { createIndexedDbStructuredStorage } from "./structured-storage.js";

export { createBrowserAudioInput } from "./audio-input.js";
export { createBrowserClipboard } from "./clipboard.js";
export { createBrowserClock } from "./clock.js";
export { createBrowserFilePicker } from "./file-picker.js";
export { createBrowserFrameClock } from "./frame-clock.js";
export { createDocumentVisibilityLifecycle } from "./lifecycle.js";
export { createConsoleLogger } from "./logging.js";
export { createBrowserNetworkReachability } from "./network.js";
export { createBrowserNotifications } from "./notifications.js";
export { createWebCryptoSecureStorage } from "./secure-storage.js";
export { createWebShareSharing } from "./sharing.js";
export { createLocalStorageKeyValueStorage } from "./storage.js";
export { createIndexedDbStructuredStorage } from "./structured-storage.js";

/** Builds the full `CorePlatform` this app injects at its root. */
export function createWebPlatform(): CorePlatform {
  return {
    storage: createLocalStorageKeyValueStorage(),
    structuredStorage: createIndexedDbStructuredStorage(),
    secureStorage: createWebCryptoSecureStorage(),
    network: createBrowserNetworkReachability(),
    clock: createBrowserClock(),
    notifications: createBrowserNotifications(),
    filePicker: createBrowserFilePicker(),
    sharing: createWebShareSharing(),
    clipboard: createBrowserClipboard(),
    audioInput: createBrowserAudioInput(),
    lifecycle: createDocumentVisibilityLifecycle(),
    logger: createConsoleLogger({ platform: "web" }),
  };
}
