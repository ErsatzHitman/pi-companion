import { useMemo, useRef, useState } from "react";
import type { KeyboardEvent } from "react";

import { sessions as coreSessions } from "@picompanion/frontend-core";

import { EmptyState } from "../../ui/primitives/index.js";

import "./session-tree.css";

/**
 * Renders the session tree built by `packages/frontend-core`'s T38A1a
 * model (`SessionTreeNode`/`buildSessionTreeIndex`) in the web session
 * rail (T38A2, plan.md §8.3, §11.1). This file only renders the model;
 * it builds no tree data of its own and never re-derives fork/clone
 * semantics — see `tree.ts`'s module doc for that distinction, which
 * this component mirrors rather than reinterprets:
 *
 *  - a **fork** renders nested under its structural parent (indentation
 *    + `aria-level` increase one level per fork);
 *  - a **clone** renders as its own top-level root (never nested under
 *    its `clonedFrom` source), with a small "cloned from …" provenance
 *    label instead of an indentation change, matching `tree.ts`'s
 *    explicit "a clone is a different tree by design" rule.
 *
 * ## Why a flat `role="tree"` list, not nested `role="group"` elements
 *
 * The WAI-ARIA "tree view" pattern commonly nests a `role="group"`
 * `<ul>` inside each expandable `role="treeitem"`. This component
 * instead renders one flat `<ul role="tree">` of sibling
 * `role="treeitem"` `<li>`s in depth-first order, communicating
 * hierarchy entirely through `aria-level`/`aria-posinset`/
 * `aria-setsize` (a technique ARIA explicitly allows: `aria-expanded`
 * on a treeitem describes whether its descendants are rendered at all,
 * not whether a particular DOM group element is visible). A flat list
 * is what makes the depth cap below a single, testable computation
 * instead of a recursive one, and keeps a future virtualized/windowed
 * version (large trees) a non-restructuring change.
 *
 * ## Deep trees stay bounded: indentation is capped at `MAX_INDENT_DEPTH`
 *
 * Real branch trees are fork chains that can go arbitrarily deep (every
 * "edit from here", T38A1b, adds one). Indenting every level by
 * `--spacing-4` (1rem) without limit means a session 40 forks deep
 * would want ~40rem (640px) of left padding — wider than the entire
 * session rail — pushing the title itself off-screen and making the
 * row practically unreadable and, since the row's own text is what a
 * mouse/keyboard user reads to identify it, unnavigable in effect even
 * though it is still technically present in the DOM.
 *
 * `MAX_INDENT_DEPTH = 8` stops the *visual* indent growing past 8rem
 * (128px) — comfortably inside a typical ~240–320px rail even after the
 * chevron/spacer column, leaving well over half the row for the title —
 * while every deeper row still renders, in full depth-first order, with
 * its true, uncapped depth exposed two ways that do not depend on
 * indentation: `aria-level` (assistive tech never loses the real level)
 * and a visible "L<n>" depth badge past the cap (sighted users get the
 * same information back as text, not spacing, matching plan.md section 10.5's
 * "non-colour status text" rule generalised to "non-spacing depth
 * text"). Keyboard navigation (ArrowUp/Down/Left/Right/Home/End, see
 * below) is completely unaffected by the cap: it walks the same
 * depth-first `rows` array a 4-level tree would, so a 40-level chain is
 * exactly as many ArrowDown presses away from its parent as a 4-level
 * one would be from its own equivalent depth — "bounded" describes the
 * indentation, never the reachability.
 *
 * ## Keyboard navigation
 *
 * Implements the WAI-ARIA APG tree view keyboard contract with a single
 * roving `tabIndex` (one `0`, the rest `-1`, moved with imperative
 * `.focus()` calls -- React state alone does not move DOM focus):
 *
 *  - `ArrowDown`/`ArrowUp` move focus to the next/previous *visible*
 *    row (a collapsed node's descendants are skipped, matching them
 *    being un-rendered, not merely hidden);
 *  - `ArrowRight` on a collapsed parent expands it (focus stays); on an
 *    already-expanded parent it moves focus to the first child;
 *  - `ArrowLeft` on an expanded parent collapses it (focus stays); on a
 *    leaf or an already-collapsed node it moves focus to the structural
 *    parent (never a `clonedFrom` provenance link -- see above);
 *  - `Home`/`End` jump to the first/last visible row;
 *  - `Enter`/`Space` select the focused row.
 *
 * A mouse-only chevron button (`tabIndex={-1}`, so it never adds a
 * second Tab stop) offers the same expand/collapse as `ArrowLeft`/
 * `ArrowRight` for pointer users, stopping click propagation so it
 * never also selects the row.
 */

