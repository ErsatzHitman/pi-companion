/**
 * `features/share` barrel (T36C classification/chooser/draft; T36E
 * receiver + `android.intentFilters`; T36F native module + real
 * `ShareIntentPort`; T69 chooser screen + runtime, plan.md §9.3).
 *
 * **Mounted as of T69.** `../../app-shell/core.ts`'s `AppCore.shareIntentPort`
 * is `createNativeShareIntentPort()`'s first live production call site;
 * `../../app/share.tsx` wraps it in `share-chooser-runtime.ts`'s
 * `ShareChooserRuntime` and renders `ShareChooserScreen.tsx` — the entry
 * point this feature previously had none of (see that route's own doc
 * comment for exactly what it wires, and the one gap it discloses and
 * files against `T32S15`: nothing yet *navigates to* `/share`
 * automatically when a live share arrives while some other screen is on
 * screen — today it is reachable by navigating to `/share` directly,
 * and by the cold-start `getInitialShareIntent()` path once that route
 * itself mounts).
 *
 * `ShareChooserScreen.tsx` is deliberately **not** re-exported here — it
 * reaches `react-native` (via `../../ui/primitives`), so a test importing
 * this whole barrel would need every RN mock that entails. Import
 * `./ShareChooserScreen.js` directly.
 *
 * **T115:** `createNativeShareIntentPort` below DOES now have a real
 * caller through this barrel — `../../app-shell/core.ts` imports it (and
 * the `ShareIntentPort` type) from here rather than deep-importing
 * `./share-intent-native-port.js` directly, giving this file itself a
 * production call site (the P6-W4 import-graph walk found this barrel,
 * `index.ts`, referenced by nothing). That is safe for the same reason
 * `ShareChooserScreen.tsx` stays unexported above: `core.ts` is not an
 * incidental caller picking up RN/`expo-modules-core` by accident — it
 * already needs `createNativeShareIntentPort()` regardless of which path
 * imports it, and its own test (`core.test.ts`) already mocks
 * `expo-modules-core` for exactly that reason. Routing through the
 * barrel adds no new mock requirement to any test; it only makes the
 * barrel itself live. A caller with no other reason to touch
 * `expo-modules-core` should still prefer the direct
 * `./share-intent-native-port.js` import, not this barrel.
 */
export {
  ACCEPTED_FILE_MIME_TYPES,
  MAX_SHARE_FILE_BYTES,
  classifyShareIntent,
} from "./share-intent-model";
export type {
  ClassifiedShareContent,
  RawShareIntent,
  RawShareIntentFile,
  ShareAcceptance,
  ShareClassification,
  ShareContentKind,
  ShareIntentAction,
  ShareRefusal,
  ShareRefusalReason,
} from "./share-intent-model";

export {
  IDLE_SHARE_CHOOSER_STATE,
  chooseSession,
  dismissChooser,
  presentShareForChoice,
} from "./share-session-chooser";
export type {
  ChooseSessionOutcome,
  ChooseSessionResult,
  DismissChooserResult,
  PresentShareOutcome,
  PresentShareResult,
  ShareChooserState,
} from "./share-session-chooser";

export { drainQueuedShares, materializeShareDraft } from "./share-draft-controller";
export type { ShareDraftDeps, ShareDraftOutcome, SharePayload } from "./share-draft-controller";

export { createUnavailableShareIntentPort } from "./share-intent-port";
export type { ShareIntentPort } from "./share-intent-port";

// `share-intent-native-port.ts` imports `expo-modules-core` at its top
// level (see its doc comment) — a test that imports THIS barrel without
// first `vi.mock`-ing `expo-modules-core` will hit the same
// react-native-reaching-module Vitest limitation every other native
// adapter in this app carries (`../../platform/haptics/
// vibration-platform.ts`, `../../platform/lifecycle.ts`). Import
// `./share-intent-native-port.js` directly, not through this barrel, in
// any test that does not need it.
export {
  createNativeShareIntentPort,
  createShareIntentPortFromNativeModule,
  parseNativeSharePayload,
} from "./share-intent-native-port";
export type { NativeEventSubscription, ShareIntentNativeModule } from "./share-intent-native-port";

export { buildShareIntentFilters } from "./share-intent-config";
export type { ShareIntentFilter, ShareIntentFilterData } from "./share-intent-config";

export { createShareIntentReceiver } from "./share-intent-receiver";
export type {
  ShareIntentReceiver,
  ShareIntentReceiverDeps,
  ShareIntentReceiverEvent,
} from "./share-intent-receiver";

export { createShareChooserRuntime } from "./share-chooser-runtime";
export type {
  ShareChooserRuntime,
  ShareChooserRuntimeDeps,
  ShareChooserSnapshot,
} from "./share-chooser-runtime";

export { useShareChooserSnapshot } from "./use-share-chooser";
