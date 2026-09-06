/**
 * Pi session discovery/import controller state (T27B5, plan.md
 * §7.4/§8.3/§12.3).
 *
 * Mirrors `use-create-session.ts`'s shape (a controller hook consumed
 * by a thin presentational component), but for the discover-then-
 * import flow instead of the create flow:
 *
 * - `discover()` fetches the host's not-yet-imported Pi sessions
 *   (including ones started from a bare terminal, outside the daemon)
 *   into their own list, kept separate from `SessionListState`'s
 *   already-imported sessions so the two never merge into one
 *   ambiguous list (T27B5's "discovered sessions are listed distinctly
 *   from imported ones" acceptance criterion).
 * - `importDiscovered(session)` imports one, removes it from the
 *   discovered list, and reports the resulting `SessionSummary` via
 *   `onImported` so the screen that owns `SessionListState` can insert
 *   it the same way `useCreateSession`'s `onCreated` does.
 *
 * Import is idempotent by construction (T27B5's third acceptance
 * criterion): `importedHandleIds` remembers every `providerHandleId`
 * this controller has ever successfully imported (or been told by the
 * daemon is already imported), and `importDiscovered` is a no-op for
 * both an in-flight handle and an already-imported one — calling it a
 * second time (before or after the first call settles) never sends a
 * second `import_agent_request` and never inserts a duplicate session.
 */
import { useCallback, useRef, useState } from "react";

import {
  explainDiscoveredSessionsError,
  isAlreadyImportedError,
  type DiscoveredSession,
  type DiscoveredSessionsClient,
} from "./discovered-sessions-client.js";
import type { SessionSummary } from "./types.js";

export type DiscoverSessionsPhase = "idle" | "loading" | "error";

export interface UseDiscoveredSessionsOptions {
  client: DiscoveredSessionsClient;
  /** Restricts discovery to a single working directory, matching `ListDiscoveredSessionsInput.cwd`. */
  cwd?: string;
  /** Called with the newly imported session once the daemon acknowledges it. */
  onImported?: (session: SessionSummary, discovered: DiscoveredSession) => void;
}

export interface DiscoveredSessionsController {
  phase: DiscoverSessionsPhase;
  /** Discovered-but-not-yet-imported sessions, most recently active first. */
  sessions: readonly DiscoveredSession[];
  /** A friendly explanation of the last failed `discover()` call, if any. */
  errorMessage: string | null;
  /** The `providerHandleId` currently being imported, if any (drives a row's "Importing…" state). */
  importingHandleId: string | null;
  discover: () => void;
  importDiscovered: (session: DiscoveredSession) => void;
}

export function useDiscoveredSessions(
  options: UseDiscoveredSessionsOptions,
): DiscoveredSessionsController {
  const { client, cwd, onImported } = options;

  const [phase, setPhase] = useState<DiscoverSessionsPhase>("idle");
  const [sessions, setSessions] = useState<readonly DiscoveredSession[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [importingHandleId, setImportingHandleId] = useState<string | null>(null);

  // Plain refs, not state, drive the idempotency guards below so a
  // synchronous double-call (two clicks before the first render
  // commits) is caught even though `setState` updates are batched.
  const importingRef = useRef<string | null>(null);
  const importedHandleIdsRef = useRef<Set<string>>(new Set());
  const discoveringRef = useRef(false);

  const discover = useCallback((): void => {
    if (discoveringRef.current) return; // one discovery request in flight at a time
    discoveringRef.current = true;
    setPhase("loading");
    setErrorMessage(null);

    client.listDiscoveredSessions(cwd ? { cwd } : undefined).then(
      (entries) => {
        discoveringRef.current = false;
        // Defense in depth: the daemon already excludes anything with a
        // live agent record, but never re-offer a handle this
        // controller itself has already turned into a session.
        setSessions(
          entries.filter((entry) => !importedHandleIdsRef.current.has(entry.providerHandleId)),
        );
        setPhase("idle");
      },
      (error: unknown) => {
        discoveringRef.current = false;
        const message = error instanceof Error ? error.message : String(error);
        setErrorMessage(explainDiscoveredSessionsError(message).description);
        setPhase("error");
      },
    );
  }, [client, cwd]);

  const importDiscovered = useCallback(
    (session: DiscoveredSession): void => {
      const handle = session.providerHandleId;
      // Idempotent no-op: already importing this handle, or already
      // imported it (this controller's own record of success, not a
      // fresh daemon round-trip) — never send a second request.
      if (importingRef.current !== null) return;
      if (importedHandleIdsRef.current.has(handle)) return;

      importingRef.current = handle;
      setImportingHandleId(handle);

      client
        .importSession({
          providerId: session.providerId,
          providerHandleId: handle,
          cwd: session.cwd,
        })
        .then(
          (imported) => {
            importingRef.current = null;
            importedHandleIdsRef.current.add(handle);
            setImportingHandleId(null);
            setSessions((current) => current.filter((entry) => entry.providerHandleId !== handle));
            onImported?.(imported, session);
          },
          (error: unknown) => {
            importingRef.current = null;
            setImportingHandleId(null);
            const message = error instanceof Error ? error.message : String(error);
            if (isAlreadyImportedError(message)) {
              // The daemon already has a live agent for this handle
              // (imported by this client on a prior call, or by another
              // client entirely): treat it as already done, not a
              // failure, and stop offering it as discoverable.
              importedHandleIdsRef.current.add(handle);
              setSessions((current) =>
                current.filter((entry) => entry.providerHandleId !== handle),
              );
              return;
            }
            setErrorMessage(explainDiscoveredSessionsError(message).description);
          },
        );
    },
    [client, onImported],
  );

  return { phase, sessions, errorMessage, importingHandleId, discover, importDiscovered };
}