/** See the module doc's "Deep trees stay bounded" section for the rationale. */
const MAX_INDENT_DEPTH = 8;

interface SessionTreeRow {
  readonly node: coreSessions.SessionTreeNode;
  readonly depth: number;
  readonly hasChildren: boolean;
  readonly siblingIndex: number;
  readonly siblingCount: number;
}

function flattenVisible(
  index: coreSessions.SessionTreeIndex,
  collapsed: ReadonlySet<string>,
): SessionTreeRow[] {
  const rows: SessionTreeRow[] = [];

  function walk(nodes: readonly coreSessions.SessionTreeNode[], depth: number): void {
    nodes.forEach((node, position) => {
      const children = index.getChildren(node.agentId);
      rows.push({
        node,
        depth,
        hasChildren: children.length > 0,
        siblingIndex: position + 1,
        siblingCount: nodes.length,
      });
      if (children.length > 0 && !collapsed.has(node.agentId)) {
        walk(children, depth + 1);
      }
    });
  }

  walk(index.roots, 0);
  return rows;
}

export interface SessionTreeProps {
  /** Flat node collection (T38A1a's `SessionTreeNode`s) this tree renders. */
  nodes: Iterable<coreSessions.SessionTreeNode>;
  /** The currently open session, so its row can be marked selected. */
  selectedAgentId?: string | null;
  /** Called when a row is activated by click, Enter, or Space. */
  onSelectSession?: (agentId: string) => void;
  /** Accessible name for the `role="tree"` region. */
  label?: string;
  testId?: string;
}

/**
 * Renders parent/child (fork) and provenance-only (clone) session
 * relationships as a keyboard-navigable tree. See the module doc above
 * for the fork/clone rendering distinction, the indentation cap, and
 * the full keyboard contract.
 */
