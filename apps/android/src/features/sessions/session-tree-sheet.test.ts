import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * `session-tree-sheet.tsx` imports `react-native` (via `Sheet`/`Button`/
 * `TextField`/`EmptyState` from `../../ui/primitives`), which cannot be
 * rendered under this workspace's plain `vitest` setup — the RolldownError
 * on `node_modules/react-native/index.js:1:0`, proven 27+ times across
 * this codebase (see `../transcript/recovered-turn-banner.test.ts`'s doc
 * comment for the identical constraint and the `readCode()`/
 * `readComponentCode()` pattern this file copies). All real logic
 * (row flattening, title/indent/depth-badge derivation, fork/clone/
 * rename dispatch and its "unavailable" truthful-state text) already has
 * render-free behavioural proof in `./session-tree-sheet-model.test.ts`;
 * this file only proves the `.tsx` actually wires that into the render
 * tree — the empty-state gate, the per-row mapping and its testIds, the
 * selection callback, and the per-selection action row's availability
 * gating — rather than silently dropping any of it.
 *
 * `readComponentCode()` anchors every assertion below to the one
 * top-level `SessionTreeSheet` function (CLAUDE.md's "a sibling
 * occurrence of the same code satisfying a whole-file toMatch" defect
 * class) — this file declares no second top-level function today, but
 * the anchor costs nothing and stops that defect class from ever
 * silently reappearing.
 *
 * Every assertion below was mutation-checked by hand (delete the real
 * construct, re-run this file, confirm the specific `it` fails, restore
 * byte-identically). See this task's (T39A) report for the run log.
 */
function readSource(): string {
  return readFileSync(fileURLToPath(new URL("./session-tree-sheet.tsx", import.meta.url)), "utf8");
}

function readCode(): string {
  return readSource()
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");
}

/** Slices `readCode()` down to the one top-level `function SessionTreeSheet(...)` declaration. */
function readComponentCode(): string {
  const code = readCode();
  const body = code
    .split(/^(?:export default |export )?function /m)
    .map((part) => `function ${part}`)
    .find((part) => part.startsWith("function SessionTreeSheet("));
  expect(
    body,
    "session-tree-sheet.tsx should declare a top-level function SessionTreeSheet",
  ).toBeDefined();
  return body ?? "";
}

