import { useEffect, useMemo, useState, type ReactNode } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";

import type { AgentUsage } from "@picompanion/protocol/agent-types";
import type { PiUiElement } from "@picompanion/protocol/pi-ui-bridge/schema";

import { buildContextCardViewModel, type ContextUsageBand } from "../telemetry";
import { StatusPill, VectorIcon } from "../../ui/primitives";
import { PixelLoader, ScreenBar } from "../../ui/recipes";
import { asFontWeight, ringShadow } from "../../ui/theme/native-style-helpers";
import { useTheme } from "../../ui/theme/theme-context";
import {
  buildLiveScreenViewModel,
  formatLiveElapsed,
  type LiveRowGlyph,
  type LiveSubagentRow,
  type LiveWorkflowRow,
} from "./live-screen-model";

/**
 * The Live (A2) screen (T350) — one session's running work, as its own
 * route.
 *
 * `live-screen-model.ts` owns every selection and every string; this
 * file is the native drawing of them. It takes no router: `onBack` and
 * the `navActions` node are supplied by
 * `app/h/[serverId]/session/[agentId]/live.tsx`, so this component
 * imports nothing from `expo-router` and its own contract can be pinned
 * without one.
 *
 * **Files and Terminal live here now.** They used to sit under the
 * session screen's header as two buttons competing with the transcript
 * for that screen's first 100dp. The redesign moves them onto this
 * screen, which is where a user goes to look at the session rather than
 * to talk to it. They keep `session-nav-actions-files` and
 * `session-nav-actions-terminal` — the same testIDs on the same
 * controls doing the same thing, per this redesign's testID-continuity
 * rule — so nothing that names them has to change to find them.
 */
export interface LiveScreenProps {
  /** Every Pi UI element for this session, straight from the store the route already reads. */
  elements: readonly PiUiElement[];
  /** Whether a turn is in flight, which is what the bar's pill reports. */
  turnRunning: boolean;
  /**
   * When the running turn started, in epoch milliseconds — the wire
   * timestamp of the `turn_started` (or mid-turn `pi_queue_update`) the
   * route's `TurnRunningSignal` recorded (T385). `null`/absent when no
   * turn is running or nothing has reported a start; the pill then
   * falls back to the state word alone. Threaded in by the route, so
   * this screen never invents a start time of its own.
   */
  turnStartedAtMs?: number | null;
  /**
   * The newest token usage the daemon has reported for this session
   * (T352), straight off `createContextUsageSignal`. `null` before any
   * has arrived, and with no connection — the Context card then says
   * the window is unreported rather than drawing an empty meter that
   * looks like a fresh session.
   */
  usage?: AgentUsage | null;
  /**
   * Whether auto-compaction is on, when that is known. Left
   * `undefined` here: the control that reads and sets it is the
   * context-ring menu's, and until that lands nobody has asked, so the
   * card omits the clause rather than guessing.
   */
  autoCompaction?: boolean;
  onBack: () => void;
  /**
   * The Files/Terminal controls, mounted by the route because they
   * need a router. A node rather than two callbacks so this screen
   * takes no view on how they navigate.
   */
  navActions?: ReactNode;
  testId?: string;
}

/**
 * The artifact's `.card`: radius 14 (`theme.radii.window`, applied in
 * `createStyles`), padding 12px 13px. Its `h3` is 12.5px/600 — the
 * theme's own `body` size at `semibold` — and its `p` is 11px `ink-3`.
 */
const CARD_SUMMARY_SIZE = 11;
/** The artifact's `.row.sub` height. */
const ROW_MIN_HEIGHT = 34;
/** The artifact's subagent name: its `.sub` rows are mono 11.5px. */
const ROW_FONT_SIZE = 11.5;
/** The artifact's subagent elapsed: mono 11px in `.elapsed`'s `ink-3`. */
const ROW_ELAPSED_SIZE = 11;
/** The artifact's workflow row label: its row div is 12px sans. */
const WORKFLOW_NAME_SIZE = 12;
/** The artifact's workflow step count: mono 10.5px in `dim`. */
const WORKFLOW_STEP_SIZE = 10.5;
/**
 * How often the bar's elapsed reading updates while a turn is running.
 * `formatLiveElapsed` resolves whole seconds, so this only needs to be
 * comfortably under one to keep the drawn value from lagging behind
 * the real one (the artifact ticks its own timer at 100ms).
 */
