/**
 * Platform interfaces (plan.md §7.3).
 *
 * This directory defines narrow platform interfaces only — never
 * implementations. `apps/web` and `apps/android` each provide concrete
 * adapters (in their own `platform/` directories) and inject them into
 * `frontend-core` consumers. Nothing under `packages/frontend-core/src`
 * may import React, React Native, Expo, DOM types, or browser globals;
 * see `../import-guard.test.ts` and this package's `.oxlintrc.json` for
 * the enforced guard.
 */

export type {
  KeyValueStorage,
  StructuredStorage,
  StructuredStorageListOptions,
} from "./storage.js";
export type { SecureStorage } from "./secure-storage.js";
export type { NetworkConnectionKind, NetworkReachability, NetworkStatus } from "./network.js";
export type { Clock, TimerHandle } from "./clock.js";
export type {
  NotificationPayload,
  NotificationPermissionState,
  NotificationsPlatform,
} from "./notifications.js";
export type { FilePickOptions, FilePicker, PickedFile } from "./file-picker.js";
export type { ShareFilesOptions, ShareTextOptions, ShareableFile, Sharing } from "./sharing.js";
export type { Clipboard } from "./clipboard.js";
export type {
  AudioInput,
  AudioInputChunk,
  AudioInputOptions,
  AudioInputSession,
} from "./audio-input.js";
export type { AppLifecycle, AppLifecycleState } from "./lifecycle.js";
export type { LogFields, Logger } from "./logging.js";
export type { FrameCallback, FrameClock, FrameClockPhase, FrameTickInfo } from "./frame-clock.js";
export { TestFrameClock } from "./frame-clock.js";

import type { AudioInput } from "./audio-input.js";
import type { Clipboard } from "./clipboard.js";
import type { Clock } from "./clock.js";
import type { FilePicker } from "./file-picker.js";
import type { AppLifecycle } from "./lifecycle.js";
import type { Logger } from "./logging.js";
import type { NetworkReachability } from "./network.js";
import type { NotificationsPlatform } from "./notifications.js";
import type { SecureStorage } from "./secure-storage.js";
import type { Sharing } from "./sharing.js";
import type { KeyValueStorage, StructuredStorage } from "./storage.js";

/**
 * Every narrow platform interface bundled together, for consumers (such
 * as `connection/` and `offline/` in later phases) that need to accept a
 * single injected platform object rather than eleven separate
 * parameters. Individual interfaces remain independently importable.
 */
export interface CorePlatform {
  storage: KeyValueStorage;
  structuredStorage: StructuredStorage;
  secureStorage: SecureStorage;
  network: NetworkReachability;
  clock: Clock;
  notifications: NotificationsPlatform;
  filePicker: FilePicker;
  sharing: Sharing;
  clipboard: Clipboard;
  audioInput: AudioInput;
  lifecycle: AppLifecycle;
  logger: Logger;
  /**
   * Not yet part of the bundled `CorePlatform` object — see
   * `platform/frame-clock.ts` (T45A1). It stays independently
   * importable so `T45A2`'s streaming batcher and each host's wiring
   * task can accept it directly, without every existing `CorePlatform`
   * producer needing to supply one before that work lands.
   */
}