export function SessionTree({
  nodes,
  selectedAgentId = null,
  onSelectSession,
  label = "Sessions",
  testId = "session-tree",
}: SessionTreeProps) {
  const index = useMemo(() => coreSessions.buildSessionTreeIndex(nodes), [nodes]);
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set());
  const [focusedIdState, setFocusedIdState] = useState<string | null>(null);
  const itemRefs = useRef(new Map<string, HTMLLIElement>());

  const rows = useMemo(() => flattenVisible(index, collapsed), [index, collapsed]);

  if (rows.length === 0) {
    return (
      <EmptyState
        title="No sessions yet"
        description="Fork or clone a session to see its branches here."
        testId={`${testId}-empty`}
      />
    );
  }

  const visibleIds = new Set(rows.map((row) => row.node.agentId));
  const focusedId =
    (focusedIdState && visibleIds.has(focusedIdState) ? focusedIdState : null) ??
    (selectedAgentId && visibleIds.has(selectedAgentId) ? selectedAgentId : null) ??
    rows[0]!.node.agentId;

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

  function focusRow(agentId: string): void {
    setFocusedIdState(agentId);
    itemRefs.current.get(agentId)?.focus();
  }

  function select(agentId: string): void {
    focusRow(agentId);
    onSelectSession?.(agentId);
  }

  function handleKeyDown(
    event: KeyboardEvent<HTMLLIElement>,
    row: SessionTreeRow,
    rowIndex: number,
  ): void {
    switch (event.key) {
      case "ArrowDown": {
        event.preventDefault();
        const next = rows[rowIndex + 1];
        if (next) focusRow(next.node.agentId);
        break;
      }
      case "ArrowUp": {
        event.preventDefault();
        const prev = rows[rowIndex - 1];
        if (prev) focusRow(prev.node.agentId);
        break;
      }
      case "ArrowRight": {
        if (!row.hasChildren) break;
        event.preventDefault();
        if (collapsed.has(row.node.agentId)) {
          toggle(row.node.agentId);
        } else {
          const next = rows[rowIndex + 1];
          if (next && next.depth > row.depth) focusRow(next.node.agentId);
        }
        break;
      }
      case "ArrowLeft": {
        event.preventDefault();
        if (row.hasChildren && !collapsed.has(row.node.agentId)) {
          toggle(row.node.agentId);
        } else if (row.node.parent) {
          focusRow(row.node.parent.agentId);
        }
        break;
      }
      case "Home": {
        event.preventDefault();
        focusRow(rows[0]!.node.agentId);
        break;
      }
      case "End": {
        event.preventDefault();
        focusRow(rows[rows.length - 1]!.node.agentId);
        break;
      }
      case "Enter":
      case " ": {
        event.preventDefault();
        select(row.node.agentId);
        break;
      }
      default:
        break;
    }
  }

  return (
    <ul className="pc-session-tree" role="tree" aria-label={label} data-testid={testId}>
      {rows.map((row, rowIndex) => {
        const { node, depth, hasChildren } = row;
        const indentDepth = Math.min(depth, MAX_INDENT_DEPTH);
        const isCollapsed = collapsed.has(node.agentId);
        const isSelected = node.agentId === selectedAgentId;
        const isFocused = node.agentId === focusedId;
        const title = node.name ?? "Untitled session";

        return (
          <li
            key={node.agentId}
            ref={(el) => {
              if (el) {
                itemRefs.current.set(node.agentId, el);
              } else {
                itemRefs.current.delete(node.agentId);
              }
            }}
            role="treeitem"
            aria-level={depth + 1}
            aria-setsize={row.siblingCount}
            aria-posinset={row.siblingIndex}
            aria-expanded={hasChildren ? !isCollapsed : undefined}
            aria-selected={isSelected}
            tabIndex={isFocused ? 0 : -1}
            className="pc-session-tree__item"
            data-testid={`${testId}-item-${node.agentId}`}
            data-depth={depth}
            style={{ paddingInlineStart: `calc(${indentDepth} * var(--spacing-4))` }}
            onKeyDown={(event) => handleKeyDown(event, row, rowIndex)}
            onClick={() => select(node.agentId)}
          >
            {hasChildren ? (
              <button
                type="button"
                className="pc-session-tree__chevron-btn"
                tabIndex={-1}
                aria-label={`${isCollapsed ? "Expand" : "Collapse"} ${title}`}
                data-testid={`${testId}-toggle-${node.agentId}`}
                onClick={(event) => {
                  event.stopPropagation();
                  toggle(node.agentId);
                }}
              >
                <span
                  className={`pc-session-tree__chevron${isCollapsed ? "" : " pc-session-tree__chevron--open"}`}
                  aria-hidden="true"
                />
              </button>
            ) : (
              <span className="pc-session-tree__spacer" aria-hidden="true" />
            )}
            <span className="pc-session-tree__title">{title}</span>
            {node.kind !== "root" ? (
              <span
                className="pc-session-tree__kind"
                data-testid={`${testId}-kind-${node.agentId}`}
              >
                {node.kind}
              </span>
            ) : null}
            {node.kind === "clone" && node.clonedFrom ? (
              <span className="pc-session-tree__provenance">
                cloned from {node.clonedFrom.name ?? node.clonedFrom.agentId}
              </span>
            ) : null}
            {depth > MAX_INDENT_DEPTH ? (
              <span
                className="pc-session-tree__depth-badge"
                data-testid={`${testId}-depth-${node.agentId}`}
              >
                L{depth + 1}
              </span>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

export default SessionTree;
