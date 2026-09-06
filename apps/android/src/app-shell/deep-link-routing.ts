/**
 * Lives in `apps/android/src/app-shell/`, not the Expo Router root — see
 * `./compact-shell-slots.ts`'s doc comment (T32S2). This module has no
 * default export, so — like every other module here — it would register
 * as a broken route if it sat directly under `apps/android/src/app/`.
 *
 * Deep link path -> destination matching — T32S2 ("Add deep links and
 * cold-start routing"), plan.md §6/§8.2.
 *
 * `apps/android/app.config.ts` registers the `picompanion://` scheme, and
 * every real screen already lives at a matching Expo Router file (one
 * per file under `app/h/[serverId]/` — see `matchDeepLinkPath`'s own
 * shape below) — Expo Router resolves a scheme URL against that file
 * tree on its own, no extra wiring needed for a *valid* link to reach
 * its screen. What this module owns is the piece Expo Router does not
 * give a name to: classifying a path so `../app/+not-found.tsx` can
 * render an explained fallback instead of a blank screen, and so tests
 * can prove the mapping without a device or emulator (on-device deep-
 * link and cold-start behavior itself is T37/T59's to prove — see
 * plan.md §14).
 *
 * Deliberately independent of `frontend-core`'s `navigation` module
 * (`./top-level-destinations.ts` already delegates `destinationHref` to
 * it for the *intent -> path* direction): that module's
 * `NavigationDestinationIntent` includes a `"host"` case (`/h/:serverId`,
 * no session/tab chosen yet) with no matching Expo Router file in this
 * tree — nothing under `app/h/[serverId]/` renders a bare host screen,
 * only `(tabs)/sessions`, `(tabs)/settings`, and `session/[agentId]/...`.
 * Matching against `frontend-core`'s intent vocabulary instead of this
 * app's *actual* registered routes would silently call `/h/abc123`
 * "known" when Expo Router itself would 404 on it. This module matches
 * the file tree as it actually exists.
 */

export type DeepLinkMatch =
  | { readonly kind: "connect" }
  | { readonly kind: "sessionList"; readonly serverId: string }
  | { readonly kind: "settings"; readonly serverId: string }
  | { readonly kind: "session"; readonly serverId: string; readonly agentId: string }
  | {
      readonly kind: "sessionFiles";
      readonly serverId: string;
      readonly agentId: string;
      readonly path: readonly string[];
    }
  | {
      readonly kind: "sessionTerminal";
      readonly serverId: string;
      readonly agentId: string;
      readonly terminalId: string;
    }
  | { readonly kind: "not-found"; readonly path: string };

/** Splits a pathname into non-empty, decoded segments. `"/h//sessions"` yields `["h", "sessions"]`, not `["h", "", "sessions"]` — an empty segment can never satisfy a required `:param`. */
function segments(pathname: string): string[] {
  return pathname
    .split("/")
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0)
    .map((segment) => {
      try {
        return decodeURIComponent(segment);
      } catch {
        return segment;
      }
    });
}

/**
 * Matches `pathname` against every file this app actually registers
 * under `h/[serverId]/` (plus the standalone `/connect` route), in the
 * same shape `navigationIntentToPath` renders them in
 * (`../app-shell/top-level-destinations.ts`'s doc comment) — but
 * verified against this file tree, not assumed from that shared intent
 * vocabulary (see this module's own doc comment for why that distinction
 * matters). Returns `{ kind: "not-found" }` for anything else, including
 * a syntactically plausible but incomplete path like `/h/abc123` (the
 * `"host"` intent with no matching route) or `/h//sessions` (an empty
 * `serverId`).
 */
export function matchDeepLinkPath(pathname: string): DeepLinkMatch {
  const parts = segments(pathname);

  if (parts.length === 1 && parts[0] === "connect") {
    return { kind: "connect" };
  }

  if (parts[0] === "h" && parts.length >= 2) {
    const serverId = parts[1];
    const rest = parts.slice(2);

    if (rest.length === 1 && rest[0] === "sessions") {
      return { kind: "sessionList", serverId };
    }
    if (rest.length === 1 && rest[0] === "settings") {
      return { kind: "settings", serverId };
    }
    if (rest.length >= 2 && rest[0] === "session") {
      const agentId = rest[1];
      const tail = rest.slice(2);

      if (tail.length === 0) {
        return { kind: "session", serverId, agentId };
      }
      if (tail[0] === "files") {
        return { kind: "sessionFiles", serverId, agentId, path: tail.slice(1) };
      }
      if (tail.length === 2 && tail[0] === "terminal") {
        return { kind: "sessionTerminal", serverId, agentId, terminalId: tail[1] };
      }
    }
  }

  return { kind: "not-found", path: pathname };
}
