/**
 * Pi UI Bridge `composer`-kind proposals (plan.md §9.2/§11.3 "composer
 * update with undo"; §11.7 `prompt-arbitrage`) for the Android composer —
 * the pure decision of what an accepted or undone proposal does to
 * `ComposerState.draft`.
 *
 * The proposal card itself is the extensions feature's renderer
 * (`../extensions/renderers/composer.tsx`/`composer-model.ts`), whose
 * `accept`/`undo` actions already dispatch through the process-wide
 * `AppCore.piUiSession.actionController`. This module is the other half:
 * it turns a *settled* accept into a draft write — `payload.text` under
 * `payload.mode` — and a settled undo back into the draft the proposal
 * replaced (`payload.previousText`, or the draft captured at accept time
 * when the daemon supplied none).
 *
 * RN-free by construction (no React Native, Expo, DOM, or React import),
 * matching this directory's `-model.ts` convention (`editor-text-model.ts`,
 * `queue-mode-model.ts`, ...), so every rule below is unit-testable
 * without a device or emulator. `Composer.tsx` owns only the subscription
 * and the `useState` write; it holds no transition logic of its own — the
 * same split `composer-model.ts`'s header establishes.
 *
 * Sibling-feature rule: this module never imports `features/extensions`.
 * The `PiUiComposerDraftSource` seam below is a narrow, structurally typed
 * shape the session mount builds over the shared action controller and
 * element store and passes down as `Composer`'s `piUiComposerDrafts` prop —
 * exactly how the route already passes `queueModeClient`/
 * `turnStatusClient`/`transcribeClient`.
 *
 * Two deliberate rules, identical to the web twin
 * (`apps/web/src/features/composer/pi-ui-composer-draft.ts`):
 *
 * - **A blank proposal never clears the draft** (the guarantee
 *   `../voice/voice-model.ts`'s `applyTranscriptToDraft` makes for a blank
 *   transcript).
 * - **Only `accept` and `undo` settle into a draft write**; any other
 *   settled action (a `decline`/`dismiss`, or a failure/timeout) leaves the
 *   draft exactly as it was.
 */
import type { extensions } from "@picompanion/frontend-core";
import type { PiUiComposerPayload, PiUiElement } from "@picompanion/protocol/pi-ui-bridge/schema";

/** The action id the composer proposal card uses for "use this text" (plan.md §11.3; fixture `prompt-arbitrage`). */
export const PI_UI_COMPOSER_ACCEPT_ACTION_ID = "accept";

/** The action id the composer proposal card uses for "restore what I had" (plan.md §11.3; fixture `prompt-arbitrage`). */
export const PI_UI_COMPOSER_UNDO_ACTION_ID = "undo";

/** A composer-kind proposal resolved for one settled Pi UI action target. */
export interface PiUiComposerProposal {
  readonly namespace: string;
  readonly elementId: string;
  readonly payload: PiUiComposerPayload;
}

export type PiUiComposerActionTarget = extensions.ExtensionActionTarget;
export type PiUiComposerActionState = extensions.ExtensionActionState;

/**
 * Where settled Pi UI actions come from, and how one target's
 * composer-kind proposal is resolved. In production the session mount
 * builds this over `AppCore.piUiSession`; a test supplies a fake.
 */
export interface PiUiComposerDraftSource {
  subscribe(
    listener: (target: PiUiComposerActionTarget, state: PiUiComposerActionState) => void,
  ): () => void;
  resolveProposal(target: PiUiComposerActionTarget): PiUiComposerProposal | null;
}

/**
 * The narrow slice of a live Pi UI session (`AppCore.piUiSession`) this
 * source needs. Structurally typed rather than importing the extensions
 * feature's own session type, so `features/composer` stays free of
 * sibling-feature imports; the session mount passes the real session's
 * `actionController.subscribe` and `store.getElement` in.
 */
export interface PiUiComposerDraftSession {
  /** The session/agent these elements belong to (plan.md §12.3 action identity). */
  agentId: string;
  subscribe(
    listener: (target: PiUiComposerActionTarget, state: PiUiComposerActionState) => void,
  ): () => void;
  getElement(agentId: string, namespace: string, elementId: string): PiUiElement | undefined;
}

