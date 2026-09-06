import {
  sessions as coreSessions,
  type sessions as coreSessionsType,
} from "@picompanion/frontend-core";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { axe } from "jest-axe";
import { afterEach, describe, expect, it } from "vitest";

import { SessionTree } from "./session-tree.js";

/**
 * `SessionTree` (T38A2, plan.md §8.3, §11.1). Every acceptance criterion
 * from `docs/issues-from-plan.md` is exercised behaviourally (rendered
 * DOM + real key events), never by source-text assertion:
 *
 *  - "The tree renders parent/child relationships correctly"
 *  - "Deep trees stay bounded and navigable"
 *  - "Keyboard navigation works"
 *
 * Fixtures are built directly from `@picompanion/frontend-core`'s T38A1a
 * `createRootSession`/`forkSession`/`cloneSession` — this test never
 * hand-rolls a `SessionTreeNode`.
 */

afterEach(cleanup);

type SessionTreeNode = coreSessionsType.SessionTreeNode;

function buildForkChain(depth: number): SessionTreeNode[] {
  const nodes: SessionTreeNode[] = [];
  let current = coreSessions.createRootSession({
    agentId: "chain-0",
    name: "Chain root",
    createdAt: 0,
  });
  nodes.push(current);
  for (let i = 1; i <= depth; i++) {
    current = coreSessions.forkSession(current, {
      agentId: `chain-${i}`,
      name: `Chain ${i}`,
      forkPoint: { messageId: `m${i}`, index: i },
      createdAt: i,
    });
    nodes.push(current);
  }
  return nodes;
}

function itemTestId(agentId: string): string {
  return `session-tree-item-${agentId}`;
}

