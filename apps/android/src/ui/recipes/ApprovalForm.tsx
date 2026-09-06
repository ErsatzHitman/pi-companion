import { useMemo } from "react";
import { StyleSheet, Text, View } from "react-native";

import { Button } from "../primitives/Button";
import { asFontWeight, ringShadow } from "../theme/native-style-helpers";
import { useTheme } from "../theme/theme-context";

export interface ApprovalFormProps {
  toolLabel: string;
  detail: string;
  dangerous?: boolean;
  onApprove: () => void;
  onDeny: () => void;
  testId?: string;
}

/**
 * ApprovalForm recipe (plan.md §10.4): a tool-call permission request
 * ("Pi wants to write src/x.ts — Approve / Deny"). Clean-specification
 * recipe (plan.md §10.1), matching the web recipe's semantics.
 *
 * Accessibility (plan.md §10.5): the whole request is grouped under
 * `accessibilityRole="none"` with a single accessible label naming the
 * request, so TalkBack announces it as one unit before reaching Deny/
 * Approve; a dangerous request adds visible "Requires extra caution" text
 * rather than colour alone, and both actions are the `Button` primitive
 * (48dp touch targets, `accessibilityRole="button"` for free).
 */
export function ApprovalForm({
  toolLabel,
  detail,
  dangerous,
  onApprove,
  onDeny,
  testId,
}: ApprovalFormProps) {
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);

  return (
    <View
      style={[styles.wrapper, dangerous ? styles.wrapperDangerous : null]}
      accessibilityRole="none"
      accessibilityLabel={`${toolLabel} needs your approval`}
      testID={testId}
    >
      <Text style={styles.legend}>{toolLabel} needs your approval</Text>
      <Text style={styles.detail}>{detail}</Text>
      {dangerous ? (
        <Text style={styles.warning}>Requires extra caution — this cannot be undone.</Text>
      ) : null}
      <View style={styles.actions}>
        <Button
          kind="secondary"
          label="Deny"
          onPress={onDeny}
          testId={testId ? `${testId}-deny` : undefined}
        />
        <Button
          kind={dangerous ? "danger" : "primary"}
          label="Approve"
          onPress={onApprove}
          testId={testId ? `${testId}-approve` : undefined}
        />
      </View>
    </View>
  );
}

function createStyles(theme: ReturnType<typeof useTheme>["theme"]) {
  return StyleSheet.create({
    wrapper: {
      gap: theme.spacing[2],
      padding: theme.spacing[4],
      borderRadius: theme.radii.card,
      backgroundColor: theme.colors.surface,
      ...ringShadow(theme, "card"),
    },
    wrapperDangerous: { borderColor: theme.colors.status.danger.border },
    legend: {
      color: theme.colors.ink,
      fontSize: theme.typography.variant.label.fontSize,
      fontWeight: asFontWeight(theme.typography.variant.heading.fontWeight),
    },
    detail: {
      color: theme.colors["ink-2"],
      fontSize: theme.typography.variant.body.fontSize,
    },
    warning: {
      color: theme.colors.status.danger.foreground,
      fontSize: theme.typography.variant.caption.fontSize,
    },
    actions: { flexDirection: "row", justifyContent: "flex-end", gap: theme.spacing[2] },
  });
}

export default ApprovalForm;
