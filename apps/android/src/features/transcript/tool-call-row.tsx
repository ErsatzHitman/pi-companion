/**
 * plan.md §9.3/§11.1/§11.6 transcript tool-call row (T33A4) — renders one
 * `tool-call` `TranscriptEntry` in the compact layout's `transcript` slot.
 *
 * A thin native view over `tool-call-row-model.ts`, mirroring
 * `apps/web/src/features/transcript/tool-call-row.tsx`'s architecture and
 * vocabulary (family names, status text, diff/duration formatting) — all
 * card-selection, status-text, duration, diff-derivation, and (the one
 * Android-specific addition, see the model's doc comment) redaction logic
 * lives in the RN-free model module, unit tested there; this file only
 * composes already-built primitives/recipes (`../../ui/primitives`,
 * `../../ui/recipes`, read but never forked or edited per this task's
 * brief) and wraps the result in `memo` using the model's comparator, so
 * a live update to one call does not re-render every already-settled
 * tool-call row already in the list.
 *
 * **T356: the card carries the redesign's own tool surfaces.** The
 * artifact draws a finished tool call on `tool-success-bg` and a failed
 * one on `tool-error-bg`, which is what `toolBlockKind` below maps a
 * `ToolCallViewModel.status` onto. The frame itself is the shared
 * `.blk` — radius 14, padding 9×11, and its 1px `line` hairline — so a
 * tool call reads as the same kind of object as every other block in
 * the transcript. A running call keeps `.blk`'s own `inset` resting
 * fill: it has no outcome yet, and colouring it as though it did is the
 * thing this whole table exists to avoid. `StatusIndicator` above still
 * spells the status out in words, so none of this is colour alone
 * (plan.md §10.5).
 *
 * **The header is the artifact's own line.** `.tt` names the tool in
 * bold `ink`, `.tchip` carries the one path or argument this call
 * touched in `teal` (see `toolHeaderChipLabel`), and the mono
 * duration sits at the right edge beside the status. A tool family with
 * no single such fact simply draws no chip.
 *
 * **A-TEAL:** android-spec.html's `.pa{color:var(--teal)}` is this exact
 * chip text — confirmed by grepping the spec, not assumed. Its sibling
 * `.tchip{...background:var(--field);box-shadow:0 0 0 1px var(--line)}`
 * rule is the chip BOX and stays unrecoloured; only `chipText` below
 * moved off `accent-ink` onto `theme.colors.teal`. `plan.md` §10.2 records
 * `teal` as a live, deliberately-kept role — "the Android design's path
 * chip inside a tool block" is this exact chip, and this file is its
 * first real consumer. The three other `styles.meta` sites that also print a
 * `tool.filePath`/worktree fact (`ReadBody`'s no-content fallback,
 * `WriteBody`, `WorktreeSetupBody`'s `branchName at worktreePath`
 * sentence) are deliberately left on `ink-2`: the spec's own tool-call
 * markup (`s3`/`s5`/`s7` frames) draws exactly one `.pa.tchip` per call,
 * in the header, and never repeats the path as a second teal line in the
 * body — a collapsed read with no content prints no body line at all,
 * and a worktree sentence is prose, not a path chip.
 *
 * **T358: the edit and search cards draw the redesign's own bands.** An
 * edit's diff was a `CodeBlock` of plain mono text with a `diff`
 * language tag that this app has no highlighter for, so nothing was
 * actually coloured; it is now `DiffLines`, which draws §7.2's
 * `.dl add|rem|ctx` bands and inverts the words that changed. A
 * search's matched lines were the same undifferentiated blob; they are
 * now `MatchedLine`, which marks the query itself on
 * `accent-highlight`. Both keep every signal in text as well as in
 * colour — see those two components' own doc comments.
 *
 * **T359: a shell call is the artifact's `.bash`.** It used to be two
 * stacked `CodeBlock`s, which drew a shell command as though it were a
 * file listing. It is now `BashBlock` — green rules above and below,
 * `$ ` before the command, output in `ink-2` between them, and, while
 * it runs, the shared `PixelLoader` with a shimmering "Running…", the
 * elapsed time and the name of the control that stops it.
 *
 * §11.6's governing rule: "Never fail the transcript because a plugin
 * returns a new tool detail shape." Every family this file does not
 * explicitly branch on — `tool.family === "generic"`, which is exactly
 * what `buildToolCallViewModel`/`buildGenericToolCallViewModel` produce
 * for an unrecognized `detail.type` or a value that failed validation
 * outright — renders through `UnknownToolCard`, which shows the tool name
 * and a bounded, *redacted* summary (`genericInputSummary`/
 * `genericResultSummary`) and never the raw `collapsibleInput`/`result`/
 * `rawError` value.
 */