describe("SessionTree", () => {
  it("renders a fork nested under its parent and a clone as its own top-level root", () => {
    const root = coreSessions.createRootSession({ agentId: "root", name: "Root", createdAt: 0 });
    const child = coreSessions.forkSession(root, {
      agentId: "child",
      name: "Child",
      forkPoint: { messageId: "m1", index: 1 },
      createdAt: 10,
    });
    const grandchild = coreSessions.forkSession(child, {
      agentId: "grandchild",
      name: "Grandchild",
      forkPoint: { messageId: "m2", index: 2 },
      createdAt: 20,
    });
    const clone = coreSessions.cloneSession(root, {
      agentId: "clone",
      name: "Cloned copy",
      createdAt: 30,
    });

    render(<SessionTree nodes={[root, child, grandchild, clone]} />);

    const tree = screen.getByRole("tree", { name: "Sessions" });
    const items = tree.querySelectorAll('[role="treeitem"]');
    // Depth-first order: root, child, grandchild, then the clone (a
    // separate top-level root, sorted after root's subtree by createdAt).
    expect(Array.from(items).map((el) => el.getAttribute("data-testid"))).toEqual([
      itemTestId("root"),
      itemTestId("child"),
      itemTestId("grandchild"),
      itemTestId("clone"),
    ]);

    // Fork nesting: aria-level increases one per fork.
    expect(screen.getByTestId(itemTestId("root")).getAttribute("aria-level")).toBe("1");
    expect(screen.getByTestId(itemTestId("child")).getAttribute("aria-level")).toBe("2");
    expect(screen.getByTestId(itemTestId("grandchild")).getAttribute("aria-level")).toBe("3");

    // Clone starts a brand-new tree: it is NOT nested under root (level 1,
    // not 2), matching tree.ts's "a clone is a different tree by design".
    const cloneItem = screen.getByTestId(itemTestId("clone"));
    expect(cloneItem.getAttribute("aria-level")).toBe("1");
    expect(cloneItem.textContent).toContain("cloned from Root");
    expect(cloneItem.textContent).toContain("clone");

    // The fork/clone kind label is visible text, not colour-only.
    expect(screen.getByTestId("session-tree-kind-child").textContent).toBe("fork");
    expect(screen.getByTestId("session-tree-kind-clone").textContent).toBe("clone");
    // A root carries no redundant kind label.
    expect(screen.queryByTestId("session-tree-kind-root")).toBeNull();
  });

  it("has no axe violations", async () => {
    const root = coreSessions.createRootSession({ agentId: "root", name: "Root", createdAt: 0 });
    const child = coreSessions.forkSession(root, {
      agentId: "child",
      name: "Child",
      forkPoint: { messageId: "m1", index: 1 },
      createdAt: 10,
    });
    const { container } = render(<SessionTree nodes={[root, child]} selectedAgentId="child" />);
    expect(await axe(container)).toHaveNoViolations();
  });

  it("selects a row on click and reflects it via aria-selected", () => {
    const root = coreSessions.createRootSession({ agentId: "root", name: "Root", createdAt: 0 });
    const child = coreSessions.forkSession(root, {
      agentId: "child",
      name: "Child",
      forkPoint: { messageId: "m1", index: 1 },
      createdAt: 10,
    });
    const selections: string[] = [];
    render(
      <SessionTree
        nodes={[root, child]}
        selectedAgentId="root"
        onSelectSession={(id) => selections.push(id)}
      />,
    );

    expect(screen.getByTestId(itemTestId("root")).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByTestId(itemTestId("child")).getAttribute("aria-selected")).toBe("false");

    fireEvent.click(screen.getByTestId(itemTestId("child")));
    expect(selections).toEqual(["child"]);
  });

  it("moves focus with ArrowDown/ArrowUp through visible rows, and selects with Enter", () => {
    const nodes = buildForkChain(3); // chain-0 .. chain-3
    render(<SessionTree nodes={nodes} />);

    const first = screen.getByTestId(itemTestId("chain-0"));
    first.focus();
    expect(document.activeElement).toBe(first);

    fireEvent.keyDown(first, { key: "ArrowDown" });
    const second = screen.getByTestId(itemTestId("chain-1"));
    expect(document.activeElement).toBe(second);

    fireEvent.keyDown(second, { key: "ArrowDown" });
    const third = screen.getByTestId(itemTestId("chain-2"));
    expect(document.activeElement).toBe(third);

    fireEvent.keyDown(third, { key: "ArrowUp" });
    expect(document.activeElement).toBe(second);

    const selections: string[] = [];
    // Re-render with the callback wired so Enter is observable — same
    // fixture, so IDs/focus targets are unaffected.
    cleanup();
    render(<SessionTree nodes={nodes} onSelectSession={(id) => selections.push(id)} />);
    const refocused = screen.getByTestId(itemTestId("chain-1"));
    refocused.focus();
    fireEvent.keyDown(refocused, { key: "Enter" });
    expect(selections).toEqual(["chain-1"]);
  });

  it("Space selects the focused row (the documented Enter/Space contract, both halves)", () => {
    // session-tree.tsx's module doc and `onSelectSession`'s own prop doc
    // both promise "click, Enter, or Space". Only Enter was covered:
    // deleting `case " ":` from the keydown switch left every test in this
    // file green (verified by mutation), so the Space half of that contract
    // was a claim nothing could falsify.
    const nodes = buildForkChain(2);
    const selections: string[] = [];
    render(<SessionTree nodes={nodes} onSelectSession={(id) => selections.push(id)} />);

    const row = screen.getByTestId(itemTestId("chain-1"));
    row.focus();
    fireEvent.keyDown(row, { key: " " });

    expect(selections).toEqual(["chain-1"]);
    expect(document.activeElement).toBe(row);
  });

  it("Home/End jump to the first and last visible rows", () => {
    const nodes = buildForkChain(4); // chain-0 .. chain-4
    render(<SessionTree nodes={nodes} />);

    const middle = screen.getByTestId(itemTestId("chain-2"));
    middle.focus();

    fireEvent.keyDown(middle, { key: "End" });
    expect(document.activeElement).toBe(screen.getByTestId(itemTestId("chain-4")));

    fireEvent.keyDown(screen.getByTestId(itemTestId("chain-4")), { key: "Home" });
    expect(document.activeElement).toBe(screen.getByTestId(itemTestId("chain-0")));
  });

  it("ArrowLeft collapses a node (removing its descendants from the DOM) and ArrowRight re-expands it, moving focus into the first child when already expanded", () => {
    const root = coreSessions.createRootSession({ agentId: "root", name: "Root", createdAt: 0 });
    const child = coreSessions.forkSession(root, {
      agentId: "child",
      name: "Child",
      forkPoint: { messageId: "m1", index: 1 },
      createdAt: 10,
    });
    const grandchild = coreSessions.forkSession(child, {
      agentId: "grandchild",
      name: "Grandchild",
      forkPoint: { messageId: "m2", index: 2 },
      createdAt: 20,
    });
    render(<SessionTree nodes={[root, child, grandchild]} />);

    const rootItem = screen.getByTestId(itemTestId("root"));
    rootItem.focus();
    expect(rootItem.getAttribute("aria-expanded")).toBe("true");

    // ArrowRight on an already-expanded parent moves focus to the first child.
    fireEvent.keyDown(rootItem, { key: "ArrowRight" });
    expect(document.activeElement).toBe(screen.getByTestId(itemTestId("child")));

    // ArrowLeft on a leaf/collapsed node with a parent moves focus to the parent.
    const grandchildItem = screen.getByTestId(itemTestId("grandchild"));
    grandchildItem.focus();
    fireEvent.keyDown(grandchildItem, { key: "ArrowLeft" });
    expect(document.activeElement).toBe(screen.getByTestId(itemTestId("child")));

    // ArrowLeft on an expanded parent collapses it — descendants leave the DOM.
    fireEvent.keyDown(screen.getByTestId(itemTestId("child")), { key: "ArrowLeft" });
    expect(screen.getByTestId(itemTestId("child")).getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByTestId(itemTestId("grandchild"))).toBeNull();
    // Focus stays on the node that was just collapsed.
    expect(document.activeElement).toBe(screen.getByTestId(itemTestId("child")));

    // ArrowRight on a collapsed parent re-expands it without moving focus.
    fireEvent.keyDown(screen.getByTestId(itemTestId("child")), { key: "ArrowRight" });
    expect(screen.getByTestId(itemTestId("child")).getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByTestId(itemTestId("grandchild"))).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByTestId(itemTestId("child")));
  });

  it("the mouse-only chevron toggles collapse without selecting the row", () => {
    const root = coreSessions.createRootSession({ agentId: "root", name: "Root", createdAt: 0 });
    const child = coreSessions.forkSession(root, {
      agentId: "child",
      name: "Child",
      forkPoint: { messageId: "m1", index: 1 },
      createdAt: 10,
    });
    const selections: string[] = [];
    render(<SessionTree nodes={[root, child]} onSelectSession={(id) => selections.push(id)} />);

    const toggle = screen.getByTestId("session-tree-toggle-root");
    expect(toggle.getAttribute("tabIndex") ?? toggle.tabIndex.toString()).toBe("-1");

    fireEvent.click(toggle);
    expect(screen.getByTestId(itemTestId("root")).getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByTestId(itemTestId("child"))).toBeNull();
    expect(selections).toEqual([]); // clicking the chevron never selects the row
  });

  describe("deep trees stay bounded and navigable", () => {
    // MAX_INDENT_DEPTH (session-tree.tsx) is 8; go well past it.
    const DEPTH = 30;
    const nodes = buildForkChain(DEPTH);

    it("caps visual indentation at the documented depth instead of growing without bound", () => {
      render(<SessionTree nodes={nodes} />);

      const withinCap = screen.getByTestId(itemTestId("chain-5"));
      expect(withinCap.style.paddingInlineStart).toBe("calc(5 * var(--spacing-4))");

      const pastCap = screen.getByTestId(itemTestId(`chain-${DEPTH}`));
      // Depth 30 is clamped to the same indent as depth 8 — bounded, not
      // proportional to the real depth.
      expect(pastCap.style.paddingInlineStart).toBe("calc(8 * var(--spacing-4))");

      const atCap = screen.getByTestId(itemTestId("chain-8"));
      expect(atCap.style.paddingInlineStart).toBe("calc(8 * var(--spacing-4))");
    });

    it("never loses the real depth: aria-level is exact and a text depth badge appears past the cap", () => {
      render(<SessionTree nodes={nodes} />);

      // aria-level is 1-based and uncapped.
      expect(screen.getByTestId(itemTestId(`chain-${DEPTH}`)).getAttribute("aria-level")).toBe(
        String(DEPTH + 1),
      );

      // No badge within the cap...
      expect(screen.queryByTestId("session-tree-depth-chain-8")).toBeNull();
      // ...a visible text badge past it.
      const badge = screen.getByTestId(`session-tree-depth-chain-${DEPTH}`);
      expect(badge.textContent).toBe(`L${DEPTH + 1}`);
    });

    it("stays fully keyboard-navigable however deep it goes: DEPTH ArrowDown presses from the root reach the deepest node", () => {
      render(<SessionTree nodes={nodes} />);

      let current = screen.getByTestId(itemTestId("chain-0"));
      current.focus();
      for (let i = 0; i < DEPTH; i++) {
        fireEvent.keyDown(current, { key: "ArrowDown" });
        current = document.activeElement as HTMLElement;
      }

      expect(current).toBe(screen.getByTestId(itemTestId(`chain-${DEPTH}`)));

      // And back up in one End/Home round trip.
      fireEvent.keyDown(current, { key: "Home" });
      expect(document.activeElement).toBe(screen.getByTestId(itemTestId("chain-0")));
      fireEvent.keyDown(document.activeElement as HTMLElement, { key: "End" });
      expect(document.activeElement).toBe(screen.getByTestId(itemTestId(`chain-${DEPTH}`)));
    });
  });

  it("renders an EmptyState instead of an empty tree when there are no nodes", () => {
    render(<SessionTree nodes={[]} testId="empty-tree" />);
    expect(screen.getByTestId("empty-tree-empty")).toBeTruthy();
    expect(screen.queryByRole("tree")).toBeNull();
  });
});
