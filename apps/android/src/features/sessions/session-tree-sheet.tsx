/**
 * Android session tree sheet (T39A, plan.md §9.3 "Design system and
 * Beautiful UI" for the `Sheet` primitive, §11.1 "session tree, fork,
 * clone, resume, and naming"). Thin native view over `./session-tree-
 * sheet-model.ts` — every behavioural claim (row flattening, fork/
 * clone/rename dispatch, the truthful-unavailable-state text) lives
 * there with real `vitest` proof; this file only wires those functions
 * into React Native components and `Sheet` (`../../ui/primitives`,
 * T32S5's Portal-backed sheet, never a detached `Modal`, plan.md §9.3).
 * Same split as `../transcript/recovered-turn-banner.tsx`/
 * `recovered-turn-model.ts` — see that file's doc comment for the
 * rationale (`react-native` cannot render under this workspace's plain
 * `vitest`, proven repeatedly; `session-tree-sheet.test.ts` proves this
 * file's JSX with the same anchored-source-text, mutation-checked
 * technique).
 *
 * Renders the tree built by `packages/frontend-core`'s T38A1a model
 * (`SessionTreeNode`/`buildSessionTreeIndex`), imported only through the
 * package specifier `@picompanion/frontend-core` (never a source-
 * relative cross-workspace path, per plan.md §6). A fork renders nested
 * under its structural parent; a clone renders as its own top-level root
 * with a "cloned from …" provenance label — see `./session-tree-sheet-
 * model.ts`'s module doc, and `apps/web/src/features/sessions/
 * session-tree.tsx`'s (this sheet's web counterpart) for the shared
 * rationale this file mirrors rather than reinterprets. Android has no
 * keyboard contract to mirror from that file — rows are plain touch
 * targets (48dp minimum hit area via `Pressable`'s own accessible role),
 * not a roving-tabIndex `role="tree"`. T376: that 48dp was true of the
 * row and false of the expand/collapse chevron beside it, which was a
 * 28dp box plus `hitSlop={8}` — 44dp — for as long as this file sat
 * outside `../../ui/primitives/touch-targets.test.ts`. It is 48dp now,
 * and the audit reaches this file, so the sentence is checked rather
 * than asserted.
 *
 * ## Fork/clone/rename: always a truthful state, never a silent no-op
 *
 * `client` is an optional `SessionTreeClientPort`
 * (`./session-tree-sheet-model.ts`) — deliberately absent on every real
 * build today, because `packages/client/src` sends none of `forkAgent`,
 * `cloneAgent`, or a rename request yet (T110, running in parallel this
 * same wave, is the task closing that wire gap; this file cannot depend
 * on its output landing first). When the selected session's action row
 * renders, each of Fork/Clone/Rename is disabled and captioned with
 * `describeSessionTreeActionUnavailable`'s truthful sentence whenever
 * `client` lacks that method — never an enabled control whose only
 * real-build outcome is a thrown error the user never sees explained.
 */
import { useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { sessions as coreSessions } from "@picompanion/frontend-core";

import { Button, EmptyState, Sheet, TextField } from "../../ui/primitives";
import { useTheme } from "../../ui/theme/theme-context";
import {
  cloneSessionTreeNode,
  describeSessionTreeActionUnavailable,
  flattenVisibleSessionTreeRows,
  forkSessionTreeNode,
  isSessionTreeActionAvailable,
  renameSessionTreeNode,
  resolveSessionTreeRowTitle,
  sessionTreeRowIndentDepth,
  showsSessionTreeDepthBadge,
  type SessionTreeActionKind,
  type SessionTreeActionResult,
  type SessionTreeClientPort,
} from "./session-tree-sheet-model";

export interface SessionTreeSheetProps {
  open: boolean;
  onClose: () => void;
  /** Flat node collection (T38A1a's `SessionTreeNode`s) this sheet renders. */
  nodes: Iterable<coreSessions.SessionTreeNode>;
  /** The currently open session, so its row can be marked selected and its actions shown. */
  selectedAgentId?: string | null;
  /** Called when a row is tapped. */
  onSelectSession?: (agentId: string) => void;
  /**
   * Optional injected fork/clone/rename port — see this file's module
   * doc. Omitted (the default, and today's only real shape) renders
   * every action unavailable.
   */
  client?: SessionTreeClientPort;
  /** Reports a successful fork/clone/rename, with the port's result. */
  onActionResult?: (kind: SessionTreeActionKind, result: SessionTreeActionResult) => void;
  /** Reports a failed fork/clone/rename, including the unavailable case, with a user-facing message. */
  onActionError?: (kind: SessionTreeActionKind, message: string) => void;
  testId?: string;
}

/**
 * Renders parent/child (fork) and provenance-only (clone) session
 * relationships inside a bottom sheet, with a per-selection fork/clone/
 * rename action row. See this file's module doc for the fork/clone
 * rendering distinction and the fork/clone/rename availability contract.
 */
export function SessionTreeSheet({
  open,
  onClose,
  nodes,
  selectedAgentId = null,
  onSelectSession,
  client,
  onActionResult,
  onActionError,
  testId = "session-tree-sheet",
}: SessionTreeSheetProps) {
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set());
  const [renameDraft, setRenameDraft] = useState("");
  const [pendingAction, setPendingAction] = useState<SessionTreeActionKind | null>(null);

  const index = useMemo(() => coreSessions.buildSessionTreeIndex(nodes), [nodes]);
  const rows = useMemo(() => flattenVisibleSessionTreeRows(index, collapsed), [index, collapsed]);
  const selectedRow = rows.find((row) => row.node.agentId === selectedAgentId) ?? null;

  function toggle(agentId: string): void {
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(agentId)) {
        next.delete(agentId);
      } else {
        next.add(agentId);
      }
      return next;
    });
  }

  async function runAction(kind: SessionTreeActionKind): Promise<void> {
    if (!selectedRow) return;
    setPendingAction(kind);
    try {
      const result =
        kind === "fork"
          ? await forkSessionTreeNode(client, selectedRow.node)
          : kind === "clone"
            ? await cloneSessionTreeNode(client, selectedRow.node)
            : await renameSessionTreeNode(client, selectedRow.node, { name: renameDraft });
      onActionResult?.(kind, result);
    } catch (error) {
      onActionError?.(kind, error instanceof Error ? error.message : String(error));
    } finally {
      setPendingAction(null);
    }
  }

  return (
    <Sheet
      open={open}
      title="Session tree"
      description="Fork, clone, or rename a session, or switch to a branch."
      onClose={onClose}
      testId={testId}
    >
      {rows.length === 0 ? (
        <EmptyState
          title="No sessions yet"
          description="Fork or clone a session to see its branches here."
          testId={`${testId}-empty`}
        />
      ) : (
        <View testID={`${testId}-list`}>
          {rows.map((row) => {
            const title = resolveSessionTreeRowTitle(row.node);
            const isSelected = row.node.agentId === selectedAgentId;
            const isCollapsed = collapsed.has(row.node.agentId);
            const indentDepth = sessionTreeRowIndentDepth(row.depth);
            return (
              <Pressable
                key={row.node.agentId}
                accessibilityRole="button"
                accessibilityLabel={title}
                accessibilityState={{ selected: isSelected }}
                onPress={() => onSelectSession?.(row.node.agentId)}
                style={[
                  styles.row,
                  { paddingLeft: theme.spacing[3] + indentDepth * theme.spacing[4] },
                  isSelected ? styles.rowSelected : null,
                ]}
                testID={`${testId}-item-${row.node.agentId}`}
              >
                {row.hasChildren ? (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`${isCollapsed ? "Expand" : "Collapse"} ${title}`}
                    onPress={(event) => {
                      event.stopPropagation();
                      toggle(row.node.agentId);
                    }}
                    hitSlop={8}
                    style={styles.chevronTouch}
                    testID={`${testId}-toggle-${row.node.agentId}`}
                  >
                    <Text style={styles.chevron}>{isCollapsed ? "▸" : "▾"}</Text>
                  </Pressable>
                ) : (
                  <View style={styles.chevronTouch} />
                )}
                <Text style={styles.title}>{title}</Text>
                {row.node.kind !== "root" ? (
                  <Text style={styles.kind} testID={`${testId}-kind-${row.node.agentId}`}>
                    {row.node.kind}
                  </Text>
                ) : null}
                {row.node.kind === "clone" && row.node.clonedFrom ? (
                  <Text style={styles.provenance}>
                    {`cloned from ${row.node.clonedFrom.name ?? row.node.clonedFrom.agentId}`}
                  </Text>
                ) : null}
                {showsSessionTreeDepthBadge(row.depth) ? (
                  <Text style={styles.depthBadge} testID={`${testId}-depth-${row.node.agentId}`}>
                    {`L${row.depth + 1}`}
                  </Text>
                ) : null}
              </Pressable>
            );
          })}
        </View>
      )}
      {selectedRow ? (
        <View style={styles.actions} testID={`${testId}-actions`}>
          <Text style={styles.actionsTitle}>
            {`Actions for ${resolveSessionTreeRowTitle(selectedRow.node)}`}
          </Text>
          <TextField
            label="New name"
            value={renameDraft}
            onChangeText={setRenameDraft}
            editable={isSessionTreeActionAvailable(client, "rename")}
            testId={`${testId}-rename-input`}
          />
          {(["fork", "clone", "rename"] as const).map((kind) => {
            const available = isSessionTreeActionAvailable(client, kind);
            const disabled =
              !available ||
              pendingAction !== null ||
              (kind === "rename" && renameDraft.trim().length === 0);
            const label = kind === "fork" ? "Fork" : kind === "clone" ? "Clone" : "Rename";
            return (
              <View key={kind} style={styles.actionRow}>
                <Button
                  kind="secondary"
                  label={label}
                  disabled={disabled}
                  onPress={() => void runAction(kind)}
                  testId={`${testId}-action-${kind}`}
                />
                {!available ? (
                  <Text style={styles.unavailable} testID={`${testId}-action-${kind}-unavailable`}>
                    {describeSessionTreeActionUnavailable(kind)}
                  </Text>
                ) : null}
              </View>
            );
          })}
        </View>
      ) : null}
    </Sheet>
  );
}