import { memo, useCallback, useEffect, useState } from "react";
import { Linking, Pressable, StyleSheet, Text, View } from "react-native";
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import type { tools } from "@picompanion/frontend-core";

// The one label that names how a reader actually stops a running
// turn on Android. Imported across features on purpose: a second
// copy of this string is how the transcript ends up telling the
// reader to press a button the composer no longer draws.
import { ABORT_ACTION_LABEL } from "../composer/composer-model";

import { CodeBlock, Link, RecordList, StatusIndicator, VectorIcon } from "../../ui/primitives";
import {
  BLOCK_PADDING_HORIZONTAL,
  BLOCK_PADDING_VERTICAL,
  BLOCK_RADIUS,
  blockOutline,
  blockRing,
  blockSurface,
  type BlockKind,
} from "../../ui/theme/block-shape";
import {
  BashBlock,
  DiffLines,
  DiffSummary,
  MatchedLine,
  WorkflowSteps,
  pairChangedLines,
} from "../../ui/recipes";
import type { WorkflowStepItem } from "../../ui/recipes";
import { useTheme } from "../../ui/theme/theme-context";
import { asFontWeight } from "../../ui/theme/native-style-helpers";
import {
  STATUS_TONE,
  TOOL_XBTN_BACKGROUND_ALPHA_PRESSED,
  TOOL_XBTN_BACKGROUND_ALPHA_REST,
  TOOL_XBTN_ROTATION_CLOSED_DEG,
  TOOL_XBTN_ROTATION_DURATION_MS,
  TOOL_XBTN_ROTATION_EASING,
  TOOL_XBTN_ROTATION_OPEN_DEG,
  areToolCallRowPropsEqual,
  diffCounts,
  diffLineInputsFor,
  diffLinesFor,
  formatToolDuration,
  genericInputSummary,
  genericResultSummary,
  inkOverlayColor,
  isKnownToolCall,
  searchCountsLine,
  searchMatchLines,
  shellBlockIsDimmed,
  statusTextFor,
  capHighlightedLines,
  toolBodyIsVisible,
  toolCardHasExpandButton,
  toolExpandButtonAccessibilityLabel,
  toolHeaderChipLabel,
  truncateBody,
  unrecognizedToolMeta,
  worktreeCommandStepStatus,
  type KnownToolCallViewModel,
  type TranscriptToolCallRowProps,
} from "./tool-call-row-model";
import { syntaxColorKey, tokenizeFileContent } from "../files/file-syntax-highlight";

export type { ToolCallTranscriptEntry, TranscriptToolCallRowProps } from "./tool-call-row-model";
export { isToolCallEntry } from "./tool-call-row-model";

const MAX_LIST_ROWS = 20;

/** The transcript line's own mono metrics: `.ln { font-size: 12px; line-height: 1.62 }`. */
const LINE_FONT_SIZE = 12;
const LINE_HEIGHT = LINE_FONT_SIZE * 1.62;
/** `.tchip { border-radius: 5px; padding: 0 4px }` — no token at 5 or 4, so both are stated with the reference. */
const TOOL_CHIP_RADIUS = 5;
const TOOL_CHIP_PADDING_HORIZONTAL = 4;

/**
 * `.xbtn { position: absolute; right: 8px; top: 7px; width: 26px; height:
 * 26px }` (W4-TOOLBLOCK). RN literals, not imported from `tool-call-row-
 * model.ts`: `../../ui/primitives/touch-targets.test.ts` (T376) can only
 * resolve a style dimension it finds as a numeric literal, or as a
 * same-file `const NAME = <int>;`, so these have to live here — see
 * `tool-call-row-model.ts`'s own `.xbtn` section header comment for why
 * the geometry split lands this way (same reasoning `TOOL_CHIP_RADIUS`
 * above already follows).
 */
const TOOL_XBTN_SIZE_DP = 26;
const TOOL_XBTN_OFFSET_TOP_DP = 7;
const TOOL_XBTN_OFFSET_RIGHT_DP = 8;
/** `<svg width="11" height="11" ...>` — the artifact's own chevron size. */
const TOOL_XBTN_ICON_SIZE_DP = 11;
// The 26dp `.xbtn` sits below the 48dp touch floor: `26 + 2 * hitSlop >=
// 48` needs `hitSlop >= 11`; `11` reaches exactly 48dp. That number is
// written as a literal directly on the `Pressable` below, not as a named
// constant here: `touch-targets.test.ts` reads `hitSlop={(\d+)}` and never
// resolves an identifier for this one prop (see that file's own
// `elementMeetsTouchTarget`) — the one geometry number in this section
// that cannot be given a name at all.
/** `.blk.hasx>.ln:first-child,.blk[data-r]>.ln:first-child{padding-right:
 * 34px}` — room reserved on the header row so its text never runs under
 * the button. */
