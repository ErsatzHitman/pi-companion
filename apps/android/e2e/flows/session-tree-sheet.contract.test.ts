import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { describeSessionTreeActionUnavailable } from "../../src/features/sessions/session-tree-sheet-model.js";
import { PRODUCTION_DAEMON_PORT } from "../harness/production-daemon-port.js";
import { parseMaestroSteps, type MaestroStep } from "./maestro-yaml.js";
import { SESSION_TREE_SHEET_FLOW } from "./session-tree-sheet-contract.js";

/**
 * T39A — proves every testId/string
 * `../../maestro/session-tree-sheet.yaml` names still exists in the real
 * source it targets, and that its step sequence really does what its
 * header claims. Same rationale and precedent as
 * `recovered-turn-banner.contract.test.ts` (T106): there is no
 * emulator, device, or Maestro binary in this wave, so this file is the
 * flow's only proof of life — and this file is what keeps the yaml's
 * restatement of `session-tree-sheet-contract.ts` honest, not that file
 * by itself.
 *
 * Two proof strategies, chosen per module (identical split to
 * `recovered-turn-banner.contract.test.ts`):
 *
 * - `session-tree-sheet-model.ts` is RN-free, so this file imports it
 *   directly and calls the real `describeSessionTreeActionUnavailable`.
 * - `../../src/app/dev/session-tree-lab.tsx` (route wrapper) and
 *   `../../src/dev/session-tree-lab.tsx` (lab content) both import
 *   `react-native`/`expo-router` and are read with `readCode()`
 *   (comment-stripped) and matched against a full JSX/statement
 *   expression, anchored (via `readComponentCode`) to the one top-level
 *   function that owns it.
 *
 * Mutation-checked (see this task's report for the exact mutations,
 * their failures, and the byte-identical restores): the openLink URL
 * matching the route wrapper's own file location, the fixture agentIds
 * matching the lab's `buildFixtureTree()`, and the "never names the
 * production daemon's port" check.
 */

function readSource(relativePath: string): string {
  return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");
}

function readCode(relativePath: string): string {
  return readSource(relativePath)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");
}

/** Slices `readCode(relativePath)` down to one top-level `function`/`export function` declaration, by name. */
function readComponentCode(relativePath: string, name: string): string {
  const code = readCode(relativePath);
  const body = code
    .split(/^(?:export default |export )?function /m)
    .map((part) => `function ${part}`)
    .find((part) => part.startsWith(`function ${name}(`));
  expect(body, `${relativePath} should declare a top-level function ${name}`).toBeDefined();
  return body ?? "";
}

const ROUTE_WRAPPER_TSX = "../../src/app/dev/session-tree-lab.tsx";
const LAB_CONTENT_TSX = "../../src/dev/session-tree-lab.tsx";
const SHEET_TSX = "../../src/features/sessions/session-tree-sheet.tsx";

