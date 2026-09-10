/**
 * Lives in `app-shell/`, not the Expo Router root — see
 * `./compact-shell-slots.ts`'s doc comment (T32S2) for why platform-
 * neutral logic that needs to stay plain-`vitest`-testable moves out of
 * the router tree.
 *
 * T79 (plan.md §9.2 "Files and terminal are dedicated routes rather than
 * squeezed beside chat"): before this task, `/h/:serverId/session/
 * :agentId/files/*` and `/h/:serverId/session/:agentId/terminal/
 * :terminalId` were real, already-shipped, already-tested routes with
 * **no in-app control anywhere that navigated to either** —
 * `../maestro/files-and-terminal.yaml`'s own header names this exact
 * gap ("KNOWN BLOCKER — reaching Files/Terminal needs a deep link, not a
 * tap") and asks "whichever task next edits `session/[agentId]/index.tsx`
 * for in-app navigation" to close it. This module is that navigation
 * logic, kept RN-free (no React/React Native/Expo import) so it stays
 * directly `vitest`-testable — the "RN-free `*-model.ts` with real
 * behavioural tests plus a thin `.tsx` view" split this repository's own
 * `CLAUDE.md` documents, since any test importing a module that reaches
 * `react-native` fails with a RolldownError here.
 *
 * `SessionNavRouter` is the minimal structural shape this module needs
 * out of Expo Router's real `useRouter()` (just `push`), so a test can
 * pass a plain fake `{ push: vi.fn() }` while `../app/h/[serverId]/
 * session/[agentId]/session-nav-actions.tsx`'s real mount passes the
 * genuine router unmodified — the same "narrow structural interface,
 * real object at the call site" convention `../features/sessions/
 * turn-running-signal.ts`'s `DaemonTurnStreamSource`/
 * `ConnectionStatusSource` already establish for this app.
 */
import { destinationHref } from "./top-level-destinations.js";

export interface SessionNavRouter {
  push: (href: string) => void;
}

/**
 * The terminal route (`/h/:serverId/session/:agentId/terminal/
 * :terminalId`) requires a `terminalId` even though this app has no
 * terminal-creation/selection UI yet — `features/terminal/terminal-
 * screen.tsx`'s own `TerminalScreen` fixes a single terminal at `slot`
 * `0` per session (see that route file's own "T32S12 mount" doc
 * comment), so there is exactly one terminal a session-level control
 * could ever mean. Reusing the session's own `agentId` as that
 * terminal's id keeps this deterministic and collision-free across
 * sessions (`sessionTerminal`'s `navigationIntentKey` already includes
 * `agentId` alongside `terminalId`, so this is never ambiguous) without
 * inventing a second identifier scheme here. Whichever task adds real
 * multi-terminal support owns choosing a real per-terminal id and
 * replacing this placeholder.
 */
export function buildSessionTerminalId(agentId: string): string {
  return agentId;
}

/**
 * Navigates back out to this host's session list (T351) — the session
 * app bar's `☰` mark. Same `destinationHref` conversion as the three
 * below; `sessionList` has been a registered navigation intent since
 * T24, so nothing new was needed in `frontend-core` for this one.
 */
export function pressSessionList(router: SessionNavRouter, serverId: string): void {
  router.push(destinationHref({ type: "sessionList", serverId }));
}

/**
 * Navigates to this session's Live screen (T350) — its running
 * subagents, workflow progress and context usage, and the way in to
 * Files and Terminal. Same `destinationHref` conversion as the two
 * below; `frontend-core`'s `navigation` module gained the matching
 * `sessionLive` intent in the same change, so this is not a hand-built
 * path.
 */
export function pressSessionLive(
  router: SessionNavRouter,
  serverId: string,
  agentId: string,
): void {
  router.push(destinationHref({ type: "sessionLive", serverId, agentId }));
}

/** Navigates to this session's file browser root. */
export function pressSessionFiles(
  router: SessionNavRouter,
  serverId: string,
  agentId: string,
): void {
  router.push(destinationHref({ type: "sessionFiles", serverId, agentId }));
}

/** Navigates to this session's one terminal — see `buildSessionTerminalId`'s doc comment for the id choice. */
export function pressSessionTerminal(
  router: SessionNavRouter,
  serverId: string,
  agentId: string,
): void {
  router.push(
    destinationHref({
      type: "sessionTerminal",
      serverId,
      agentId,
      terminalId: buildSessionTerminalId(agentId),
    }),
  );
}