describe("SessionTreeSheet: imports the tree model only through the package specifier", () => {
  it('imports "sessions" from "@picompanion/frontend-core", never a source-relative cross-workspace path', () => {
    const code = readCode();
    expect(code).toMatch(
      /import \{ sessions as coreSessions \} from "@picompanion\/frontend-core";/,
    );
    expect(code).not.toMatch(/from ["'].*packages\/frontend-core/);
  });

  it("builds the index via the real coreSessions.buildSessionTreeIndex, never a private re-implementation", () => {
    expect(readComponentCode()).toMatch(/coreSessions\.buildSessionTreeIndex\(nodes\)/);
  });

  it("derives rows via the RN-free model's flattenVisibleSessionTreeRows, not inline recursion", () => {
    expect(readComponentCode()).toMatch(/flattenVisibleSessionTreeRows\(index, collapsed\)/);
  });
});

describe("SessionTreeSheet: empty case renders EmptyState, not the row list", () => {
  it("branches on rows.length === 0 to EmptyState before ever mapping rows", () => {
    const code = readComponentCode();
    expect(code).toMatch(/\{rows\.length === 0 \? \(/);
    expect(code).toMatch(/<EmptyState\s/);
  });
});

describe("SessionTreeSheet: one row per node, selection calls onSelectSession with the node's own agentId", () => {
  it("maps rows to a Pressable testId'd by the node's own agentId", () => {
    const code = readComponentCode();
    expect(code).toMatch(/\{rows\.map\(\(row\) => \{/);
    expect(code).toMatch(/testID=\{`\$\{testId\}-item-\$\{row\.node\.agentId\}`\}/);
  });

  it("tapping a row calls onSelectSession with THAT row's own agentId, not a stale/shared value", () => {
    expect(readComponentCode()).toMatch(
      /onPress=\{\(\) => onSelectSession\?\.\(row\.node\.agentId\)\}/,
    );
  });

  it("marks the selected row via accessibilityState selected, computed per-row", () => {
    const code = readComponentCode();
    expect(code).toMatch(/const isSelected = row\.node\.agentId === selectedAgentId;/);
    expect(code).toMatch(/accessibilityState=\{\{ selected: isSelected \}\}/);
  });

  it("derives the visible title from the model's resolveSessionTreeRowTitle, never an inline fallback", () => {
    const code = readComponentCode();
    expect(code).toMatch(/const title = resolveSessionTreeRowTitle\(row\.node\);/);
    expect(code).not.toMatch(/row\.node\.name \?\? /);
  });
});

describe("SessionTreeSheet: expand/collapse toggle only for rows with children", () => {
  it("renders a chevron Pressable, testId'd '-toggle-<agentId>', only when row.hasChildren", () => {
    const code = readComponentCode();
    expect(code).toMatch(/\{row\.hasChildren \? \(/);
    expect(code).toMatch(/testID=\{`\$\{testId\}-toggle-\$\{row\.node\.agentId\}`\}/);
  });

  it("the toggle stops propagation so it never also selects the row", () => {
    expect(readComponentCode()).toMatch(
      /event\.stopPropagation\(\);\s*\n\s*toggle\(row\.node\.agentId\);/,
    );
  });
});

describe("SessionTreeSheet: kind label, clone provenance, and depth badge", () => {
  it('shows a kind label whenever kind !== "root"', () => {
    expect(readComponentCode()).toMatch(/\{row\.node\.kind !== "root" \? \(/);
  });

  it('shows a "cloned from …" provenance label only for a clone with a clonedFrom pointer', () => {
    const code = readComponentCode();
    expect(code).toMatch(/row\.node\.kind === "clone" && row\.node\.clonedFrom \? \(/);
    expect(code).toMatch(
      /cloned from \$\{row\.node\.clonedFrom\.name \?\? row\.node\.clonedFrom\.agentId\}/,
    );
  });

  it("shows the depth badge only via the model's showsSessionTreeDepthBadge, never a raw depth comparison", () => {
    const code = readComponentCode();
    expect(code).toMatch(/\{showsSessionTreeDepthBadge\(row\.depth\) \? \(/);
    expect(code).not.toMatch(/depth > MAX_INDENT_DEPTH/);
  });
});

describe("SessionTreeSheet: the per-selection fork/clone/rename action row", () => {
  it("renders the actions block only when a row is selected (selectedRow), never unconditionally", () => {
    expect(readComponentCode()).toMatch(/\{selectedRow \? \(/);
  });

  it("renders exactly the three actions fork/clone/rename, each gated by isSessionTreeActionAvailable", () => {
    const code = readComponentCode();
    expect(code).toMatch(/\(\["fork", "clone", "rename"\] as const\)\.map\(\(kind\) => \{/);
    expect(code).toMatch(/const available = isSessionTreeActionAvailable\(client, kind\);/);
  });

  it("a Button always renders per action, disabled at least when !available", () => {
    const code = readComponentCode();
    expect(code).toMatch(/const disabled =\s*\n\s*!available \|\|/);
    expect(code).toMatch(/disabled=\{disabled\}/);
  });

  it("an unavailable action shows describeSessionTreeActionUnavailable's own text, never a hand-typed string", () => {
    const code = readComponentCode();
    expect(code).toMatch(/\{!available \? \(/);
    expect(code).toMatch(/\{describeSessionTreeActionUnavailable\(kind\)\}/);
  });

  it("dispatches through the model's forkSessionTreeNode/cloneSessionTreeNode/renameSessionTreeNode, never a private re-implementation", () => {
    const code = readComponentCode();
    expect(code).toMatch(/await forkSessionTreeNode\(client, selectedRow\.node\)/);
    expect(code).toMatch(/await cloneSessionTreeNode\(client, selectedRow\.node\)/);
    expect(code).toMatch(
      /await renameSessionTreeNode\(client, selectedRow\.node, \{ name: renameDraft \}\)/,
    );
  });

  it("reports a thrown action error's message via onActionError, never swallowing it silently", () => {
    const code = readComponentCode();
    expect(code).toMatch(
      /onActionError\?\.\(kind, error instanceof Error \? error\.message : String\(error\)\)/,
    );
  });

  it("reports a successful action's result via onActionResult", () => {
    expect(readComponentCode()).toMatch(/onActionResult\?\.\(kind, result\);/);
  });

  it('the rename TextField\'s editable state is gated by isSessionTreeActionAvailable(client, "rename"), same guard as the button', () => {
    expect(readComponentCode()).toMatch(
      /editable=\{isSessionTreeActionAvailable\(client, "rename"\)\}/,
    );
  });
});
