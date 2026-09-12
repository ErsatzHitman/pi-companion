/**
 * The Android rewind sheet — T395, `plan.md` §4.2 ("Workspace checkpoint
 * snapshots").
 *
 * Every decision this surface makes lives in `rewind-sheet-model.ts`
 * (labels, the three gates, which action pair a conflict swaps in, the
 * local undone-turns heading); this file only draws the model through the
 * shared `Sheet` primitive and routes presses back to the caller. That
 * split is what this workspace's tests rely on: `react-native` cannot be
 * rendered under its plain `vitest` setup, so `RewindSheet.test.ts` pins
 * this file's wiring at the source level while the model's own test covers
 * every branch.
 *
 * Touch targets: the scope rows and the undone rows are full-width
 * `Pressable`s with `minHeight: MIN_TOUCH_TARGET`, because plan.md §9.3's
 * 48dp floor outranks any mockup box, and the shared `Button` already
 * expands its own hit target the same way. The sheet is opened by a
 * long-press on a message row (mobile has no hover), which
 * `SessionTranscript` in the session route wires.
 *
 * Colours and spacing come from the theme's tokens only — no raw hex, no
 * magic pixel values where a token exists.
 */
import { useMemo } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { Button, Sheet } from "../../../ui/primitives";
import { useTheme } from "../../../ui/theme/theme-context";
import type { RewindSheetModel } from "./rewind-sheet-model";

/** plan.md §9.3's touch floor, in dp — the same number `Button` expands to. */
const MIN_TOUCH_TARGET = 48;

export interface RewindSheetProps {
  readonly model: RewindSheetModel;
  readonly onSelectMode: (mode: RewindSheetModel["scopes"][number]["mode"]) => void;
  readonly onSubmit: () => void;
  readonly onRestoreAnyway: () => void;
  readonly onReturnToTurn: (turn: RewindSheetModel["undoneRows"][number]["turn"]) => void;
  readonly onClose: () => void;
  readonly testId?: string;
}

export function RewindSheet({
  model,
  onSelectMode,
  onSubmit,
  onRestoreAnyway,
  onReturnToTurn,
  onClose,
  testId = "session-rewind-sheet",
}: RewindSheetProps) {
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);

  return (
    <Sheet
      open={model.open}
      title={model.title}
      description={model.description}
      onClose={onClose}
      footerHint={model.footerHint}
      testId={testId}
    >
      <View accessible accessibilityLabel={model.accessibilityLabel} style={styles.scopes}>
        {model.scopes.map((scope) => (
          <Pressable
            key={scope.mode}
            accessibilityRole="radio"
            accessibilityState={{ selected: scope.selected }}
            accessibilityLabel={`${scope.label}. ${scope.description}`}
            onPress={() => onSelectMode(scope.mode)}
            style={[styles.scope, scope.selected ? styles.scopeSelected : null]}
            testID={`${testId}-scope-${scope.mode}`}
          >
            <Text style={styles.scopeLabel}>{scope.label}</Text>
            <Text style={styles.scopeDescription}>{scope.description}</Text>
          </Pressable>
        ))}
      </View>

      {model.statusText === null ? null : (
        <Text style={styles.status} testID={`${testId}-status`}>
          {model.statusText}
        </Text>
      )}

      <View style={styles.actions}>
        {model.actions.map((action) => (
          <Button
            key={action.id}
            kind={action.id === "cancel" ? "secondary" : "primary"}
            label={action.label}
            disabled={!action.enabled}
            onPress={() => {
              if (action.id === "cancel") {
                onClose();
                return;
              }
              if (action.id === "restore-anyway") {
                onRestoreAnyway();
                return;
              }
              onSubmit();
            }}
            testId={`${testId}-${action.id}`}
          />
        ))}
      </View>

      {model.undoneHeading === null ? null : (
        <View style={styles.undone}>
          <Text style={styles.undoneHeading} testID={`${testId}-undone-heading`}>
            {model.undoneHeading}
          </Text>
          {model.undoneRows.map((row) => (
            <Pressable
              key={`${row.turn.messageId}:${row.turn.mode}`}
              accessibilityRole="button"
              accessibilityLabel={row.accessibilityLabel}
              onPress={() => onReturnToTurn(row.turn)}
              style={styles.undoneRow}
              testID={`${testId}-undone-${row.turn.messageId}`}
            >
              <Text numberOfLines={1} style={styles.undoneSnippet}>
                {row.snippet}
              </Text>
              <Text style={styles.undoneMode}>{row.modeLabel}</Text>
            </Pressable>
          ))}
        </View>
      )}
    </Sheet>
  );
}

function createStyles(theme: ReturnType<typeof useTheme>["theme"]) {
  return StyleSheet.create({
    scopes: {
      gap: theme.spacing[2],
    },
    scope: {
      minHeight: MIN_TOUCH_TARGET,
      justifyContent: "center",
      gap: theme.spacing[1],
      paddingVertical: theme.spacing[2],
      paddingHorizontal: theme.spacing[3],
      borderRadius: theme.radii.md,
      borderWidth: 1,
      borderColor: theme.colors.line,
    },
    scopeSelected: {
      borderColor: theme.colors.accent,
      backgroundColor: theme.colors.inset,
    },
    scopeLabel: {
      color: theme.colors.ink,
      fontWeight: "600",
    },
    scopeDescription: {
      color: theme.colors["ink-3"],
      fontSize: 13,
    },
    status: {
      marginTop: theme.spacing[3],
      color: theme.colors["ink-2"],
    },
    actions: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: theme.spacing[2],
      marginTop: theme.spacing[3],
    },
    undone: {
      marginTop: theme.spacing[3],
      gap: theme.spacing[1],
    },
    undoneHeading: {
      color: theme.colors["ink-3"],
      fontSize: 12,
      textTransform: "uppercase",
      letterSpacing: 0.9,
    },
    undoneRow: {
      minHeight: MIN_TOUCH_TARGET,
      justifyContent: "center",
      gap: theme.spacing[1],
    },
    undoneSnippet: {
      color: theme.colors.ink,
    },
    undoneMode: {
      color: theme.colors["ink-3"],
      fontSize: 13,
    },
  });
}
