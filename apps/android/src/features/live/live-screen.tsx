import { useMemo, type ReactNode } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";

import type { PiUiElement } from "@picompanion/protocol/pi-ui-bridge/schema";

import { StatusPill, VectorIcon } from "../../ui/primitives";
import { PixelLoader, ScreenBar } from "../../ui/recipes";
import { asFontWeight, ringShadow } from "../../ui/theme/native-style-helpers";
import { useTheme } from "../../ui/theme/theme-context";
import {
  buildLiveScreenViewModel,
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
  onBack: () => void;
  /**
   * The Files/Terminal controls, mounted by the route because they
   * need a router. A node rather than two callbacks so this screen
   * takes no view on how they navigate.
   */
  navActions?: ReactNode;
  testId?: string;
}

/** The artifact's `.card`. */
const CARD_RADIUS = 22;
/** The artifact's `.card h3`. */
const CARD_TITLE_SIZE = 13;
/** The artifact's `.card p`. */
const CARD_SUMMARY_SIZE = 11.5;
/** The artifact's `.row.sub`. */
const ROW_MIN_HEIGHT = 34;
/** The artifact's mono row text. */
const ROW_FONT_SIZE = 12;
/** The artifact's workflow bar: 70×5. */
const WORKFLOW_BAR_WIDTH = 70;
const WORKFLOW_BAR_HEIGHT = 5;
/** The artifact's hollow waiting ring. */
const GLYPH_SIZE = 12;

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
      {row.stateWord ? <Text style={styles.rowWord}>{row.stateWord}</Text> : null}
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

export function LiveScreen({
  elements,
  turnRunning,
  onBack,
  navActions,
  testId = "live-screen",
}: LiveScreenProps) {
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const model = useMemo(() => buildLiveScreenViewModel(elements), [elements]);

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
            label={turnRunning ? "Working" : "Idle"}
            tone={turnRunning ? "success" : "neutral"}
            showDot={turnRunning}
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
      padding: theme.spacing[3],
      borderRadius: CARD_RADIUS,
      backgroundColor: theme.colors.surface,
      ...ringShadow(theme, "card"),
    },
    cardTitle: {
      color: theme.colors.ink,
      fontSize: CARD_TITLE_SIZE,
      fontWeight: asFontWeight(theme.typography.fontWeight.medium),
    },
    cardSummary: {
      color: theme.colors["ink-2"],
      fontSize: CARD_SUMMARY_SIZE,
    },
    emptyText: {
      marginTop: theme.spacing[2],
      color: theme.colors["ink-2"],
      fontSize: CARD_SUMMARY_SIZE,
    },
    rows: {
      marginTop: theme.spacing[2],
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
      fontSize: ROW_FONT_SIZE,
    },
    rowWord: {
      color: theme.colors["ink-3"],
      fontFamily: theme.typography.variant.code.fontFamily,
      fontSize: ROW_FONT_SIZE,
    },
    rowElapsed: {
      color: theme.colors["ink-2"],
      fontFamily: theme.typography.variant.code.fontFamily,
      fontSize: ROW_FONT_SIZE,
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
  });
}
