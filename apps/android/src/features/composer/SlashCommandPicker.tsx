/**
 * Android slash-command palette for the compact composer (T292,
 * plan.md §11.1's "commands and slash-command completion" RPC group).
 * Thin native view over `./slash-command-model.ts` — every behavioural
 * claim (the trigger rule, the daemon-sourced list, the "no client yet"
 * degrade, "never blocks a send") already has render-free behavioural
 * proof in `slash-command-model.test.ts`; this file only wires that
 * into the render tree. Same split as `./ModelThinkingPicker.tsx`/
 * `model-thinking-model.ts` (`react-native` cannot render under this
 * workspace's plain `vitest`, proven 27+ times — see that file's doc
 * comment).
 *
 * ## Placement: an inline row above `PromptBar`, never an overlay/Modal
 *
 * `Composer.tsx` mounts this component immediately before `<PromptBar>`
 * in its own render tree — the identical placement `<ModelThinkingPicker>`
 * and `<QueueModePicker>` already use, both also rendered above
 * `<PromptBar>` as ordinary stacked content rather than a floating
 * layer. That is a deliberate choice for THIS component, not merely a
 * copy: `composer-focus-model.ts`'s own doc comment names
 * `ui/primitives/Sheet.tsx`'s `Modal`-backed panel as a known way to
 * steal the OS's IME focus away from the composer's `TextInput` — the
 * exact failure plan.md §9.3 says to avoid — and `Select`
 * (`ui/primitives/Select.tsx`, what `ModelThinkingPicker`/
 * `QueueModePicker` are built from) opens its own option list inside a
 * `Modal` for exactly that reason it is safe for THOSE two pickers
 * (deliberate, occasionally-opened settings changes) but would be wrong
 * here: this palette can open on every keystroke while the user is
 * still typing, so stealing focus/dismissing the keyboard on every "/"
 * would defeat the whole feature. This component therefore declares no
 * `Modal` and composes no primitive that itself uses one — it is a
 * plain `View` inserted into the same reserved-height column
 * `COMPOSER_LAYOUT_CONTRACT` (`composer-focus-model.ts`) already
 * describes, which pushes `PromptBar` down rather than ever overlapping
 * it, and never touches keyboard focus at all.
 * `composer-accessibility.test.ts`'s existing "renders no `<Modal>`"
 * check on `Composer.tsx` already covers this file transitively (it
 * imports no `Modal`, so a comment-stripped scan of the composed tree
 * stays clean); `slash-command-picker.test.ts` in this directory
 * additionally proves this file itself imports no `Modal`.
 *
 * ## Touch targets: composed only from already-audited primitives
 *
 * This file declares no `Pressable`/`Touchable*` of its own — every
 * interactive control is `../../ui/primitives`' `Button`, already in
 * `../../ui/primitives/touch-targets.test.ts`'s strict, mutation-checked
 * 48dp audit — same guarantee `QueueModePicker.tsx`'s own header relies
 * on for `Select`.
 *
 * ## Dismissible without sending
 *
 * The "Close" button calls `onDismiss` alone — it never calls
 * `onSelect`, never touches the draft, and has no path to `onSubmit`
 * (this component is not given one). Tapping a command row calls
 * `onSelect` with that command's own data; `Composer.tsx`'s
 * `handleSelectSlashCommand` is what turns that into a draft-text
 * replacement plus `dismiss()` — never a send.
 *
 * ## Renders nothing when there is nothing to show
 *
 * Same convention as `TurnStatusBanner.tsx`: `state.isOpen` is false
 * whenever there are no commands to offer at all (see
 * `slash-command-model.ts`'s `computeIsOpen`), so this never renders an
 * enabled-looking picker with zero options — it renders nothing.
 */
import { useMemo } from "react";
import { StyleSheet, Text, View } from "react-native";

import { Button } from "../../ui/primitives";
import { useTheme } from "../../ui/theme/theme-context";
import {
  describeSlashCommand,
  type SlashCommand,
  type SlashCommandsState,
} from "./slash-command-model";

export interface SlashCommandPickerProps {
  state: SlashCommandsState;
  /** Fires with the tapped command. Never sends anything itself — see this file's doc comment. */
  onSelect: (command: SlashCommand) => void;
  /** Closes the palette without changing the draft or sending anything. */
  onDismiss: () => void;
  testId?: string;
}

export function SlashCommandPicker({
  state,
  onSelect,
  onDismiss,
  testId = "slash-command-picker",
}: SlashCommandPickerProps) {
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);

  if (!state.isOpen) return null;

  return (
    <View style={styles.root} testID={testId}>
      <View style={styles.header}>
        <Text style={styles.title} accessibilityRole="header">
          Commands
        </Text>
        <Button kind="secondary" label="Close" onPress={onDismiss} testId={`${testId}-dismiss`} />
      </View>
      <View style={styles.list}>
        {state.commands.map((command) => (
          <Button
            key={command.name}
            kind="secondary"
            label={`/${command.name} — ${describeSlashCommand(command)}`}
            onPress={() => onSelect(command)}
            testId={`${testId}-option-${command.name}`}
          />
        ))}
      </View>
      {state.error ? (
        <Text style={styles.error} testID={`${testId}-error`}>
          {state.error}
        </Text>
      ) : null}
    </View>
  );
}

function createStyles(theme: ReturnType<typeof useTheme>["theme"]) {
  return StyleSheet.create({
    root: {
      gap: theme.spacing[2],
      borderWidth: 1,
      borderColor: theme.colors.line,
      borderRadius: theme.radii.control,
      padding: theme.spacing[2],
      backgroundColor: theme.colors.surface,
    },
    header: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
    },
    title: {
      color: theme.colors.ink,
      fontSize: theme.typography.variant.label.fontSize,
    },
    list: { gap: theme.spacing[1] },
    error: {
      color: theme.colors.red,
      fontSize: theme.typography.variant.caption.fontSize,
    },
  });
}

export default SlashCommandPicker;
