/**
 * @picompanion/frontend-core
 *
 * Platform-neutral daemon/UI state shared by `apps/web` and
 * `apps/android` (plan.md §6/§7). This package owns host/connection
 * state, `DaemonClient` lifecycle, timeline ingestion and
 * reconciliation, composer/draft/outbox state, permission and
 * extension dialog state, Pi UI state, tool-call view models, file and
 * terminal session controllers, platform-neutral navigation intents,
 * context-window/cache telemetry, and offline cache serialization.
 *
 * Domain logic lives in per-domain directories (`connection/`, `hosts/`,
 * `sessions/`, `timeline/`, `composer/`, `permissions/`, `extensions/`,
 * `tools/`, `files/`, `offline/`, `navigation/`, `telemetry/`,
 * `testing/`, `security/`, `actions/` (T103 — single-answer arbitration for
 * approvals and dialogs, plan.md §12.3), `rewind/` (T395 — the platform-neutral
 * rewind/checkpoint controller, plan.md §4.2)). As of T14 (Phase 1) those
 * directories are skeleton stubs; the Phase 2+ tasks listed in
 * docs/issues-from-plan.md fill them in.
 *
 * `platform/` defines the narrow platform interfaces from plan.md §7.3
 * (storage, secure storage, network reachability, clock, notifications,
 * file picking, sharing, clipboard, audio input, lifecycle, logging) and
 * §7.4/§14.5 (frame clock, T45A1). Those are real, finished interfaces
 * as of T14/T45A1 — `apps/web` and `apps/android` implement them; this
 * package never does.
 *
 * Repository invariant, enforced by `.oxlintrc.json` in this package and
 * by `./import-guard.test.ts`: nothing under `packages/frontend-core/src`
 * may import React, React Native, Expo, DOM types, or browser globals.
 */

export type {
  AppLifecycle,
  AppLifecycleState,
  AudioInput,
  AudioInputChunk,
  AudioInputOptions,
  AudioInputSession,
  Clipboard,
  Clock,
  CorePlatform,
  FilePickOptions,
  FilePicker,
  FrameCallback,
  FrameClock,
  FrameClockPhase,
  FrameTickInfo,
  KeyValueStorage,
  LogFields,
  Logger,
  NetworkConnectionKind,
  NetworkReachability,
  NetworkStatus,
  NotificationPayload,
  NotificationPermissionState,
  NotificationsPlatform,
  PickedFile,
  SecureStorage,
  ShareFilesOptions,
  ShareTextOptions,
  ShareableFile,
  Sharing,
  StructuredStorage,
  StructuredStorageListOptions,
  TimerHandle,
} from "./platform/index.js";
export { TestFrameClock } from "./platform/index.js";

export * as actions from "./actions/index.js";
export * as composer from "./composer/index.js";
export * as connection from "./connection/index.js";
export * as extensions from "./extensions/index.js";
export * as files from "./files/index.js";
export * as hosts from "./hosts/index.js";
export * as navigation from "./navigation/index.js";
export * as offline from "./offline/index.js";
export * as permissions from "./permissions/index.js";
export * as rewind from "./rewind/index.js";
export * as security from "./security/index.js";
export * as sessions from "./sessions/index.js";
export * as telemetry from "./telemetry/index.js";
export * as terminal from "./terminal/index.js";
export * as testing from "./testing/index.js";
export * as timeline from "./timeline/index.js";
export * as tools from "./tools/index.js";
