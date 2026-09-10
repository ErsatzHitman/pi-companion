import SessionFilesRoute from "./[...path]";

/**
 * `/h/:serverId/session/:agentId/files` — the files browser at its
 * workspace root — T331.
 *
 * `./[...path].tsx` is the files screen, and until T331 it was the ONLY
 * route file in this directory. Expo Router turns a `[...path]` segment
 * into a React Navigation `*path` wildcard, and that wildcard's matcher
 * (`configRegExp`/`formatRegexPattern` in `expo-router`'s forked
 * `getStateFromPath`) compiles to `(.*\/)` — one or MORE trailing
 * segments, never zero. So `/h/x/session/y/files` with nothing after
 * `files` matched no route at all and fell through to `+not-found.tsx`,
 * which is exactly what `files-and-terminal.yaml`'s `openLink:
 * "picompanion://h/e2e-host/session/e2e-files-agent/files"` hit in run
 * 34454596535 (`"/h/e2e-host/session/e2e-files-agent/files" isn't a
 * screen in Pi Companion`). The same path is what the app's own
 * `navigationIntentToPath({ type: "sessionFiles", path: [] })` builds for
 * the session screen's Files action, so this was a product defect, not
 * a flow one.
 *
 * This file is the documented Expo Router shape for "a catch-all plus its
 * own root": an `index` sibling that renders the very same component.
 * `useLocalSearchParams()` inside it sees `serverId`/`agentId` from the
 * parent segments and no `path`, which `SessionFilesRoute` already
 * defaults to `[]` — the root listing. Nothing is duplicated here: the
 * catch-all's own component is the default export, so the route-level
 * wiring `[...path].test.ts` pins (real client, real picker, real
 * sharing, real download origin) is the same code on both paths by
 * construction. (`export default` of the imported binding, rather than an
 * `export { default } from` re-export, because `router-root.test.ts`
 * proves every route file carries a literal `export default`.)
 */
export default SessionFilesRoute;
