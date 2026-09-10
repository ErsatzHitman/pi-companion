/**
 * The Android pinned live-extension area (plan.md §9.2 "pinned live
 * extension area above the composer", §11.5 "`pinned` remains visible near
 * the composer or in the web rail"; T34A4).
 *
 * This is the first T34 task that makes the whole chain live: nothing
 * before it imported `registry-index.ts` from anywhere the app actually
 * mounts, so every Pi UI element rendered as a "no renderer" diagnostic on
 * a real device regardless of which kinds T34A1-T34A3 had registered. This
 * component is that mount point's content — `apps/android/src/app-shell/`
 * (owned by T32S3 this wave) puts it into the `liveExtension` slot
 * `compact-shell-slots.ts` already reserves directly above `composer` in
 * `COMPACT_SHELL_SLOT_ORDER`:
 *
 * ```ts
 * ["header", "statusStrip", "transcript", "liveExtension", "composer"]
 * ```
 *
 * so "above the composer" is a property of that ordering, not of anything
 * this component does — it only has to behave correctly *given* that slot.
 *
 * What this component is responsible for, and how:
 *
 * - **only `pinned`-placement elements appear here**
 *   (`pinned-model.ts`'s `selectPinnedElements`), same rule as the web
 *   rail's `selectRailElements`;
 * - **it collapses only when genuinely empty** — when there is no
 *   `pinned`-placement element at all (`resolvePinnedAreaVisibility`),
 *   this component renders `null`, contributing zero height to the
 *   `liveExtension` slot. A pinned element that exists but fails to
 *   validate, names an unrecognized kind, or has no renderer registered
 *   yet is **not** empty — it still renders, as one `ExtensionDiagnostic`
 *   via `PiUiElementView`'s existing pipeline, and the area stays visible
 *   around it;
 * - **it never covers the composer or the IME** — this is the one
 *   criterion this file cannot prove from inside a `vitest` run: there is
 *   no layout engine, no emulator, and no IME here. What this component
 *   *does* do, and what `pinned-model.ts`'s `PINNED_AREA_LAYOUT_CONTRACT`
 *   declares and is unit-tested: it sits in normal document flow (no
 *   `Modal`, no absolute/overlay positioning, no `Portal`) so it can never
 *   paint over the composer beneath it in the slot order, and its own
 *   `ScrollView` is height-capped — at `resolvePinnedAreaMaxHeightDp`
 *   of the window height (T342: `PINNED_AREA_MAX_HEIGHT_DP` or
 *   `PINNED_AREA_MAX_WINDOW_SHARE` of the window, whichever is smaller;
 *   previously the constant alone) — so a long pinned list scrolls
 *   internally instead of growing the slot without bound. Because it is plain flow content, not an overlay, it also makes
 *   no claim on keyboard/IME ownership — plan.md §9.3's "the composer must
 *   retain keyboard ownership when an extension sheet opens" is about a
 *   `sheet`-placement panel's `Modal`/`Portal` choice, which is a different
 *   component (a future `sheet` kind renderer) than this one. Real
 *   on-screen non-overlap and real IME behavior remain for T37 (Maestro)
 *   and T59 (real device) to prove; this file does not claim either.
 *
 * Each pinned element still renders through the same per-element pipeline
 * as any other placement (`PiUiElementView`: canonical validation, the
 * unknown-kind/oversized/no-renderer/invalid-payload/ok decision, a
 * per-element error boundary, dev-mode revision badge, and the dangerous-
 * action confirmation gate) — this component adds nothing to that
 * pipeline, it only selects which elements reach it and bounds the region
 * they render inside.
 */
import { useMemo } from "react";
import { ScrollView, StyleSheet, View, useWindowDimensions } from "react-native";

import { extensions } from "@picompanion/frontend-core";
import type { Logger } from "@picompanion/frontend-core";
import type { PiUiElement } from "@picompanion/protocol/pi-ui-bridge/schema";

import { useTheme } from "../../ui/theme/theme-context";
import {
  resolvePinnedAreaMaxHeightDp,
  resolvePinnedAreaVisibility,
  selectPinnedElements,
} from "./pinned-model";
import { PiUiElementView } from "./registry-view";

export interface PinnedLiveExtensionAreaProps {
  /**
   * One agent's live Pi UI elements, in any placement. This component does
   * its own §11.5 placement filtering (`selectPinnedElements`), so a
   * caller (T32S3's session route) can pass an agent's full element set
   * straight from `PiUiElementStore` without pre-filtering — matching the
   * web rail's `PiExtensionRail` convention.
   */
  elements: readonly PiUiElement[];
  /** The agent these elements belong to (plan.md §12.3 action identity). */
  agentId: string;
  /** Dispatches and tracks this agent's Pi UI actions (frontend-core's `ExtensionActionController`). */
  actionController: extensions.ExtensionActionController;
  /** This agent's current known Pi UI Bridge revision, for each element's dev-mode stale-state badge. */
  revision?: number;
  logger?: Logger;
  testId?: string;
}

/**
 * Renders the `liveExtension` slot's content: every currently-`pinned`
 * element for one agent, or nothing at all when none are pinned.
 *
 * Deliberately returns `null` rather than an `EmptyState` placeholder when
 * collapsed (unlike the web rail, which always occupies its fixed sidebar
 * column and so shows "No live extensions" there) — on the compact Android
 * layout this area shares vertical space with the transcript, so an empty
 * placeholder card would permanently steal transcript height for a slot
 * that plan.md §9.2 only reserves while something is actually pinned.
 */
export function PinnedLiveExtensionArea({
  elements,
  agentId,
  actionController,
  revision,
  logger,
  testId = "pinned-live-extension-area",
}: PinnedLiveExtensionAreaProps) {
  const { theme } = useTheme();
  // T342: the cap follows the window, so a phone keeps transcript and
  // composer room while a taller window shows two pinned cards at once.
  const { height: windowHeight } = useWindowDimensions();
  const maxHeight = resolvePinnedAreaMaxHeightDp(windowHeight);
  const styles = useMemo(() => createStyles(theme, maxHeight), [theme, maxHeight]);

  if (resolvePinnedAreaVisibility(elements) === "collapsed") {
    return null;
  }

  const pinned = selectPinnedElements(elements);

  return (
    <View style={styles.wrapper} testID={testId}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        accessibilityLabel="Live extensions"
        testID={`${testId}-scroll`}
      >
        {pinned.map((element) => (
          <PiUiElementView
            key={extensions.piUiElementKeyOf(element)}
            element={element}
            agentId={agentId}
            actionController={actionController}
            revision={revision}
            logger={logger}
            testId={`${testId}-${extensions.piUiElementKeyOf(element)}`}
          />
        ))}
      </ScrollView>
    </View>
  );
}

function createStyles(theme: ReturnType<typeof useTheme>["theme"], maxHeight: number) {
  return StyleSheet.create({
    wrapper: {
      maxHeight,
    },
    scroll: {
      maxHeight,
    },
    content: {
      gap: theme.spacing[2],
      padding: theme.spacing[2],
    },
  });
}
