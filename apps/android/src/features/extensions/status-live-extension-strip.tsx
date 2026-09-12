/**
 * The Android status strip's live content (plan.md §9.2 "compact status
 * strip", §11.3's placement table, §11.5 "`status` appears in the session
 * header/status strip").
 *
 * The fourth live Pi UI mount point, alongside `PinnedLiveExtensionArea`
 * (the `liveExtension` slot) and the inline/sheet selectors: it renders
 * every currently-`status` element for one agent into the existing
 * `statusStrip` slot of `CompactSessionShell`
 * (`app-shell/compact-shell.tsx`), directly beneath `TranscriptStatusStrip`.
 * Before it, no code path selected `placement === "status"` at all —
 * `selectPinnedElements` keeps only `pinned` — so the daemon's synthesized
 * `workflow:progress`/`pi-goal:status` status elements, plus the
 * `minimal-status` footer, plan-mode's `!mode`, prompt-arbitrage's footer
 * status, the `pi-goal` status chip, the `workflows` status, and the
 * advisor's live panel status, all sat in the live store unrendered.
 *
 * Like `PinnedLiveExtensionArea`, this component adds nothing to the
 * per-element pipeline: each element renders through the same
 * `PiUiElementView` (canonical validation, the unknown-kind/oversized/
 * no-renderer/invalid-payload/ok decision, a per-element error boundary,
 * dev-mode revision badge, and the dangerous-action confirmation gate).
 * It only selects which elements reach it and returns `null` — contributing
 * zero height — when there is no `status` element at all, the same
 * "collapses only when genuinely empty" rule the pinned area follows.
 */
import { useMemo } from "react";
import { StyleSheet, View } from "react-native";

import { extensions } from "@picompanion/frontend-core";
import type { Logger } from "@picompanion/frontend-core";
import type { PiUiElement } from "@picompanion/protocol/pi-ui-bridge/schema";

import { useTheme } from "../../ui/theme/theme-context";
import { PiUiElementView } from "./registry-view";
import { selectStatusElements } from "./status-model";

export interface StatusLiveExtensionStripProps {
  /**
   * One agent's live Pi UI elements, in any placement. This component does
   * its own §11.5 placement filtering (`selectStatusElements`), so a
   * caller can pass an agent's full element set straight from
   * `PiUiElementStore` without pre-filtering — matching the pinned area's
   * convention.
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
 * Renders every currently-`status` element for one agent, or nothing at all
 * when none are `status`-placed. Returns `null` rather than an empty
 * placeholder so an absent status contributes zero height to the compact
 * shell's `statusStrip` slot.
 */
export function StatusLiveExtensionStrip({
  elements,
  agentId,
  actionController,
  revision,
  logger,
  testId = "status-live-extension-strip",
}: StatusLiveExtensionStripProps) {
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);

  const statusElements = selectStatusElements(elements);
  if (statusElements.length === 0) {
    return null;
  }

  return (
    <View style={styles.list} testID={testId}>
      {statusElements.map((element) => (
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
    </View>
  );
}

function createStyles(theme: ReturnType<typeof useTheme>["theme"]) {
  return StyleSheet.create({
    list: { gap: theme.spacing[2] },
  });
}