const ELAPSED_TICK_MS = 500;
/** The artifact's workflow bar: 70×5. */
const WORKFLOW_BAR_WIDTH = 70;
const WORKFLOW_BAR_HEIGHT = 5;
/** The artifact's hollow waiting ring. */
const GLYPH_SIZE = 12;
/** The artifact's Context meter: a 6px track across the card. */
const CONTEXT_BAR_HEIGHT = 6;
/** The artifact's mono stats row under that meter. */
const CONTEXT_STATS_SIZE = 11;

function RowGlyph({ glyph }: { glyph: LiveRowGlyph }) {
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);

  if (glyph === "working") return <PixelLoader />;
  if (glyph === "done")
    return <VectorIcon name="check" size={GLYPH_SIZE} color={theme.colors.green} />;
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[
        styles.glyphRing,
        { borderColor: glyph === "failed" ? theme.colors.red : theme.colors["ink-3"] },
      ]}
    />
  );
}

function SubagentRow({ row }: { row: LiveSubagentRow }) {
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);

  return (
    <View accessible accessibilityLabel={row.accessibilityLabel} style={styles.row}>
      <RowGlyph glyph={row.glyph} />
      <Text style={styles.rowName} numberOfLines={1}>
        {row.label}
      </Text>
      {row.stateWord ? <StatusPill label={row.stateWord} tone="neutral" /> : null}
      {row.elapsedText ? <Text style={styles.rowElapsed}>{row.elapsedText}</Text> : null}
    </View>
  );
}

function WorkflowRow({ row }: { row: LiveWorkflowRow }) {
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  // An indeterminate step draws an empty track rather than a full one:
  // "we do not know" must not look like "not started" OR "finished".
  const filledWidth = row.fraction === null ? 0 : Math.round(WORKFLOW_BAR_WIDTH * row.fraction);

  return (
    <View accessible accessibilityLabel={row.accessibilityLabel} style={styles.row}>
      <Text style={styles.workflowName} numberOfLines={1}>
        {row.label}
      </Text>
      {row.stepText ? <Text style={styles.rowWord}>{row.stepText}</Text> : null}
      <View style={styles.workflowTrack}>
        <View style={[styles.workflowFill, { width: filledWidth }]} />
      </View>
    </View>
  );
}

function LiveCard({
  title,
  summary,
  emptyText,
  children,
  testId,
}: {
  title: string;
  summary: string;
  emptyText: string | undefined;
  children: ReactNode;
  testId: string;
}) {
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);

  return (
    <View style={styles.card} testID={testId}>
      <Text accessibilityRole="header" style={styles.cardTitle}>
        {title}
      </Text>
      <Text style={styles.cardSummary}>{summary}</Text>
      {emptyText ? <Text style={styles.emptyText}>{emptyText}</Text> : children}
    </View>
  );
}

/**
 * The artifact's Context card (T352). Its numbers come from
 * `../telemetry`'s `buildContextCardViewModel`, which wraps
 * `frontend-core`'s shared derivation — so this card and the composer's
 * context ring can never disagree about what a percentage means.
 *
 * An unknown window draws an EMPTY track, not a full or a half one:
 * "the provider has not said" must not be able to look like a reading.
 */