describe("session-tree-sheet.yaml anchors exist in source", () => {
  describe("the dev-lab deep link this flow opens", () => {
    it('app.config.ts registers the "picompanion" scheme the flow\'s openLink URL uses', () => {
      const appConfig = readCode("../../app.config.ts");
      expect(appConfig).toMatch(/scheme:\s*"picompanion"/);
    });

    it("the route wrapper's own file location (app/dev/session-tree-lab.tsx) is exactly what the flow's deep link path names", () => {
      const source = readCode(ROUTE_WRAPPER_TSX);
      expect(source).toMatch(/export default function DevSessionTreeLabRoute/);
    });

    it("gates the real lab behind __DEV__ so a release build's copy of this route never renders the lab", () => {
      const route = readComponentCode(ROUTE_WRAPPER_TSX, "DevSessionTreeLabRoute");
      expect(route).toMatch(/if \(!__DEV__\)/);
      expect(route).toMatch(/<Redirect href="\/" \/>/);
    });

    it("lazily imports the lab content from ../../dev/session-tree-lab, matching LAB_CONTENT_TSX's real path", () => {
      const code = readCode(ROUTE_WRAPPER_TSX);
      expect(code).toMatch(/lazy\(\(\) => import\("\.\.\/\.\.\/dev\/session-tree-lab"\)\)/);
    });
  });

  describe("session-tree-lab.tsx (content) mounts the real sheet against the exact fixture tree the flow taps/asserts", () => {
    it("declares testID session-tree-lab root and a session-tree-lab-status Text", () => {
      const body = readComponentCode(LAB_CONTENT_TSX, "SessionTreeLab");
      expect(body).toMatch(/testID="session-tree-lab"/);
      expect(body).toMatch(/testID="session-tree-lab-status"/);
    });

    it('the status Text\'s content is exactly `Last action: ${lastAction}` — "Last action: none" at mount, per useState("none")', () => {
      const body = readComponentCode(LAB_CONTENT_TSX, "SessionTreeLab");
      expect(body).toMatch(/useState\("none"\)/);
      expect(body).toMatch(/\{`Last action: \$\{lastAction\}`\}/);
    });

    it("builds the fixture tree with the real createRootSession/forkSession/cloneSession, never a hand-typed node", () => {
      const code = readCode(LAB_CONTENT_TSX);
      const fixtureFn = code
        .split("const FIXTURE_NODES")[0]
        .split("function buildFixtureTree()")[1];
      expect(fixtureFn, "session-tree-lab.tsx should declare buildFixtureTree()").toBeDefined();
      expect(fixtureFn).toMatch(/coreSessions\.createRootSession\(\{\s*agentId:\s*"lab-root"/);
      expect(fixtureFn).toMatch(/coreSessions\.forkSession\(root,\s*\{\s*agentId:\s*"lab-branch"/);
      expect(fixtureFn).toMatch(/coreSessions\.cloneSession\(root,\s*\{\s*agentId:\s*"lab-copy"/);
    });

    it('the root\'s own name is "Root session" — the exact provenance text the flow asserts ("cloned from Root session")', () => {
      const code = readCode(LAB_CONTENT_TSX);
      expect(code).toMatch(/agentId:\s*"lab-root",\s*name:\s*"Root session"/);
    });

    it("passes the real SessionTreeSheet a client prop gated by clientEnabled state, never always-on", () => {
      const body = readComponentCode(LAB_CONTENT_TSX, "SessionTreeLab");
      expect(body).toMatch(/client=\{client\}/);
      expect(body).toMatch(
        /const client = useMemo<SessionTreeClientPort \| undefined>\(\s*\n\s*\(\) => \(clientEnabled \? sessionTreeLabPort : undefined\)/,
      );
    });

    it("onSelectSession writes the exact tapped agentId into lastAction — the 'value arriving at a fake' proof", () => {
      const body = readComponentCode(LAB_CONTENT_TSX, "SessionTreeLab");
      expect(body).toMatch(/setLastAction\(`selected \$\{agentId\}`\)/);
    });

    it("onActionResult/onActionError both surface into lastAction, never swallowed", () => {
      const code = readCode(LAB_CONTENT_TSX);
      expect(code).toMatch(/setLastAction\(`\$\{kind\} succeeded: \$\{result\.agentId\}`\)/);
      expect(code).toMatch(/setLastAction\(`\$\{kind\} failed: \$\{message\}`\)/);
    });

    it("the lab's fake forkAgent/cloneAgent derive their returned agentId from the call's own argument, never a fixed literal", () => {
      const code = readCode(LAB_CONTENT_TSX);
      expect(code).toMatch(/agentId:\s*`\$\{agentId\}-forked`/);
      expect(code).toMatch(/agentId:\s*`\$\{agentId\}-cloned`/);
    });
  });

  describe("session-tree-sheet.tsx's own testId pattern matches the flow's ids", () => {
    const sheet = () => readComponentCode(SHEET_TSX, "SessionTreeSheet");

    it("row testId is `${testId}-item-${row.node.agentId}`, matching itemIdFor", () => {
      expect(sheet()).toMatch(/testID=\{`\$\{testId\}-item-\$\{row\.node\.agentId\}`\}/);
    });

    it("the actions block testId is `${testId}-actions`, matching actionsId", () => {
      expect(sheet()).toMatch(/testID=\{`\$\{testId\}-actions`\}/);
    });

    it("each action Button testId is `${testId}-action-${kind}`, matching actionIdFor", () => {
      expect(sheet()).toMatch(/testId=\{`\$\{testId\}-action-\$\{kind\}`\}/);
    });

    it("each unavailable caption testId is `${testId}-action-${kind}-unavailable`, matching actionUnavailableIdFor", () => {
      expect(sheet()).toMatch(/testID=\{`\$\{testId\}-action-\$\{kind\}-unavailable`\}/);
    });
  });
});

describe("session-tree-sheet.yaml itself, read from disk", () => {
  const SESSION_TREE_SHEET_YAML = "../../maestro/session-tree-sheet.yaml";
  const yamlText = readSource(SESSION_TREE_SHEET_YAML);
  const steps = parseMaestroSteps(yamlText);

  it("opens exactly SESSION_TREE_SHEET_FLOW.labDeepLink via openLink", () => {
    const opens = steps.filter((step) => step.kind === "openLink").map((step) => step.value);
    expect(opens).toEqual([SESSION_TREE_SHEET_FLOW.labDeepLink]);
  });

  it("asserts describeSessionTreeActionUnavailable('fork')'s exact real sentence, not a hand-typed stand-in", () => {
    const sentence = describeSessionTreeActionUnavailable("fork");
    const assertedTexts = steps
      .filter((step) => step.kind === "assertVisible" && step.text !== undefined)
      .map((step) => step.text as string);
    expect(assertedTexts).toContain(sentence);
  });

  it("asserts all three fixture rows visible before any action is taken", () => {
    const firstTap = steps.findIndex((step) => step.kind === "tapOn");
    expect(firstTap).toBeGreaterThan(-1);
    const before = steps.slice(0, firstTap);
    const assertedIds = before
      .filter((step) => step.kind === "assertVisible" && step.id !== undefined)
      .map((step) => step.id as string);
    expect(assertedIds).toContain(
      SESSION_TREE_SHEET_FLOW.itemIdFor(SESSION_TREE_SHEET_FLOW.rootAgentId),
    );
    expect(assertedIds).toContain(
      SESSION_TREE_SHEET_FLOW.itemIdFor(SESSION_TREE_SHEET_FLOW.branchAgentId),
    );
    expect(assertedIds).toContain(
      SESSION_TREE_SHEET_FLOW.itemIdFor(SESSION_TREE_SHEET_FLOW.copyAgentId),
    );
  });

  function stepsBetween(fromKind: string, fromId: string, count = 6): MaestroStep[] {
    const start = steps.findIndex((step) => step.kind === fromKind && step.id === fromId);
    expect(start, `expected a ${fromKind} step with id="${fromId}"`).toBeGreaterThan(-1);
    return steps.slice(start, start + count);
  }

  it("tapping the branch row is followed by the status reporting THAT exact agentId — a value arriving at a fake", () => {
    const after = stepsBetween(
      "tapOn",
      SESSION_TREE_SHEET_FLOW.itemIdFor(SESSION_TREE_SHEET_FLOW.branchAgentId),
    );
    const texts = after
      .filter((s) => s.kind === "assertVisible" && s.text !== undefined)
      .map((s) => s.text);
    expect(texts).toContain(`Last action: selected ${SESSION_TREE_SHEET_FLOW.branchAgentId}`);
  });

  it("asserts all three actions show their unavailable caption before the client is enabled", () => {
    const enableTap = steps.findIndex(
      (step) => step.kind === "tapOn" && step.id === SESSION_TREE_SHEET_FLOW.enableClientButton,
    );
    expect(enableTap).toBeGreaterThan(-1);
    const before = steps.slice(0, enableTap);
    const assertedIds = before
      .filter((step) => step.kind === "assertVisible" && step.id !== undefined)
      .map((step) => step.id as string);
    expect(assertedIds).toContain(SESSION_TREE_SHEET_FLOW.actionUnavailableIdFor("fork"));
    expect(assertedIds).toContain(SESSION_TREE_SHEET_FLOW.actionUnavailableIdFor("clone"));
    expect(assertedIds).toContain(SESSION_TREE_SHEET_FLOW.actionUnavailableIdFor("rename"));
  });

  it("enabling the client is followed by all three unavailable captions going invisible", () => {
    const after = stepsBetween("tapOn", SESSION_TREE_SHEET_FLOW.enableClientButton);
    const assertedNotVisibleIds = after
      .filter((s) => s.kind === "assertNotVisible" && s.id !== undefined)
      .map((s) => s.id);
    expect(assertedNotVisibleIds).toContain(SESSION_TREE_SHEET_FLOW.actionUnavailableIdFor("fork"));
    expect(assertedNotVisibleIds).toContain(
      SESSION_TREE_SHEET_FLOW.actionUnavailableIdFor("clone"),
    );
    expect(assertedNotVisibleIds).toContain(
      SESSION_TREE_SHEET_FLOW.actionUnavailableIdFor("rename"),
    );
  });

  it("tapping fork after enabling the client reports the fake's own derived result, not a fixed literal", () => {
    const after = stepsBetween("tapOn", SESSION_TREE_SHEET_FLOW.actionIdFor("fork"));
    const texts = after
      .filter((s) => s.kind === "assertVisible" && s.text !== undefined)
      .map((s) => s.text);
    expect(texts).toContain(
      `Last action: fork succeeded: ${SESSION_TREE_SHEET_FLOW.branchAgentId}-forked`,
    );
  });

  it("tapping clone after fork reports the clone's own derived result", () => {
    const after = stepsBetween("tapOn", SESSION_TREE_SHEET_FLOW.actionIdFor("clone"));
    const texts = after
      .filter((s) => s.kind === "assertVisible" && s.text !== undefined)
      .map((s) => s.text);
    expect(texts).toContain(
      `Last action: clone succeeded: ${SESSION_TREE_SHEET_FLOW.branchAgentId}-cloned`,
    );
  });

  it("mounts both Fork AND Clone action taps — never proves only one action", () => {
    const tappedIds = steps.filter((s) => s.kind === "tapOn").map((s) => s.id);
    expect(tappedIds).toContain(SESSION_TREE_SHEET_FLOW.actionIdFor("fork"));
    expect(tappedIds).toContain(SESSION_TREE_SHEET_FLOW.actionIdFor("clone"));
  });

  it("never names the production daemon's port, in any form including comments", () => {
    expect(
      yamlText.includes(String(PRODUCTION_DAEMON_PORT)),
      `session-tree-sheet.yaml must never name the production daemon port ${PRODUCTION_DAEMON_PORT}, ` +
        "in any form (this flow's own header already says it talks to no daemon at all)",
    ).toBe(false);
  });
});