function createStyles(theme: ReturnType<typeof useTheme>["theme"]) {
  return StyleSheet.create({
    row: {
      flexDirection: "row",
      alignItems: "center",
      minHeight: 48,
      gap: theme.spacing[2],
      paddingVertical: theme.spacing[2],
      paddingRight: theme.spacing[3],
    },
    rowSelected: { backgroundColor: theme.colors.hover },
    // T376: 48, not 28. The expand/collapse control was a 28dp box with
    // `hitSlop={8}` -- 44dp of touched area, under plan.md §9.3's 48dp
    // floor, and the file sat outside `ui/primitives/touch-targets.
    // test.ts` so nothing said so. The empty spacer beside it uses the
    // same style, so rows with and without children stay aligned.
    chevronTouch: { width: 48, minHeight: 48, alignItems: "center", justifyContent: "center" },
    chevron: { color: theme.colors["ink-2"], fontSize: theme.typography.variant.body.fontSize },
    title: { flex: 1, color: theme.colors.ink, fontSize: theme.typography.variant.body.fontSize },
    kind: {
      color: theme.colors["ink-2"],
      fontSize: theme.typography.variant.caption.fontSize,
      textTransform: "uppercase",
    },
    provenance: {
      color: theme.colors["ink-3"],
      fontSize: theme.typography.variant.caption.fontSize,
    },
    depthBadge: {
      color: theme.colors["ink-2"],
      fontSize: theme.typography.variant.caption.fontSize,
    },
    actions: {
      gap: theme.spacing[2],
      paddingTop: theme.spacing[3],
      borderTopWidth: StyleSheet.hairlineWidth,
      borderColor: theme.colors.line,
    },
    actionsTitle: {
      color: theme.colors.ink,
      fontSize: theme.typography.variant.label.fontSize,
    },
    actionRow: { gap: theme.spacing[1] },
    unavailable: {
      color: theme.colors["ink-2"],
      fontSize: theme.typography.variant.caption.fontSize,
    },
  });
}

export default SessionTreeSheet;
