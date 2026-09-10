import { useMemo } from "react";
import { StyleSheet, Text, TextInput, View, type BlurEvent, type FocusEvent } from "react-native";

import { Button } from "../primitives/Button";
import { ringShadow } from "../theme/native-style-helpers";
import { useTheme } from "../theme/theme-context";

export interface PromptBarProps {
  label: string;
  placeholder: string;
  value: string;
  canSend: boolean;
  queuedCount: number;
  onValueChange: (value: string) => void;
  onSend: () => void;
  /**
   * Fires when the input gains focus. T33B4's `composer-focus-model.ts`
   * names this exact gap (no consumer path from a real focus event to
   * `focusComposer`) as the reason `resolveFocusOwner` has no live
   * input yet; `Composer.tsx` is expected to call `focusComposer` from
   * here (unowned this wave — see this file's doc comment).
   */
  onFocus?: (event: FocusEvent) => void;
  /** Fires when the input loses focus; the `blurComposer` counterpart to `onFocus` above. */
  onBlur?: (event: BlurEvent) => void;
  testId?: string;
}

/**
 * PromptBar recipe (plan.md §10.4): the message composer, with a queued
 * message counter for messages sent while Pi is still working. Clean-
 * specification recipe (plan.md §10.1), matching the web recipe's
 * semantics.
 *
 * Accessibility (plan.md §10.5): a labelled `TextInput` (`accessibilityLabel`,
 * not a placeholder alone), a submit editing shortcut mirroring web's
 * Enter-to-send, and the queued-message count is both visible text and an
 * `accessibilityLiveRegion="polite"` region so TalkBack announces it
 * updating.
 *
 * `onFocus`/`onBlur` (plan.md §9.3, T33B4's `composer-focus-model.ts`):
 * this recipe now forwards the underlying `TextInput`'s real focus/blur
 * events, typed for `Composer.tsx` to drive `focusComposer`/
 * `blurComposer` with. Wiring that call is `features/composer/`'s job —
 * unowned this wave (see the wave brief) — so `Composer.tsx` does not
 * pass these props yet; T33B5/T34B2, or whichever task next edits
 * `Composer.tsx`, is the consumer that closes this last hop.
 */
export function PromptBar({
  label,
  placeholder,
  value,
  canSend,
  queuedCount,
  onValueChange,
  onSend,
  onFocus,
  onBlur,
  testId,
}: PromptBarProps) {
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);

  return (
    <View style={styles.wrapper} testID={testId}>
      <TextInput
        accessibilityLabel={label}
        placeholder={placeholder}
        placeholderTextColor={theme.colors["ink-3"]}
        value={value}
        onChangeText={onValueChange}
        onSubmitEditing={() => {
          if (canSend) onSend();
        }}
        onFocus={onFocus}
        onBlur={onBlur}
        multiline
        style={styles.input}
        testID={testId ? `${testId}-input` : undefined}
      />
      <View style={styles.row}>
        <Text style={styles.queued} accessibilityLiveRegion="polite">
          {queuedCount > 0 ? `${queuedCount} queued` : ""}
        </Text>
        <Button
          kind="primary"
          label="Send"
          disabled={!canSend}
          onPress={onSend}
          testId={testId ? `${testId}-send` : undefined}
        />
      </View>
    </View>
  );
}

function createStyles(theme: ReturnType<typeof useTheme>["theme"]) {
  return StyleSheet.create({
    wrapper: {
      gap: theme.spacing[2],
      padding: theme.spacing[3],
      borderRadius: theme.radii.card,
      backgroundColor: theme.colors.field,
      ...ringShadow(theme, "card"),
    },
    input: {
      minHeight: 48,
      maxHeight: 120,
      color: theme.colors.ink,
      fontSize: theme.typography.variant.body.fontSize,
      textAlignVertical: "top",
    },
    row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
    // The mono family with tabular figures for the queued-message counter
    // (docs/beautiful-ui-reference.md "tabular-nums on counters and
    // timers").
    queued: {
      color: theme.colors["ink-3"],
      fontFamily: theme.typography.variant.code.fontFamily,
      fontSize: theme.typography.variant.caption.fontSize,
    },
  });
}

export default PromptBar;
