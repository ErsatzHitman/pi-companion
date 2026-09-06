import { useEffect, useMemo } from "react";
import { StyleSheet, Text, View } from "react-native";

import type { permissions } from "@picompanion/frontend-core";

import { Banner, Button, Sheet } from "../../ui/primitives";
import { ApprovalForm } from "../../ui/recipes";
import { useTheme } from "../../ui/theme/theme-context";
import { describeWaitingCount, resolveApprovalPanel } from "./approvals-queue-model";

export interface ApprovalsHostProps {
  current: permissions.PermissionDialogViewModel | null;
  waitingCount: number;
  error: string | null;
  onAnswer: (response: permissions.AgentPermissionResponse) => void;
  onDismissError: () => void;
  /**
   * Reports the sheet's open/closed transitions so a mount point can
   * keep a shared `ComposerFocusState` (`features/composer/composer-
   * focus-model.ts`, unowned this wave) in sync — e.g.
   * `onOpenChange={(open) => setFocusState((s) => open ? openSheet(s,
   * "extension") : closeSheet(s))}`. `approvals-sheet-focus.test.ts`
   * proves that composition never steals or grants keyboard ownership
   * regardless of when this fires. Omit if nothing needs to observe it.
   */
  onOpenChange?: (open: boolean) => void;
  testId?: string;
}

/**
 * Presentational host for the Android approvals surface (T33B5).
 * Composes the existing `Sheet` primitive (T32S5's Portal-backed sheet
 * — never a detached `Modal`, plan.md §9.3) with the existing
 * `ApprovalForm` recipe (composed as-is, never forked) for the common
 * two-button case, falling back to a plain button row for a request
 * `ApprovalForm`'s fixed pair cannot represent, and to a single Dismiss
 * for a presentation this Android surface does not yet render as a real
 * decision (see `approvals-queue-model.ts`'s doc comment for exactly
 * which — Tier-1 `select`/`input`/`editor`/`confirm`/`question` extension
 * dialogs).
 *
 * `Sheet`'s own `onClose` (scrim tap, Android back gesture) always sends
 * `panel.closeResponse` — the deny/cancel side — rather than leaving the
 * request unanswered: the daemon is still blocked waiting for *some*
 * response (plan.md §11.2), so "close without deciding" is not offered
 * as a silent no-op.
 *
 * Renders nothing (`null`) when there is no error and no pending
 * request — mounting this into a screen never changes its layout until
 * a real request arrives, matching `ApprovalsHost.tsx` on web.
 */
export function ApprovalsHost({
  current,
  waitingCount,
  error,
  onAnswer,
  onDismissError,
  onOpenChange,
  testId,
}: ApprovalsHostProps) {
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);

  const open = current !== null;
  useEffect(() => {
    onOpenChange?.(open);
  }, [open, onOpenChange]);

  const panel = current ? resolveApprovalPanel(current) : null;
  const waitingText = describeWaitingCount(waitingCount);
  const sheetTestId = testId ?? "approvals-sheet";

  return (
    <>
      {error ? (
        <Banner
          tone="danger"
          message={`Could not send your answer: ${error}`}
          actionLabel="Dismiss"
          onAction={onDismissError}
          testId="approvals-error-banner"
        />
      ) : null}
      <Sheet
        open={open}
        title="Approval needed"
        description="Pi needs your decision to continue."
        onClose={() => panel && onAnswer(panel.closeResponse)}
        testId={sheetTestId}
      >
        {panel?.kind === "binary" ? (
          <ApprovalForm
            toolLabel={panel.toolLabel}
            detail={panel.detail}
            dangerous={panel.dangerous}
            onApprove={() => onAnswer(panel.approveResponse)}
            onDeny={() => onAnswer(panel.denyResponse)}
            testId={`${sheetTestId}-form`}
          />
        ) : null}
        {panel?.kind === "actions-row" ? (
          <View style={styles.actionsRow} testID={`${sheetTestId}-actions-row`}>
            <Text style={styles.legend}>{panel.toolLabel} needs your approval</Text>
            <Text style={styles.detail}>{panel.detail}</Text>
            {panel.dangerous ? (
              <Text style={styles.warning}>Requires extra caution — this cannot be undone.</Text>
            ) : null}
            <View style={styles.actionsButtons}>
              {panel.actions.map(({ action, response }) => (
                <Button
                  key={action.id}
                  kind={action.variant ?? "secondary"}
                  label={action.label}
                  onPress={() => onAnswer(response)}
                  testId={`${sheetTestId}-action-${action.id}`}
                />
              ))}
            </View>
          </View>
        ) : null}
        {panel?.kind === "unsupported" ? (
          <View style={styles.actionsRow} testID={`${sheetTestId}-unsupported`}>
            <Text style={styles.legend}>{panel.toolLabel} needs your response</Text>
            <Text style={styles.detail}>
              This request type ({panel.presentation}) has no Android form yet — dismiss to answer
              with a cancel/deny response.
            </Text>
            <View style={styles.actionsButtons}>
              <Button
                kind="secondary"
                label="Dismiss"
                onPress={() => onAnswer(panel.closeResponse)}
                testId={`${sheetTestId}-unsupported-dismiss`}
              />
            </View>
          </View>
        ) : null}
        {waitingText ? (
          <Text style={styles.waiting} testID={`${sheetTestId}-waiting`}>
            {waitingText}
          </Text>
        ) : null}
      </Sheet>
    </>
  );
}

function createStyles(theme: ReturnType<typeof useTheme>["theme"]) {
  return StyleSheet.create({
    actionsRow: { gap: theme.spacing[2] },
    legend: { color: theme.colors.ink, fontSize: theme.typography.variant.label.fontSize },
    detail: { color: theme.colors["ink-2"], fontSize: theme.typography.variant.body.fontSize },
    warning: {
      color: theme.colors.status.danger.foreground,
      fontSize: theme.typography.variant.caption.fontSize,
    },
    actionsButtons: {
      flexDirection: "row",
      flexWrap: "wrap",
      justifyContent: "flex-end",
      gap: theme.spacing[2],
    },
    waiting: { color: theme.colors["ink-3"], fontSize: theme.typography.variant.caption.fontSize },
  });
}

export default ApprovalsHost;