const TOOL_XBTN_HEADER_RESERVE_DP = 34;

/**
 * Which `.blk` a tool call is. `running`, `blocked` and `canceled` are
 * deliberately absent from the mapping: the artifact's `.blk` default
 * fill is `inset`, which is exactly the resting surface an unfinished
 * call should sit on, and tinting it as though it already had an
 * outcome is the failure mode this avoids. Only a finished call gets
 * `tool-ok`/`tool-error`, and only a failure gets the red outline.
 */
function toolBlockKind(status: tools.ToolCallViewModel["status"]): BlockKind | null {
  if (status === "completed") return "tool-ok";
  if (status === "failed") return "tool-error";
  return null;
}

/** The block frame's fill, ring and outline for one tool call's status. */
function useToolBlockStyle(status: tools.ToolCallViewModel["status"]) {
  const { theme } = useTheme();
  const kind = toolBlockKind(status);
  const surface = kind === null ? "inset" : (blockSurface(kind) ?? "inset");
  const ring = kind === null ? "line" : blockRing(kind);
  const outline = kind === null ? null : blockOutline(kind);
  return {
    backgroundColor: theme.colors[surface],
    borderWidth: 1,
    borderColor: theme.colors[outline ?? ring ?? "line"],
  };
}

function createStyles(theme: ReturnType<typeof useTheme>["theme"]) {
  return StyleSheet.create({
    // `.blk { border-radius: 14px; padding: 9px 11px }` — the same block
    // every other transcript element is drawn in. The fill, ring and
    // outline come from `useToolBlockStyle` above.
    // `.blk.hasx,.blk[data-r]{position:relative}` — always applied here
    // rather than conditionally, since an absolutely positioned `.xbtn`
    // only ever renders as a sibling when `toolCardHasExpandButton` is
    // true, so a resting (no-button) card gains a `position:relative` with
    // nothing positioned against it, changing nothing about its layout.
    block: {
      position: "relative",
      gap: theme.spacing[1],
      borderRadius: BLOCK_RADIUS,
      paddingVertical: BLOCK_PADDING_VERTICAL,
      paddingHorizontal: BLOCK_PADDING_HORIZONTAL,
    },
    header: {
      flexDirection: "row",
      alignItems: "center",
      flexWrap: "wrap",
      gap: theme.spacing[1],
      marginBottom: theme.spacing[1],
    },
    headerReserveExpandButton: {
      paddingRight: TOOL_XBTN_HEADER_RESERVE_DP,
    },
    xbtnTouch: {
      position: "absolute",
      top: TOOL_XBTN_OFFSET_TOP_DP,
      right: TOOL_XBTN_OFFSET_RIGHT_DP,
      width: TOOL_XBTN_SIZE_DP,
      height: TOOL_XBTN_SIZE_DP,
      alignItems: "center",
      justifyContent: "center",
    },
    xbtn: {
      width: TOOL_XBTN_SIZE_DP,
      height: TOOL_XBTN_SIZE_DP,
      borderRadius: theme.radii.full,
      alignItems: "center",
      justifyContent: "center",
    },
    highlight: {
      backgroundColor: theme.colors.code.codeBackground,
      borderWidth: 1,
      borderColor: theme.colors.code.codeBorder,
      borderRadius: theme.radii.control,
      padding: theme.spacing[3],
      gap: 1,
    },
    highlightPath: {
      color: theme.colors["ink-3"],
      fontFamily: theme.typography.variant.code.fontFamily,
      fontSize: theme.typography.variant.caption.fontSize,
      marginBottom: theme.spacing[1],
    },
    highlightLine: {
      fontFamily: theme.typography.variant.code.fontFamily,
      fontSize: LINE_FONT_SIZE,
      lineHeight: LINE_HEIGHT,
      color: theme.colors.code.codeForeground,
    },
    // `.tt { color: var(--ink); font-weight: 700 }` on a `.ln`.
    name: {
      color: theme.colors.ink,
      fontFamily: theme.typography.variant.code.fontFamily,
      fontSize: LINE_FONT_SIZE,
      lineHeight: LINE_HEIGHT,
      fontWeight: asFontWeight(theme.typography.fontWeight.bold),
    },
    // `.tchip { background: var(--surface); border-radius: 5px; padding:
    // 0 4px; box-shadow: var(--sh-hairline) }` (box, unchanged by A-TEAL);
    // text is android-spec.html's `.pa{color:var(--teal)}`.
    chip: {
      backgroundColor: theme.colors.surface,
      borderRadius: TOOL_CHIP_RADIUS,
      paddingHorizontal: TOOL_CHIP_PADDING_HORIZONTAL,
      borderWidth: 1,
      borderColor: theme.colors.line,
    },
    chipText: {
      color: theme.colors.teal,
      fontFamily: theme.typography.variant.code.fontFamily,
      fontSize: LINE_FONT_SIZE,
      lineHeight: LINE_HEIGHT,
    },
    duration: {
      marginLeft: "auto",
      color: theme.colors["ink-3"],
      fontFamily: theme.typography.variant.code.fontFamily,
      fontSize: theme.typography.variant.caption.fontSize,
    },
    body: { gap: theme.spacing[2] },
    matches: { gap: 1 },
    meta: {
      color: theme.colors["ink-2"],
      fontSize: theme.typography.variant.bodySmall.fontSize,
    },
    metaError: { color: theme.colors.status.danger.foreground },
    panelLabel: {
      color: theme.colors["ink-3"],
      fontSize: theme.typography.variant.caption.fontSize,
      fontWeight: asFontWeight(theme.typography.variant.label.fontWeight),
    },
  });
}

