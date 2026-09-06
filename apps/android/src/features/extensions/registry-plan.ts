/**
 * Pure per-element render decision (plan.md §11.4; T34A1).
 *
 * `registry-view.tsx` needs to decide, for one live `PiUiElement`, whether
 * to show one visible diagnostic (unrecognized kind, no renderer yet, or a
 * payload that failed canonical validation), cap an oversized payload with
 * an explanation, or hand off to the registered kind renderer. That
 * decision is pure data-in/data-out — it needs the element, the registry,
 * and a byte cap, nothing React Native — so it lives here, separate from
 * the React Native component that acts on it.
 *
 * Splitting it out this way matters for this workspace specifically:
 * `apps/android`'s `vitest` setup cannot import anything that transitively
 * pulls in the `react-native` package (its Flow-annotated source fails to
 * parse under Vitest/esbuild here — see `registry.test.ts`'s doc comment
 * for the reproduction), so a decision that lived only inside a
 * `.tsx` component would be unverifiable by a unit test in this workspace.
 * Kept here, `resolvePiUiElementRenderDecision` is directly unit-tested
 * (`registry-plan.test.ts`) against the exact two acceptance criteria that
 * are decisions rather than rendering: "an unknown kind produces one
 * diagnostic" and "oversized payloads are capped with an explanation".
 */

import {
  PI_UI_PAYLOAD_KINDS,
  type PiUiElement,
  type PiUiKind,
} from "@picompanion/protocol/pi-ui-bridge/schema";

import {
  PI_UI_MAX_PAYLOAD_BYTES,
  estimatePiUiPayloadBytes,
  type PiUiKindRenderer,
  type PiUiPayloadForKind,
  type PiUiRendererRegistry,
} from "./registry";

const KNOWN_KINDS = new Set<string>(PI_UI_PAYLOAD_KINDS);

/** One visible diagnostic's content (plan.md §11.2 "a visible diagnostic with source and safe raw details"). */
export interface RegistryDiagnostic {
  title: string;
  message: string;
}

export type PiUiElementRenderDecision<K extends PiUiKind = PiUiKind> =
  | { status: "unknown-kind"; diagnostic: RegistryDiagnostic }
  | { status: "oversized"; diagnostic: RegistryDiagnostic; bytes: number; maxBytes: number }
  | { status: "no-renderer"; diagnostic: RegistryDiagnostic }
  | { status: "invalid-payload"; diagnostic: RegistryDiagnostic }
  | { status: "ok"; Renderer: PiUiKindRenderer<K>; payload: PiUiPayloadForKind<K> };

/**
 * Decides how one live element should render, in the same order
 * `registry-view.tsx` (and the web registry's `PiUiElementView`) apply the
 * checks:
 *
 * 1. an unrecognized `kind` (outside plan.md §11.3's frozen ten) — always
 *    exactly **one** diagnostic, never a diagnostic per malformed field;
 * 2. an oversized payload — capped before it ever reaches a renderer, with
 *    an explanation naming both the measured size and the limit;
 * 3. a known kind with either no renderer registered yet, or a payload
 *    that failed canonical validation (`undefined` after
 *    `normalizePiUiElement` in `@picompanion/frontend-core`);
 * 4. otherwise, the registered renderer and its validated payload.
 */
export function resolvePiUiElementRenderDecision(
  element: PiUiElement,
  registry: PiUiRendererRegistry,
  maxPayloadBytes: number = PI_UI_MAX_PAYLOAD_BYTES,
): PiUiElementRenderDecision {
  const kindIsKnown = KNOWN_KINDS.has(element.kind);
  const payload = element.payload as PiUiPayloadForKind<PiUiKind> | undefined;

  if (!kindIsKnown) {
    return {
      status: "unknown-kind",
      diagnostic: {
        title: "Unrecognized element kind",
        message: `"${element.kind}" is not one of the known Pi UI Bridge kinds.`,
      },
    };
  }

  const bytes = estimatePiUiPayloadBytes(payload);
  if (bytes > maxPayloadBytes) {
    return {
      status: "oversized",
      bytes,
      maxBytes: maxPayloadBytes,
      diagnostic: {
        title: "Element payload too large to render",
        message: `${bytes.toLocaleString()} bytes exceeds the ${maxPayloadBytes.toLocaleString()}-byte limit.`,
      },
    };
  }

  const Renderer = registry.get(element.kind as PiUiKind);
  if (!Renderer) {
    return {
      status: "no-renderer",
      diagnostic: {
        title: "No renderer available yet",
        message: `"${element.kind}" has no registered Android renderer.`,
      },
    };
  }

  if (payload === undefined) {
    return {
      status: "invalid-payload",
      diagnostic: {
        title: "Element payload could not be validated",
        message: `This "${element.kind}" element's payload does not match its kind's shape.`,
      },
    };
  }

  return { status: "ok", Renderer, payload };
}