function ContextCard({
  usage,
  autoCompaction,
  testId,
}: {
  usage: AgentUsage | null | undefined;
  autoCompaction: boolean | undefined;
  testId: string;
}) {
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const model = useMemo(
    () => buildContextCardViewModel({ usage, autoCompaction }),
    [usage, autoCompaction],
  );
  const bandColors: Record<ContextUsageBand, string> = {
    normal: theme.colors.accent,
    warning: theme.colors.orange,
    critical: theme.colors.red,
  };

  return (
    <View
      accessible
      accessibilityLabel={model.accessibilityLabel}
      style={styles.card}
      testID={testId}
    >
      <Text accessibilityRole="header" style={styles.cardTitle}>
        {model.title}
      </Text>
      <Text style={styles.cardSummary}>{model.summary}</Text>
      <View style={styles.contextTrack}>
        {model.fraction === null ? null : (
          <View
            style={[
              styles.contextFill,
              {
                width: `${Math.round(model.fraction * 100)}%`,
                backgroundColor: bandColors[model.band],
              },
            ]}
          />
        )}
      </View>
      {model.statsText.length > 0 ? (
        // A2's mock also prints `R84k W12k`; the wire carries no
        // read/write token split, so this line shows only the fields
        // `AgentUsage` actually reports (input, output, cache share,
        // cost) rather than invented figures (T385).
        <Text style={styles.contextStats} testID={`${testId}-stats`}>
          {model.statsText}
        </Text>
      ) : null}
    </View>
  );
}

export function LiveScreen({
  elements,
  turnRunning,
  turnStartedAtMs,
  usage,
  autoCompaction,
  onBack,
  navActions,
  testId = "live-screen",
}: LiveScreenProps) {
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const model = useMemo(() => buildLiveScreenViewModel(elements), [elements]);

  // A2's bar carries a ticking mono elapsed reading for the running
  // turn, not only the word `Working`. The clock is local to this
  // screen and only runs while there is a real start time to count
  // from, so it can never animate while nothing is in flight (T385).
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    if (!turnRunning || turnStartedAtMs === null || turnStartedAtMs === undefined) return;
    setNowMs(Date.now());
    const timer = setInterval(() => setNowMs(Date.now()), ELAPSED_TICK_MS);
    return () => clearInterval(timer);
  }, [turnRunning, turnStartedAtMs]);
  const elapsedText =
    turnRunning && turnStartedAtMs !== null && turnStartedAtMs !== undefined
      ? formatLiveElapsed(Math.max(0, (nowMs - turnStartedAtMs) / 1000))
      : null;
  // The pill DRAWS the elapsed reading (or the state word until one
  // exists) while a turn is in flight, and `Idle` otherwise. Its
  // accessible name always carries both the word and the reading, so
  // TalkBack never hears a bare number (plan.md §10.5).
  const pillLabel = turnRunning ? (elapsedText ?? "Working") : "Idle";
  const pillAccessibilityLabel = turnRunning
    ? elapsedText === null
      ? "Working"
      : `Working, ${elapsedText}`
    : "Idle";

  return (
    <View style={styles.screen} testID={testId}>
      <ScreenBar
        title="Live"
        leading={{
          mark: "‹",
          accessibleName: "Back to session",
          onPress: onBack,
          testId: `${testId}-back`,
        }}
        status={
          <StatusPill
            label={pillLabel}
            tone={turnRunning ? "info" : "neutral"}
            showDot={turnRunning}
            accessibilityLabel={pillAccessibilityLabel}
            testId={`${testId}-status`}
          />
        }
        testId={`${testId}-bar`}
      />
      <ScrollView contentContainerStyle={styles.body}>
        <LiveCard
          title={model.subagents.title}
          summary={model.subagents.summary}
          emptyText={model.subagents.emptyText}
          testId={`${testId}-subagents`}
        >
          <View style={styles.rows}>
            {model.subagents.rows.map((row) => (
              <SubagentRow key={row.key} row={row} />
            ))}
          </View>
        </LiveCard>
        <LiveCard
          title={model.workflow.title}
          summary={model.workflow.summary}
          emptyText={model.workflow.emptyText}
          testId={`${testId}-workflow`}
        >
          <View style={styles.rows}>
            {model.workflow.rows.map((row) => (
              <WorkflowRow key={row.key} row={row} />
            ))}
          </View>
        </LiveCard>
        <ContextCard usage={usage} autoCompaction={autoCompaction} testId={`${testId}-context`} />
        {navActions ? (
          <View style={styles.card} testID={`${testId}-nav`}>
            <Text accessibilityRole="header" style={styles.cardTitle}>
              Workspace
            </Text>
            <Text style={styles.cardSummary}>
              Browse this session's files, or open its terminal
            </Text>
            {navActions}
          </View>
        ) : null}
      </ScrollView>
    </View>
  );
}

