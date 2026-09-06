/**
 * T39A dev-only session-tree-sheet lab (`component-lab.tsx`/
 * `recipe-lab.tsx`/`recovered-turn-lab.tsx`'s own dev-lab convention,
 * plan.md §10.3/§10.4). Only ever reached through `../app/dev/
 * session-tree-lab.tsx`'s `__DEV__` branch — see that file for why this
 * never ships in a production bundle.
 *
 * Renders the REAL `SessionTreeSheet`
 * (`../features/sessions/session-tree-sheet.tsx`, T39A) against a small,
 * real tree built with `@picompanion/frontend-core`'s own
 * `createRootSession`/`forkSession`/`cloneSession` (never a hand-typed
 * `SessionTreeNode`-shaped object) — closing the one proof a plain
 * `vitest` run cannot: `SessionTreeSheet` imports `react-native` and
 * cannot render under this workspace's vitest setup (that file's own doc
 * comment: the repo-wide limitation, proven 27+ times).
 * `../../maestro/session-tree-sheet.yaml` deep-links here and asserts:
 *
 *  - the real tree's rows and depths render;
 *  - tapping a row reports the exact tapped agentId to this lab's status
 *    text — "a value arriving at a fake", not an import resolving;
 *  - with no `client` prop, Fork/Clone/Rename show the model's real
 *    unavailable text;
 *  - tapping "Enable client" swaps in a fake `SessionTreeClientPort`
 *    (`sessionTreeLabPort` below) and Fork/Clone become available and,
 *    once tapped, their result reaches this lab's status text too.
 *
 * **What this does NOT prove** — there is no real `DaemonClient.forkAgent`/
 * `cloneAgent`/rename method to inject (T110, running in parallel this
 * same wave, is the task that would add one; see `session-tree-sheet-
 * model.ts`'s module doc for the full disclosed gap). This lab's
 * `sessionTreeLabPort` is a plain recording fake, not a real client —
 * proving the sheet's OWN wiring is correct, never that a real
 * `DaemonClient` is reachable from it today.
 */
import { useMemo, useState } from "react";
import { ScrollView, Text } from "react-native";

import { sessions as coreSessions } from "@picompanion/frontend-core";

import { Button } from "../ui/primitives";
import { useTheme } from "../ui/theme/theme-context";
import {
  SessionTreeSheet,
  type SessionTreeActionKind,
  type SessionTreeActionResult,
  type SessionTreeClientPort,
} from "../features/sessions";

/**
 * A fixed, real tree — never mutated once built. `root`/`branch`/`copy`
 * are the exact agentIds `session-tree-sheet.yaml` taps/asserts.
 */
function buildFixtureTree(): readonly coreSessions.SessionTreeNode[] {
  const root = coreSessions.createRootSession({
    agentId: "lab-root",
    name: "Root session",
    createdAt: 1,
  });
  const branch = coreSessions.forkSession(root, {
    agentId: "lab-branch",
    name: "Branch session",
    forkPoint: { messageId: "m1", index: 0 },
    createdAt: 2,
  });
  const copy = coreSessions.cloneSession(root, {
    agentId: "lab-copy",
    name: "Copy session",
    createdAt: 3,
  });
  return [root, branch, copy];
}

const FIXTURE_NODES = buildFixtureTree();

/**
 * A plain recording fake — never a real `DaemonClient` (T110's real
 * `forkAgent`/`cloneAgent`/rename method does not exist yet, see this
 * file's own module doc). Every call resolves immediately with a
 * synthesized result derived from the call's own arguments, so the lab's
 * status text can show the exact value that arrived here.
 */
const sessionTreeLabPort: SessionTreeClientPort = {
  async forkAgent(agentId, options) {
    return { agentId: `${agentId}-forked`, name: options?.name ?? null };
  },
  async cloneAgent(agentId, options) {
    return { agentId: `${agentId}-cloned`, name: options?.name ?? null };
  },
  async renameAgent(agentId, options) {
    return { agentId, name: options.name };
  },
};

export function SessionTreeLab() {
  const { theme } = useTheme();
  const [sheetOpen, setSheetOpen] = useState(true);
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [clientEnabled, setClientEnabled] = useState(false);
  const [lastAction, setLastAction] = useState("none");

  const client = useMemo<SessionTreeClientPort | undefined>(
    () => (clientEnabled ? sessionTreeLabPort : undefined),
    [clientEnabled],
  );

  function handleActionResult(kind: SessionTreeActionKind, result: SessionTreeActionResult): void {
    setLastAction(`${kind} succeeded: ${result.agentId}`);
  }

  function handleActionError(kind: SessionTreeActionKind, message: string): void {
    setLastAction(`${kind} failed: ${message}`);
  }

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: theme.colors.page }}
      contentContainerStyle={{ padding: theme.spacing[5], gap: theme.spacing[4] }}
      testID="session-tree-lab"
    >
      <Text
        style={{ color: theme.colors.ink, fontSize: theme.typography.variant.display.fontSize }}
      >
        Session tree lab
      </Text>
      <Text style={{ color: theme.colors["ink-2"] }} testID="session-tree-lab-status">
        {`Last action: ${lastAction}`}
      </Text>
      <Button
        kind="secondary"
        label={clientEnabled ? "Client enabled" : "Enable client"}
        disabled={clientEnabled}
        onPress={() => setClientEnabled(true)}
        testId="session-tree-lab-enable-client"
      />
      <Button
        kind="primary"
        label={sheetOpen ? "Sheet open" : "Open session tree"}
        disabled={sheetOpen}
        onPress={() => setSheetOpen(true)}
        testId="session-tree-lab-open"
      />
      <SessionTreeSheet
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        nodes={FIXTURE_NODES}
        selectedAgentId={selectedAgentId}
        onSelectSession={(agentId) => {
          setSelectedAgentId(agentId);
          setLastAction(`selected ${agentId}`);
        }}
        client={client}
        onActionResult={handleActionResult}
        onActionError={handleActionError}
        testId="session-tree-lab-sheet"
      />
    </ScrollView>
  );
}

export default SessionTreeLab;