type Styles = ReturnType<typeof createStyles>;

function ToolCallHeader({
  tool,
  reserveExpandButton,
  testId,
}: {
  tool: tools.ToolCallViewModel;
  /** `.blk.hasx>.ln:first-child{padding-right:34px}` — true whenever
   * `toolCardHasExpandButton(tool)` is, so the header's own text
   * never sits under the absolutely positioned `.xbtn`. */
  reserveExpandButton: boolean;
  testId?: string;
}) {
  const { theme } = useTheme();
  const styles = createStyles(theme);
  const chipLabel = toolHeaderChipLabel(tool);
  return (
    <View style={[styles.header, reserveExpandButton ? styles.headerReserveExpandButton : null]}>
      <Text style={styles.name}>{tool.displayName}</Text>
      {chipLabel !== undefined && chipLabel.length > 0 ? (
        <View style={styles.chip} testID={testId ? `${testId}-arg-chip` : undefined}>
          <Text style={styles.chipText} numberOfLines={1}>
            {chipLabel}
          </Text>
        </View>
      ) : null}
      {tool.durationMs !== undefined ? (
        <Text style={styles.duration}>{formatToolDuration(tool.durationMs)}</Text>
      ) : null}
      <StatusIndicator
        label="Tool call"
        tone={STATUS_TONE[tool.status]}
        statusText={statusTextFor(tool.status)}
        testId={testId ? `${testId}-status` : undefined}
      />
    </View>
  );
}

/**
 * W4-TOOLBLOCK: the design's `.xbtn` — a round chevron button pinned to
 * the block's own top-right corner (`styles.xbtnTouch`, positioned against
 * the `position:"relative"` block View), which flips between "Expand" and
 * "Collapse" as `expanded` changes (plan.md §10.5: the announced meaning,
 * not colour or rotation alone, carries the state).
 *
 * **Hover ported as pressed.** There is no `:hover` on Android; the
 * design's `.blk:hover .xbtn{background:...15%...}` step is drawn here on
 * `pressed` instead (`inkOverlayColor`, whose own doc comment on
 * `tool-call-row-model.ts` explains why no oklab math is needed for a
 * mix-with-`transparent`).
 *
 * **Rotation is a real animation**, not an instant flip: 280ms on the
 * artifact's own overshoot spring (`TOOL_XBTN_ROTATION_EASING`), collapsed
 * to an instant jump under `reduceMotion` the same way every other themed
 * animation in this tree already is (e.g. `../../ui/theme/use-press-
 * scale.ts`'s `onPressIn`/`onPressOut`).
 *
 * The 26dp visual circle sits below the 48dp touch floor
 * (`../../ui/primitives/touch-targets.test.ts`), so — the same treatment
 * `Chip`'s removable button and `work-group-row.tsx`'s disclosure trigger
 * already get — the visual size is left exactly as the design draws it
 * and a `hitSlop` (below) pads the touch area outward instead.
 */
