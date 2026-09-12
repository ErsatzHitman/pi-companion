/**
 * The route segment the in-app "new terminal" link uses
 * (`/h/:serverId/session/:agentId/terminal/new`). Kept as its own tiny
 * module, separate from `terminal-route.tsx`/`terminal-view.tsx`, so
 * `ui/shell.tsx` can import just this constant without pulling the
 * xterm-backed terminal feature (or `@picompanion/frontend-core`'s
 * `terminal` domain) into the app shell's bundle chunk.
 *
 * The terminal screen treats any `:terminalId` that does not match a
 * terminal the daemon lists for the session's `cwd` as a request to
 * create one — so this segment is a stable, human-readable deep link
 * meaning "open a terminal", not a real daemon id.
 */
export const NEW_TERMINAL_ROUTE_SEGMENT = "new";
