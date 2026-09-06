/**
 * Wires a `ShareIntentPort` into `classifyShareIntent`, the session
 * chooser, and `materializeShareDraft` — the "receiving half" of
 * share-target support (T36E, plan.md §9.3, depends on T36C/T32P2).
 *
 * ## The route decision (this task's deliverable)
 *
 * Three routes were on the table for how a real `Intent` ever becomes a
 * `RawShareIntent` this module can consume:
 *
 * 1. **`expo-share-intent`** (third-party, unvetted, not installed).
 *    Solves both platforms and already handles `content://` URI
 *    plumbing (`FileProvider`) across OEM ROMs — real engineering that
 *    would otherwise have to be redone. Costs: a new, **unvetted**
 *    third-party native dependency sitting directly on the untrusted
 *    "another app's file bytes" boundary this module's own doc comment
 *    treats as sensitive (never logged, never in a URL) — auditing it
 *    is exactly the kind of review this module cannot skip just because
 *    the package is popular. It also requires a full config-plugin
 *    prebuild (adds a Kotlin `ShareActivity` + manifest entries) and,
 *    per this wave's rules, cannot be `npm install`-ed here at all.
 * 2. **Bare `expo-linking`** — already ruled out in
 *    `share-intent-port.ts`'s doc comment: `Linking.addEventListener
 *    ("url", …)` only ever carries a `VIEW`-action URI string, never an
 *    `ACTION_SEND` intent's `EXTRA_TEXT`/`EXTRA_STREAM` extras. The only
 *    way to force shared content through that channel would be to
 *    encode it into the URL/query string, which this task's brief
 *    explicitly prohibits ("a shared file's name, path and bytes are
 *    user content" — never in a URL). Not viable at any cost.
 * 3. **A small, in-repo native module** (an Expo **config plugin** that
 *    adds the `SEND` intent-filter to the existing launcher activity,
 *    paired with a minimal Expo Module — not a raw Java bridge — that
 *    reads `Intent.EXTRA_TEXT`/`EXTRA_STREAM` off `getIntent()`/
 *    `onNewIntent()` and exposes them as a `RawShareIntent`). Costs:
 *    someone has to write and maintain ~150 lines of Kotlin instead of
 *    consuming a maintained package, and it still needs `expo prebuild`
 *    to take effect — same rebuild requirement as option 1. Benefits:
 *    zero new third-party code on the sensitive path, no new dependency
 *    for `run-guard-no-duplicate-permission-state`-style guards or
 *    `T60C`'s install grant to worry about, and config plugins are
 *    exactly Expo's sanctioned mechanism for this ("survives
 *    `expo prebuild`" is what they are *for* — the plugin re-applies on
 *    every prebuild rather than editing generated native files by hand).
 *
 * **Decision: route 3, the small native module**, specifically because
 * of the security property in this task's brief ("never log any of
 * them ... nothing about a share may reach plain storage before the
 * user has chosen a session") — that bar is far easier to hold to code
 * this repository owns and can review line-by-line than to a
 * third-party package it has not vetted. Route 1 is not rejected
 * forever; if `T60C`'s install grant lands and `expo-share-intent` gets
 * an actual license/security review, that review could flip this
 * decision. **What would falsify this choice**: if the native module
 * turns out to need substantially more than the ~150-line estimate
 * above (e.g. per-OEM `FileProvider` workarounds route 1 already
 * solved), the maintenance cost would likely exceed the review cost of
 * vetting route 1, and the decision should flip.
 *
 * **What this task can actually prove here**: nothing. No native code
 * can be authored, compiled, or run in this sandbox — no `expo
 * prebuild`, no Gradle, no emulator, no `adb` (this wave's hard rules).
 * Writing Kotlin no build in this environment can compile would be
 * exactly the "claim proven on a device" failure this wave's brief
 * warns against. So route 3's native half is **not built here** — it
 * is a named gap for whichever task first has native-build tooling
 * (T37E's real-device Maestro proof is the nearest candidate; naming
 * the exact follow-up task ID is for whoever plans that wave, since
 * none of the task IDs handed to this wave own it). What *is* built
 * here, behind the `ShareIntentPort` seam T36C already defined: the
 * receiver below, proven end-to-end against a scripted fake port; the
 * `android.intentFilters` block (`share-intent-config.ts`), which is
 * real and takes effect the moment a real port exists behind it; and
 * this decision record.
 *
 * ## Cold start, named
 *
 * An `ACTION_SEND` intent can reach the app in three distinct shapes,
 * each given a named outcome so a share is never silently dropped:
 *
 * - **Before `AppCore` exists** (the app was cold-started *by* the
 *   share): `ShareIntentPort.getInitialShareIntent()` mirrors
 *   `Linking.getInitialURL()`'s shape for exactly this case. `start()`
 *   below reads it once. **The one real constraint this seam imposes
 *   on its caller**: `start()` must run before first paint, the same
 *   place `AppCoreProvider` (`app/core-context.tsx`) already gates
 *   children on `listHostProfiles()` resolving — see this feature's
 *   report for the exact seam filed against `T32S11`.
 * - **While the user is mid-session** (the app was already running):
 *   delivered through `ShareIntentPort.subscribe()`, same as any other
 *   `Linking` "url" event. Handled identically to the cold-start case
 *   once received — both go through `handleRawIntent()` below.
 * - **A second intent arriving before the first is resolved**: not a
 *   case this module invents handling for — `share-session-chooser.ts`
 *   already names it exactly (`presentShareForChoice`'s `"queued"` /
 *   `"queued-replacing-pending"` outcomes, "last-share-wins for the
 *   *queued* slot only"). This module's job is only to keep calling
 *   `presentShareForChoice` with `currentState`, never resetting it, so
 *   that existing queuing logic actually runs.
 */