function ExpandButton({
  expanded,
  onPress,
  styles,
  testId,
}: {
  expanded: boolean;
  onPress: () => void;
  styles: Styles;
  testId?: string;
}) {
  const { theme, reduceMotion } = useTheme();
  const rotation = useSharedValue(
    expanded ? TOOL_XBTN_ROTATION_OPEN_DEG : TOOL_XBTN_ROTATION_CLOSED_DEG,
  );

  useEffect(() => {
    const target = expanded ? TOOL_XBTN_ROTATION_OPEN_DEG : TOOL_XBTN_ROTATION_CLOSED_DEG;
    rotation.value = reduceMotion
      ? target
      : withTiming(target, {
          duration: TOOL_XBTN_ROTATION_DURATION_MS,
          easing: Easing.bezier(...TOOL_XBTN_ROTATION_EASING),
        });
  }, [expanded, reduceMotion, rotation]);

  const rotationStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${rotation.value}deg` }],
  }));

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={toolExpandButtonAccessibilityLabel(expanded)}
      accessibilityState={{ expanded }}
      onPress={onPress}
      // Literal, not `TOOL_XBTN_HIT_SLOP`: `touch-targets.test.ts`'s
      // `elementMeetsTouchTarget` reads `hitSlop={(\d+)}` and never
      // resolves an identifier for this one prop (see that constant's own
      // doc comment above).
      hitSlop={11}
      style={styles.xbtnTouch}
      testID={testId ? `${testId}-xbtn` : undefined}
    >
      {({ pressed }) => (
        <Animated.View
          style={[
            styles.xbtn,
            {
              backgroundColor: inkOverlayColor(
                theme.colors.ink,
                pressed ? TOOL_XBTN_BACKGROUND_ALPHA_PRESSED : TOOL_XBTN_BACKGROUND_ALPHA_REST,
              ),
            },
            rotationStyle,
          ]}
        >
          <VectorIcon
            name="chevron-down"
            size={TOOL_XBTN_ICON_SIZE_DP}
            color={theme.colors["ink-2"]}
          />
        </Animated.View>
      )}
    </Pressable>
  );
}

/**
 * W4-TOOLBLOCK: the design's `.hl-*` syntax-highlighted body
 * (the confirmed Android design's own "expanded — syntax-highlighted,
 * capped at 10 lines" frame). Rendered as its own minimal mono block
 * rather than by adding a "highlight" prop to `../../ui/primitives`'
 * `CodeBlock` or `../../ui/recipes`' `CodeListing` — neither accepts
 * styled spans today — in the same visual language those two already use
 * (`theme.colors.code.*`, `theme.radii.control`).
 *
 * Each line becomes one outer `Text` (so it wraps as one unit) holding one
 * nested `Text` per token, because React Native colours text by nesting
 * `Text` and has no inline `<span>`.
 *
 * **The tokenizer is `../files/file-syntax-highlight`'s
 * `tokenizeFileContent`, and the colours are `theme.colors.code.syntax`.**
 * Decided at the P10-W4 merge gate, replacing a hand-rolled tokenizer and
 * five hardcoded hexes this wave first shipped. Two reasons, both
 * measured rather than argued:
 *
 * 1. The repository already ships a real highlighter. `@picompanion/
 *    highlight`'s Lezer build is the read path's tokenizer on web and was
 *    already this app's tokenizer for the file view, via the adapter this
 *    module now imports. A second, deliberately-partial tokenizer beside
 *    it would have had to be kept in agreement with it forever.
 * 2. The design declares `.hl-*` exactly once, in oklch, and its device
 *    mock is dark-only — it never says what light mode should do.
 *    Converting those five to hex and painting them in both themes put
 *    every one of them below AA on the light code surface, worst case
 *    1.47:1 for `.hl-f`, and identical under high contrast, where a
 *    reader has explicitly asked for MORE contrast. `theme.colors.code
 *    .syntax` carries the same five roles resolved per theme and clears
 *    AA in both. plan.md §10.5 governs; the design does not.
 */
function HighlightedFileBody({
  path,
  code,
  styles,
}: {
  path: string;
  code: string;
  styles: Styles;
}) {
  const { theme } = useTheme();
  const capped = capHighlightedLines(code.split("\n"));
  // Tokenize only what is drawn: the cap is applied first, so a 4000-line
  // read parses ten lines, not four thousand.
  const tokenLines = tokenizeFileContent(capped.visible.join("\n"), path);
  return (
    <View style={styles.highlight}>
      <Text style={styles.highlightPath} numberOfLines={1}>
        {path}
      </Text>
      {capped.visible.map((line, index) => (
        <Text key={index} style={styles.highlightLine}>
          {(tokenLines[index] ?? [{ text: line, style: null }]).map((token, tokenIndex) => {
            const key = syntaxColorKey(token.style);
            return key === null ? (
              token.text
            ) : (
              <Text key={tokenIndex} style={{ color: theme.colors.code.syntax[key] }}>
                {token.text}
              </Text>
            );
          })}
        </Text>
      ))}
      {capped.truncatedNotice ? <Text style={styles.meta}>{capped.truncatedNotice}</Text> : null}
    </View>
  );
}

/**
 * T359: a shell call is the artifact's `.bash`, not a pair of code
 * blocks.
 *
 * `dimmed` is `shellBlockIsDimmed(tool.status)` — the artifact's
 * `.bash-dim`, for a command that did not run to completion. The
 * `cancelHint` is `ABORT_ACTION_LABEL`, the real control that stops a
 * turn on this platform, rather than the artifact's desktop-only "esc
 * to cancel"; see `BashBlock.tsx`'s own doc comment for why that string
 * is not shipped.
 */
function ShellBody({
  tool,
  styles,
  testId,
}: {
  tool: tools.ShellToolCallViewModel;
  styles: Styles;
  testId?: string;
}) {
  const { reduceMotion } = useTheme();
  const running = tool.status === "running";
  return (
    <View style={styles.body}>
      <BashBlock
        command={tool.command}
        output={tool.output === undefined ? undefined : truncateBody(tool.output)}
        running={running}
        elapsedLabel={
          tool.durationMs === undefined ? undefined : formatToolDuration(tool.durationMs)
        }
        cancelHint={running ? ABORT_ACTION_LABEL : undefined}
        dimmed={shellBlockIsDimmed(tool.status)}
        shimmer={running && !reduceMotion}
        testId={testId ? `${testId}-bash` : undefined}
      />
      {tool.cwd ? <Text style={styles.meta}>{`cwd: ${tool.cwd}`}</Text> : null}
      {tool.exitCode !== undefined ? (
        <Text style={styles.meta}>{`Exit code: ${tool.exitCode ?? "—"}`}</Text>
      ) : null}
    </View>
  );
}

function ReadBody({ tool, styles }: { tool: tools.ReadToolCallViewModel; styles: Styles }) {
  return (
    <View style={styles.body}>
      {tool.content ? (
        <HighlightedFileBody
          path={tool.filePath}
          code={truncateBody(tool.content)}
          styles={styles}
        />
      ) : (
        <Text style={styles.meta}>{tool.filePath}</Text>
      )}
      {tool.offset !== undefined || tool.limit !== undefined ? (
        <Text style={styles.meta}>
          {tool.offset !== undefined ? `From line ${tool.offset}` : "From the start"}
          {tool.limit !== undefined ? `, ${tool.limit} lines` : ""}
        </Text>
      ) : null}
    </View>
  );
}

function WriteBody({ tool, styles }: { tool: tools.WriteToolCallViewModel; styles: Styles }) {
  return (
    <View style={styles.body}>
      <Text style={styles.meta}>{tool.filePath}</Text>
      {tool.content ? <CodeBlock code={truncateBody(tool.content)} language="text" /> : null}
    </View>
  );
}

function EditBody({
  tool,
  styles,
  testId,
}: {
  tool: tools.EditToolCallViewModel;
  styles: Styles;
  testId?: string;
}) {
  const { added, removed } = diffCounts(tool);
  const diffLines = diffLinesFor(tool);
  const bands = pairChangedLines(diffLineInputsFor(tool));
  return (
    <View style={styles.body}>
      <DiffSummary path={tool.filePath} added={added} removed={removed} modified={0} />
      {tool.isMultiEdit ? (
        <Text style={styles.meta}>{`${tool.edits?.length ?? 0} edits in this file`}</Text>
      ) : null}
      {bands.length > 0 ? (
        <DiffLines
          lines={bands}
          accessibleName={`${tool.filePath} changed lines`}
          testId={testId ? `${testId}-diff` : undefined}
        />
      ) : null}
      {diffLines?.truncatedNotice ? (
        <Text style={styles.meta}>{diffLines.truncatedNotice}</Text>
      ) : null}
    </View>
  );
}

function SearchBody({ tool, styles }: { tool: tools.SearchToolCallViewModel; styles: Styles }) {
  const countsLine = searchCountsLine(tool);
  const matchLines = tool.content ? searchMatchLines(truncateBody(tool.content)) : [];
  const fileRows = tool.filePaths?.slice(0, MAX_LIST_ROWS).map((path, index) => ({
    id: `${index}-${path}`,
    cells: { path },
  }));
  const webRows = tool.webResults?.slice(0, MAX_LIST_ROWS).map((result, index) => ({
    id: `${index}-${result.url}`,
    cells: { title: result.title, url: result.url },
  }));
  return (
    <View style={styles.body}>
      <Text style={styles.meta}>{tool.query}</Text>
      {webRows && webRows.length > 0 ? (
        <RecordList
          accessibleName="Web search results"
          columns={[
            { key: "title", header: "Title" },
            { key: "url", header: "URL" },
          ]}
          rows={webRows}
        />
      ) : fileRows && fileRows.length > 0 ? (
        <RecordList
          accessibleName="Matching files"
          columns={[{ key: "path", header: "File" }]}
          rows={fileRows}
        />
      ) : matchLines.length > 0 ? (
        <View style={styles.matches} accessibilityRole="none" accessibilityLabel="Matching lines">
          {matchLines.map((line, index) => (
            <MatchedLine key={index} text={line} query={tool.query} />
          ))}
        </View>
      ) : null}
      {countsLine ? <Text style={styles.meta}>{countsLine}</Text> : null}
      {tool.truncated ? <Text style={styles.meta}>Results truncated</Text> : null}
    </View>
  );
}

function FetchBody({ tool, styles }: { tool: tools.FetchToolCallViewModel; styles: Styles }) {
  const onPressUrl = useCallback(() => {
    void Linking.openURL(tool.url).catch(() => undefined);
  }, [tool.url]);
  return (
    <View style={styles.body}>
      <Link label={tool.url} onPress={onPressUrl} external />
      {tool.code !== undefined ? (
        <Text style={styles.meta}>{`${tool.code}${tool.codeText ? ` ${tool.codeText}` : ""}`}</Text>
      ) : null}
      {tool.result ? <CodeBlock code={truncateBody(tool.result)} language="text" /> : null}
    </View>
  );
}

function WorktreeSetupBody({
  tool,
  styles,
}: {
  tool: tools.WorktreeSetupToolCallViewModel;
  styles: Styles;
}) {
  const items: WorkflowStepItem[] = tool.commands.map((command) => ({
    id: `${command.index}`,
    label: command.command,
    status: worktreeCommandStepStatus(command.status),
  }));
  return (
    <View style={styles.body}>
      <Text style={styles.meta}>{`${tool.branchName} at ${tool.worktreePath}`}</Text>
      <WorkflowSteps items={items} accessibleName="Setup commands" />
      {tool.log ? <CodeBlock code={truncateBody(tool.log)} language="text" /> : null}
    </View>
  );
}

function SubAgentBody({ tool, styles }: { tool: tools.SubAgentToolCallViewModel; styles: Styles }) {
  return (
    <View style={styles.body}>
      {tool.description ? <Text style={styles.meta}>{tool.description}</Text> : null}
      {tool.actions && tool.actions.length > 0 ? (
        <View accessibilityRole="none" accessibilityLabel="Sub-agent actions">
          {tool.actions.map((action) => (
            <Text key={action.index} style={styles.meta}>
              {`${action.toolName}${action.summary ? `: ${action.summary}` : ""}`}
            </Text>
          ))}
        </View>
      ) : null}
      {tool.log ? <CodeBlock code={truncateBody(tool.log)} language="text" /> : null}
    </View>
  );
}

function PlanBody({ tool, styles }: { tool: tools.PlanToolCallViewModel; styles: Styles }) {
  return (
    <View style={styles.body}>
      <Text style={styles.meta}>{truncateBody(tool.text)}</Text>
    </View>
  );
}

function PlainTextBody({
  tool,
  styles,
}: {
  tool: tools.PlainTextToolCallViewModel;
  styles: Styles;
}) {
  return (
    <View style={styles.body}>
      {tool.label ? <Text style={styles.meta}>{tool.label}</Text> : null}
      {tool.text ? <Text style={styles.meta}>{truncateBody(tool.text)}</Text> : null}
    </View>
  );
}

/**
 * The safe generic card (§11.6: "an unknown tool renders the safe
 * generic card and never raw payload"). Shows tool name and source
 * (`unrecognizedToolMeta`), execution state and duration
 * (`ToolCallHeader`), and a redacted, bounded result/error and input
 * summary (`genericResultSummary`/`genericInputSummary` — see the
 * model's doc comment for why this goes further than a plain bounded
 * stringify). Every one of those functions already returns inert text,
 * so this component never interprets a plugin's payload as anything but
 * a `Text` node.
 */
function UnknownToolCard({
  tool,
  styles,
  testId,
}: {
  tool: tools.GenericToolCallViewModel;
  styles: Styles;
  testId?: string;
}) {
  const blockStyle = useToolBlockStyle(tool.status);
  const resultLabel = tool.status === "failed" ? "Error" : "Result";
  const showResultPanel =
    tool.status === "failed" ? tool.rawError !== undefined : tool.result !== undefined;
  // W4-TOOLBLOCK: the `.xbtn` affordance and the collapsed-by-default
  // body it reveals — `collapsibleInput` is this generic card's OWN field
  // name for exactly this behaviour (see `tool-call-row-model.ts`'s
  // `genericInputSummary`), so both panels below (Input and, when shown,
  // Result/Error) are gated the same way a known card's family body is.
  const hasExpandButton = toolCardHasExpandButton(tool);
  const [expanded, setExpanded] = useState(false);
  const bodyVisible = toolBodyIsVisible(tool, expanded);
  const onToggleExpand = useCallback(() => setExpanded((value) => !value), []);
  return (
    <View style={[styles.block, blockStyle]} testID={testId}>
      <ToolCallHeader tool={tool} reserveExpandButton={hasExpandButton} testId={testId} />
      {hasExpandButton ? (
        <ExpandButton
          expanded={expanded}
          onPress={onToggleExpand}
          styles={styles}
          testId={testId}
        />
      ) : null}
      <View style={styles.body}>
        <Text style={[styles.meta, tool.status === "failed" ? styles.metaError : null]}>
          {unrecognizedToolMeta(tool)}
        </Text>
        {bodyVisible ? (
          <>
            {showResultPanel ? (
              <>
                <Text style={styles.panelLabel}>{resultLabel}</Text>
                <CodeBlock code={genericResultSummary(tool)} language="json" />
              </>
            ) : null}
            <Text style={styles.panelLabel}>Input</Text>
            <CodeBlock code={genericInputSummary(tool)} language="json" />
          </>
        ) : null}
      </View>
    </View>
  );
}

function KnownToolCard({
  tool,
  styles,
  testId,
}: {
  tool: KnownToolCallViewModel;
  styles: Styles;
  testId?: string;
}) {
  const blockStyle = useToolBlockStyle(tool.status);
  // W4-TOOLBLOCK: `hasExpandButton`/`bodyVisible` are `tool-call-row-
  // model.ts`'s `toolCardHasExpandButton`/`toolBodyIsVisible` — see those
  // functions' own doc comments for android-spec.html's exact rule
  // ("renderResult returns "" unless expanded or errored"). `tool.summary`
  // and a failed call's `errorText` stay OUTSIDE the gate: they are the
  // always-visible one-line facts the header itself sits beside, not the
  // "rest" the button reveals — the per-family `Body` below is.
  const hasExpandButton = toolCardHasExpandButton(tool);
  const [expanded, setExpanded] = useState(false);
  const bodyVisible = toolBodyIsVisible(tool, expanded);
  const onToggleExpand = useCallback(() => setExpanded((value) => !value), []);
  return (
    <View style={[styles.block, blockStyle]} testID={testId}>
      <ToolCallHeader tool={tool} reserveExpandButton={hasExpandButton} testId={testId} />
      {hasExpandButton ? (
        <ExpandButton
          expanded={expanded}
          onPress={onToggleExpand}
          styles={styles}
          testId={testId}
        />
      ) : null}
      {tool.summary ? <Text style={styles.meta}>{tool.summary}</Text> : null}
      {tool.status === "failed" && tool.errorText ? (
        <Text style={[styles.meta, styles.metaError]}>{tool.errorText}</Text>
      ) : null}
      {bodyVisible ? (
        tool.family === "shell" ? (
          <ShellBody tool={tool} styles={styles} testId={testId} />
        ) : tool.family === "read" ? (
          <ReadBody tool={tool} styles={styles} />
        ) : tool.family === "write" ? (
          <WriteBody tool={tool} styles={styles} />
        ) : tool.family === "edit" ? (
          <EditBody tool={tool} styles={styles} testId={testId} />
        ) : tool.family === "search" ? (
          <SearchBody tool={tool} styles={styles} />
        ) : tool.family === "fetch" ? (
          <FetchBody tool={tool} styles={styles} />
        ) : tool.family === "worktree_setup" ? (
          <WorktreeSetupBody tool={tool} styles={styles} />
        ) : tool.family === "sub_agent" ? (
          <SubAgentBody tool={tool} styles={styles} />
        ) : tool.family === "plan" ? (
          <PlanBody tool={tool} styles={styles} />
        ) : (
          <PlainTextBody tool={tool} styles={styles} />
        )
      ) : null}
    </View>
  );
}

function TranscriptToolCallRowImpl({ entry, testId }: TranscriptToolCallRowProps) {
  const { theme } = useTheme();
  const styles = createStyles(theme);
  const { tool } = entry;

  return isKnownToolCall(tool) ? (
    <KnownToolCard tool={tool} styles={styles} testId={testId} />
  ) : (
    <UnknownToolCard tool={tool} styles={styles} testId={testId} />
  );
}

export const TranscriptToolCallRow = memo(TranscriptToolCallRowImpl, areToolCallRowPropsEqual);
