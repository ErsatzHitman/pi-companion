/**
 * T39A — single source of the testIds/strings
 * `session-tree-sheet.yaml` asserts on. Same rationale as
 * `recovered-turn-banner-contract.ts` (T106): Maestro's `.yaml` flows
 * cannot `import` this file (Maestro has no module system), so the yaml
 * restates each value inline, and
 * `session-tree-sheet.contract.test.ts` is what actually keeps that
 * restatement honest against real source, not this file by itself.
 */
export const SESSION_TREE_SHEET_FLOW = {
  /**
   * Deep link straight to the T39A dev-only lab route
   * (`../../src/app/dev/session-tree-lab.tsx`), using the
   * `picompanion://` scheme (`../../app.config.ts`'s
   * `scheme: "picompanion"`), the same technique
   * `recovered-turn-banner-contract.ts`'s `labDeepLink` already
   * documents.
   */
  labDeepLink: "picompanion://dev/session-tree-lab",

  /** `session-tree-lab.tsx`'s `ScrollView` root testID. */
  labRoot: "session-tree-lab",
  /** `session-tree-lab.tsx`'s status `Text` testID — content is `` `Last action: ${lastAction}` ``. */
  labStatus: "session-tree-lab-status",
  /** `session-tree-lab.tsx`'s "Enable client" Button testId. */
  enableClientButton: "session-tree-lab-enable-client",

  /** `session-tree-lab.tsx`'s `SessionTreeSheet` testId prop. */
  sheetTestId: "session-tree-lab-sheet",
  /** `session-tree-lab.tsx`'s fixture agentIds. */
  rootAgentId: "lab-root",
  branchAgentId: "lab-branch",
  copyAgentId: "lab-copy",

  /** `session-tree-sheet.tsx`'s per-row testId pattern: `` `${testId}-item-${row.node.agentId}` ``. */
  itemIdFor(agentId: string): string {
    return `session-tree-lab-sheet-item-${agentId}`;
  },
  /** `session-tree-sheet.tsx`'s actions-block testId: `` `${testId}-actions` ``. */
  actionsId: "session-tree-lab-sheet-actions",
  /** `session-tree-sheet.tsx`'s per-action Button testId: `` `${testId}-action-${kind}` ``. */
  actionIdFor(kind: "fork" | "clone" | "rename"): string {
    return `session-tree-lab-sheet-action-${kind}`;
  },
  /** `session-tree-sheet.tsx`'s per-action unavailable-caption testId: `` `${testId}-action-${kind}-unavailable` ``. */
  actionUnavailableIdFor(kind: "fork" | "clone" | "rename"): string {
    return `session-tree-lab-sheet-action-${kind}-unavailable`;
  },
} as const;
