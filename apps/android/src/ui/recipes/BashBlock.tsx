import { useMemo } from "react";
import { StyleSheet, Text, View } from "react-native";

import { asFontWeight } from "../theme/native-style-helpers";
import { useTheme } from "../theme/theme-context";
import { PixelLoader } from "./PixelLoader";
import { ShimmerText } from "./ShimmerText";

/** The artifact's `.bash .bd` — a 1px rule at half the tone's strength. */
export const RULE_OPACITY = 0.5;
/** `.bash-in`'s own padding, which is narrower vertically than a `.blk`'s. */
export const BASH_PADDING_VERTICAL = 7;
export const BASH_PADDING_HORIZONTAL = 12;
/** The artifact's gap between the loader, the label and the readouts. */
const RUN_ROW_GAP = 9;
/** `.pxl`'s cell edge inside a bash block, from `PixelLoader`'s own default. */
const LOADER_CELL = 4;

export interface BashBlockProps {
  /** The command, drawn after a literal `$` the way a shell prompt does. */
  command: string;
  /** Whatever the command has printed so far. Bounded by the caller. */
  output?: string;
  /** `true` while the command is still running: draws the loader row. */
  running?: boolean;
  /** A mono elapsed readout, shown while running and only when non-empty. */
  elapsedLabel?: string;
  /**
   * How the reader stops the command, in this platform's own words. The
   * artifact writes "esc to cancel"; see this file's doc comment for
   * why that string does not survive onto a touch device.
   */
  cancelHint?: string;
  /**
   * `true` to draw the artifact's `.bash-dim`: the rules and the
   * command in `ink-3` instead of green, for a command that did not run
   * to completion.
   */
  dimmed?: boolean;
  /** `true` to suppress the shimmer, e.g. under reduced motion. */
  shimmer?: boolean;
  testId?: string;
}

/**
 * BashBlock recipe (T359) — the artifact's `.bash`.
 *
 * A shell command is the one thing in the transcript the design does
 * NOT box: instead of a `.blk` it gets a 1px green rule above and below
 * at half strength, the command in bold green after a `$`, and its
 * output in `ink-2` between them. The rules are the whole container,
 * which is why this recipe draws no background and no radius — giving
 * it a card as well would make it look like a tool result rather than
 * like a terminal.
 *
 * **While it runs**, a row beneath the command carries `PixelLoader`
 * (the app's shared 3×3 running mark), a shimmering "Running…", a mono
 * elapsed readout and a dim hint naming how to stop it.
 *
 * **"esc to cancel" is not shipped, and that is a correction rather
 * than an omission.** The artifact is a desktop mock and writes a
 * keyboard hint. Android has no `esc` key, so printing it would be a
 * visible instruction the reader cannot follow — the exact class of
 * false prose `CLAUDE.md`'s T124 section exists about, arrived at from
 * the other direction. The hint is a prop, and the transcript passes
 * the name of the control that really does stop a turn on this
 * platform (`features/composer/composer-model.ts`'s
 * `ABORT_ACTION_LABEL`). A caller that has no such control passes
 * nothing and the hint is not drawn at all.
 *
 * **Colour is not the only signal.** The command is prefixed by a
 * literal `$` and the running row says the literal word "Running…", so
 * the green rules and the shimmer are both decoration over text that
 * already states what this is and what it is doing (plan.md §10.5).
 */
export function BashBlock({
  command,
  output,
  running = false,
  elapsedLabel,
  cancelHint,
  dimmed = false,
  shimmer = false,
  testId,
}: BashBlockProps) {
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const tone = dimmed ? theme.colors["ink-3"] : theme.colors.green;

  return (
    <View style={styles.wrapper} testID={testId}>
      <View style={[styles.rule, { backgroundColor: tone }]} />
      <View style={styles.inner}>
        <Text
          style={[styles.mono, styles.command, { color: tone }]}
          testID={testId ? `${testId}-command` : undefined}
        >
          {`$ ${command}`}
        </Text>
        {output !== undefined && output.length > 0 ? (
          <Text
            style={[styles.mono, styles.output]}
            testID={testId ? `${testId}-output` : undefined}
          >
            {output}
          </Text>
        ) : null}
        {running ? (
          <View style={styles.runRow} testID={testId ? `${testId}-running` : undefined}>
            <PixelLoader cellSize={LOADER_CELL} color={theme.colors["ink-2"]} />
            <ShimmerText active={shimmer} style={[styles.mono, styles.runLabel]}>
              Running…
            </ShimmerText>
            {elapsedLabel !== undefined && elapsedLabel.length > 0 ? (
              <Text style={[styles.mono, styles.elapsed]}>{elapsedLabel}</Text>
            ) : null}
            {cancelHint !== undefined && cancelHint.length > 0 ? (
              <Text style={[styles.mono, styles.hint]}>{cancelHint}</Text>
            ) : null}
          </View>
        ) : null}
      </View>
      <View style={[styles.rule, { backgroundColor: tone }]} />
    </View>
  );
}

function createStyles(theme: ReturnType<typeof useTheme>["theme"]) {
  return StyleSheet.create({
    wrapper: { gap: 0 },
    rule: { height: 1, opacity: RULE_OPACITY },
    inner: {
      paddingVertical: BASH_PADDING_VERTICAL,
      paddingHorizontal: BASH_PADDING_HORIZONTAL,
      gap: theme.spacing[1],
    },
    // The transcript's mono size and leading, per HANDOFF.md §7.1.
    mono: {
      fontFamily: theme.typography.variant.code.fontFamily,
      fontSize: theme.typography.variant.code.fontSize,
      lineHeight: theme.typography.variant.code.lineHeight,
    },
    command: { fontWeight: asFontWeight(theme.typography.fontWeight.bold) },
    output: { color: theme.colors["ink-2"] },
    runRow: { flexDirection: "row", alignItems: "center", gap: RUN_ROW_GAP },
    runLabel: { fontWeight: asFontWeight(theme.typography.fontWeight.medium) },
    // Elapsed-time readout: the mono family with tabular figures — the
    // rule docs/beautiful-ui-reference.md gives for a mono elapsed-time
    // readout.
    elapsed: { color: theme.colors["ink-3"] },
    hint: { color: theme.colors["ink-3"], flexShrink: 1 },
  });
}

export default BashBlock;