/**
 * Builds the `PiUiComposerDraftSource` the session mount passes to the
 * composer from its live `AppCore.piUiSession`. Kept here (not in the
 * route) so the "is this target a composer element carrying a valid
 * payload" decision is unit-tested once rather than re-derived at the
 * mount; the mount supplies only the session's own stable
 * `subscribe`/`getElement`.
 */
export function createPiUiComposerDraftSource(
  session: PiUiComposerDraftSession,
): PiUiComposerDraftSource {
  return {
    subscribe: (listener) => session.subscribe(listener),
    resolveProposal: (target) => {
      if (target.agentId !== session.agentId) return null;
      const payload = session.getElement(
        session.agentId,
        target.namespace,
        target.elementId,
      )?.payload;
      if (!payload || payload.kind !== "composer") return null;
      return { namespace: target.namespace, elementId: target.elementId, payload };
    },
  };
}

/**
 * Appends `text` to `currentDraft`, separating the two with one space when
 * the existing draft does not already end in whitespace — the same append
 * rule `../voice/voice-model.ts`'s `applyTranscriptToDraft` uses.
 */
export function appendToComposerDraft(currentDraft: string, text: string): string {
  if (currentDraft.length === 0) return text;
  if (/\s$/.test(currentDraft)) return currentDraft + text;
  return `${currentDraft} ${text}`;
}

/**
 * The draft `payload.text` would produce under `payload.mode` — or the
 * unchanged draft for a blank proposal. `replace` (the schema's default)
 * and `prefill` both land the proposed text as the draft; `append` adds it
 * to whatever is already there.
 */
export function applyComposerProposal(currentDraft: string, payload: PiUiComposerPayload): string {
  if (payload.text.trim().length === 0) return currentDraft;
  if ((payload.mode ?? "replace") === "append") {
    return appendToComposerDraft(currentDraft, payload.text);
  }
  return payload.text;
}

/** The next draft plus the per-element undo records that produced it. */
export interface PiUiComposerSettlement {
  readonly draft: string;
  readonly previousByElement: ReadonlyMap<string, string>;
}

function composerElementKey(
  target: Pick<PiUiComposerActionTarget, "namespace" | "elementId">,
): string {
  return `${target.namespace}\u0001${target.elementId}`;
}

/**
 * Applies one action transition to the draft/undo-record pair. Returns
 * `null` — "change nothing" — for a non-successful settlement, an action
 * that is neither `accept` nor `undo`, a target with no composer proposal,
 * a blank proposal, and an `undo` with nothing recorded to restore.
 *
 * Pure: a new `previousByElement` map is returned rather than mutating the
 * argument, so the caller can drive `useState`/`useRef` without hidden
 * state and a test can assert without setup.
 */
export function applyPiUiComposerSettlement(
  draft: string,
  previousByElement: ReadonlyMap<string, string>,
  target: PiUiComposerActionTarget,
  state: PiUiComposerActionState,
  proposal: PiUiComposerProposal | null,
): PiUiComposerSettlement | null {
  if (state.status !== "success") return null;

  const key = composerElementKey(target);

  if (target.actionId === PI_UI_COMPOSER_ACCEPT_ACTION_ID) {
    if (!proposal) return null;
    const next = applyComposerProposal(draft, proposal.payload);
    if (next === draft) return null;
    const map = new Map(previousByElement);
    // The daemon's own `previousText` is the authoritative "what the user
    // had"; fall back to the draft this client held at accept time when the
    // payload omits it.
    map.set(key, proposal.payload.previousText ?? draft);
    return { draft: next, previousByElement: map };
  }

  if (target.actionId === PI_UI_COMPOSER_UNDO_ACTION_ID) {
    const previous = previousByElement.get(key) ?? proposal?.payload.previousText;
    if (previous === undefined) return null;
    const map = new Map(previousByElement);
    map.delete(key);
    return { draft: previous, previousByElement: map };
  }

  return null;
}