function createStyles(theme: ReturnType<typeof useTheme>["theme"]) {
  return StyleSheet.create({
    screen: {
      flex: 1,
      backgroundColor: theme.colors.page,
    },
    body: {
      gap: theme.spacing[3],
      paddingHorizontal: theme.spacing[3],
      paddingBottom: theme.spacing[4],
    },
    card: {
      gap: theme.spacing[1],
      paddingVertical: theme.spacing[3],
      paddingHorizontal: theme.spacing[3] + 1,
      borderRadius: theme.radii.window,
      backgroundColor: theme.colors.surface,
      ...ringShadow(theme, "card"),
    },
    cardTitle: {
      color: theme.colors.ink,
      fontSize: theme.typography.variant.body.fontSize,
      fontWeight: asFontWeight(theme.typography.fontWeight.semibold),
    },
    cardSummary: {
      color: theme.colors["ink-3"],
      fontSize: CARD_SUMMARY_SIZE,
    },
    emptyText: {
      marginTop: theme.spacing[2],
      color: theme.colors["ink-2"],
      fontSize: CARD_SUMMARY_SIZE,
    },
    rows: {
      marginTop: theme.spacing[2],
      gap: theme.spacing[2],
    },
    row: {
      flexDirection: "row",
      alignItems: "center",
      gap: theme.spacing[2],
      minHeight: ROW_MIN_HEIGHT,
    },
    rowName: {
      flex: 1,
      minWidth: 0,
      color: theme.colors.ink,
      fontFamily: theme.typography.variant.code.fontFamily,
      fontSize: ROW_FONT_SIZE,
    },
    workflowName: {
      flex: 1,
      minWidth: 0,
      color: theme.colors.ink,
      fontSize: WORKFLOW_NAME_SIZE,
    },
    rowWord: {
      color: theme.colors["ink-3"],
      fontFamily: theme.typography.variant.code.fontFamily,
      fontSize: WORKFLOW_STEP_SIZE,
    },
    // A2's `.elapsed`: mono 11px in `ink-3`, beside the row's name.
    rowElapsed: {
      color: theme.colors["ink-3"],
      fontFamily: theme.typography.variant.code.fontFamily,
      fontSize: ROW_ELAPSED_SIZE,
    },
    glyphRing: {
      width: GLYPH_SIZE,
      height: GLYPH_SIZE,
      borderRadius: theme.radii.full,
      borderWidth: 1.5,
    },
    workflowTrack: {
      width: WORKFLOW_BAR_WIDTH,
      height: WORKFLOW_BAR_HEIGHT,
      borderRadius: theme.radii.full,
      backgroundColor: theme.colors.inset,
      overflow: "hidden",
    },
    workflowFill: {
      height: WORKFLOW_BAR_HEIGHT,
      borderRadius: theme.radii.full,
      backgroundColor: theme.colors.accent,
    },
    contextTrack: {
      marginTop: theme.spacing[2],
      height: CONTEXT_BAR_HEIGHT,
      borderRadius: theme.radii.full,
      backgroundColor: theme.colors.inset,
      overflow: "hidden",
    },
    contextFill: {
      height: CONTEXT_BAR_HEIGHT,
      borderRadius: theme.radii.full,
    },
    contextStats: {
      marginTop: theme.spacing[1],
      color: theme.colors["ink-2"],
      fontFamily: theme.typography.variant.code.fontFamily,
      fontSize: CONTEXT_STATS_SIZE,
    },
  });
}
