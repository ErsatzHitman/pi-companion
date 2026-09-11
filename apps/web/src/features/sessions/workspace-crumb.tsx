/**
 * The header's workspace crumb (working-directory basename + branch),
 * plan.md §8.3. Sourced entirely from real values: the selected
 * session's own `cwd` (`AgentSnapshotPayload.cwd`, via `toSessionSummary`)
 * and the daemon's `checkout_status_response.currentBranch` for that
 * `cwd` — never from a mocked branch name.
 *
 * The design reference also shows a short HEAD-sha chip next to the
 * crumb. This component deliberately does NOT render one, and that is a
 * measured decision rather than an omission: no lightweight wire
 * response carries a HEAD sha (`checkout_status_response` has
 * `currentBranch`/`aheadBehind` but no commit id — verified against
 * `CheckoutStatusResponseSchema` in `packages/protocol/src/messages.ts`).
 * The only daemon surface that reports one is
 * `checkout.commits.list.request`, whose handler
 * (`packages/server/src/server/session/checkout/checkout-session.ts`'s
 * `handleCommitsListRequest`) calls `listCheckoutCommits({ cwd })` with no
 * `maxCount`, i.e. it returns the whole commit history with per-file
 * stats — unfit to issue from a persistent header on every session open
 * purely for a chip. Per the task's own rule, the chip is omitted rather
 * than filled with an invented value.
 *
 * Kept as a narrow structural interface for the same reason as
 * `use-session-snapshot.ts`: a real `DaemonClient` satisfies
 * `WorkspaceGitSource` as-is.
 */
import { useEffect, useState } from "react";

import type { SessionSnapshotSource } from "./use-session-snapshot.js";
import { useSessionSnapshot } from "./use-session-snapshot.js";

import "./workspace-crumb.css";

export interface WorkspaceGitSource {
  getCheckoutStatus(cwd: string): Promise<{ currentBranch: string | null }>;
}

/**
 * The two read-only client shapes the header's session chrome needs. The
 * caller adapts a real `DaemonClient` once (see `root-route.tsx`) because
 * its generic `on` overload set cannot satisfy `SessionSnapshotSource`
 * structurally.
 */
export type SessionChromeClient = SessionSnapshotSource & WorkspaceGitSource;

/** The last path segment of a POSIX or Windows working directory. */
export function workspaceBasename(cwd: string): string {
  const trimmed = cwd.replace(/[\\/]+$/, "");
  const separatorIndex = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
  return separatorIndex === -1 ? trimmed : trimmed.slice(separatorIndex + 1);
}

export interface WorkspaceLocation {
  /** The working directory's basename, e.g. `pi-companion`. */
  name: string;
  /** The daemon-reported current branch, or `null` when it reports none. */
  branch: string | null;
}

/**
 * Resolves the crumb's two values for one `cwd`. The branch is read from
 * the daemon once per `cwd`; a failed read leaves `branch: null` (the
 * crumb then shows only the directory name) rather than retrying in a
 * loop or guessing a branch name.
 */
export function useWorkspaceLocation(
  cwd: string | null,
  client: WorkspaceGitSource | null,
): WorkspaceLocation | null {
  const [branch, setBranch] = useState<string | null>(null);

  useEffect(() => {
    setBranch(null);
    if (!cwd || !client) return undefined;

    let cancelled = false;
    client
      .getCheckoutStatus(cwd)
      .then((status) => {
        if (cancelled) return;
        setBranch(status.currentBranch);
      })
      .catch(() => {
        // No branch part then; the directory name is still real.
      });

    return () => {
      cancelled = true;
    };
  }, [cwd, client]);

  if (!cwd) return null;
  const name = workspaceBasename(cwd);
  if (!name) return null;
  return { name, branch };
}

export interface WorkspaceCrumbProps {
  /** The selected session's working directory, or `null` with no session open. */
  cwd: string | null;
  client: WorkspaceGitSource | null;
}

/** The bar's `<nav aria-label="Workspace">` crumb cluster; renders nothing without a real `cwd`. */
export function WorkspaceCrumb({ cwd, client }: WorkspaceCrumbProps) {
  const location = useWorkspaceLocation(cwd, client);
  if (!location) return null;

  return (
    <nav className="pc-workspace-crumb" aria-label="Workspace">
      <span className="pc-workspace-crumb__name">{location.name}</span>
      {location.branch ? (
        <>
          <span className="pc-workspace-crumb__separator" aria-hidden="true">
            /
          </span>
          <span className="pc-workspace-crumb__branch">{location.branch}</span>
        </>
      ) : null}
    </nav>
  );
}

export interface SessionWorkspaceCrumbProps {
  agentId: string | null;
  client: SessionChromeClient | null;
}

/**
 * The header's crumb, fed by its own `useSessionSnapshot` read rather
 * than a value threaded down from the root route: an `agent_update`
 * re-renders this small component only, instead of the whole routed
 * tree (the transcript included) on every metadata push.
 */
export function SessionWorkspaceCrumb({ agentId, client }: SessionWorkspaceCrumbProps) {
  const session = useSessionSnapshot(client, agentId);
  return <WorkspaceCrumb cwd={session?.cwd ?? null} client={client} />;
}