import type { ClassifiedShareContent, RawShareIntent, ShareRefusal } from "./share-intent-model.js";
import { classifyShareIntent } from "./share-intent-model.js";
import type { ShareIntentPort } from "./share-intent-port.js";
import {
  chooseSession,
  dismissChooser,
  IDLE_SHARE_CHOOSER_STATE,
  presentShareForChoice,
  type ChooseSessionOutcome,
  type PresentShareOutcome,
  type ShareChooserState,
} from "./share-session-chooser.js";
import {
  materializeShareDraft,
  type ShareDraftDeps,
  type ShareDraftOutcome,
} from "./share-draft-controller.js";

export type ShareIntentReceiverEvent =
  | { type: "refused"; refusal: ShareRefusal }
  | { type: "presented"; outcome: PresentShareOutcome; state: ShareChooserState }
  | { type: "resolved"; sessionId: string; draft: ShareDraftOutcome }
  | { type: "invalid-session"; sessionId: string }
  | { type: "cancelled" };

export interface ShareIntentReceiverDeps {
  port: ShareIntentPort;
  /** Read fresh at every presentation/resolution — never a snapshot taken once at `start()`, matching `chooseSession`'s own re-validation. */
  getCandidateSessionIds: () => readonly string[];
  draftDeps: ShareDraftDeps;
  onEvent: (event: ShareIntentReceiverEvent) => void;
}

export interface ShareIntentReceiver {
  /**
   * Subscribes, then reads the launch intent (subscribing first so
   * nothing delivered in the gap between the two calls is missed).
   * Idempotent — a second call is a no-op. Callers must await this (or
   * at least call it) before first paint; see this module's doc
   * comment.
   */
  start(): Promise<void>;
  /** Unsubscribes from the port. Safe to call whether or not `start()` ran. */
  stop(): void;
  getState(): ShareChooserState;
  /** Resolves the open chooser to `sessionId`. A no-op when no chooser is open (mirrors `chooseSession`'s `null`). */
  resolveChoice(sessionId: string): Promise<void>;
  /** Dismisses the open chooser without choosing a session. A no-op when none is open. */
  dismiss(): void;
}

/**
 * Builds a `ShareIntentReceiver` over an injected `ShareIntentPort`.
 * Every dependency is injected — no `console.*`, no direct platform
 * access — so this is provable against a scripted fake end to end; see
 * `share-intent-receiver.test.ts`.
 */
export function createShareIntentReceiver(deps: ShareIntentReceiverDeps): ShareIntentReceiver {
  let state: ShareChooserState = IDLE_SHARE_CHOOSER_STATE;
  let unsubscribe: (() => void) | null = null;
  let started = false;

  function present(content: ClassifiedShareContent): void {
    const result = presentShareForChoice(state, content, deps.getCandidateSessionIds());
    state = result.state;
    deps.onEvent({ type: "presented", outcome: result.outcome, state });
  }

  function handleRawIntent(intent: RawShareIntent): void {
    const classification = classifyShareIntent(intent);
    if (!classification.accepted) {
      deps.onEvent({ type: "refused", refusal: classification });
      return;
    }
    present(classification.content);
  }

  return {
    async start() {
      if (started) return;
      started = true;
      unsubscribe = deps.port.subscribe(handleRawIntent);
      const initial = await deps.port.getInitialShareIntent();
      if (initial) handleRawIntent(initial);
    },

    stop() {
      unsubscribe?.();
      unsubscribe = null;
      started = false;
    },

    getState() {
      return state;
    },

    async resolveChoice(sessionId: string): Promise<void> {
      const result = chooseSession(state, sessionId, deps.getCandidateSessionIds());
      if (!result) return; // no chooser open — matches chooseSession's own no-op contract
      state = result.state;

      const outcome: ChooseSessionOutcome = result.outcome;
      if (outcome === "resolved" && result.state.status === "resolved") {
        const draft = await materializeShareDraft(result.state.content, sessionId, deps.draftDeps);
        deps.onEvent({ type: "resolved", sessionId, draft });
      } else {
        deps.onEvent({ type: "invalid-session", sessionId });
      }

      if (result.nextPending) present(result.nextPending);
    },

    dismiss(): void {
      const result = dismissChooser(state);
      if (!result) return; // no chooser open — matches dismissChooser's own no-op contract
      state = result.state;
      deps.onEvent({ type: "cancelled" });
      if (result.nextPending) present(result.nextPending);
    },
  };
}
