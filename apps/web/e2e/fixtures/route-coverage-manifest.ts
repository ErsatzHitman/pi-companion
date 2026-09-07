/**
 * T44A2 — the curated list `scripts/ci/guard-axe-route-coverage.mjs`
 * checks against the REAL route list it derives from
 * `apps/web/src/routes/route-tree.ts` (plan.md §10.5: "Web runs axe
 * checks", acceptance criterion "Web axe gates pass across every
 * route").
 *
 * This file is the one place a human decision gets recorded about a
 * route: either it is swept by a real-browser axe check in
 * `accessibility.spec.ts` (`swept: true`), or it is deliberately
 * excluded with a written `reason` (`swept: false`). Two independent,
 * both-required checks keep this list honest:
 *
 * 1. `scripts/ci/guard-axe-route-coverage.mjs` derives the real route
 *    list straight from `apps/web/src/routes/route-tree.ts` (following
 *    its imports and reading each route file's own `path:` literal —
 *    never a hand-typed copy) and fails, in BOTH directions, the moment
 *    this list drifts from it: a route added to `route-tree.ts` with no
 *    entry here fails the guard (the drift this task exists to
 *    prevent), and so does an entry here naming a route that no longer
 *    exists in `route-tree.ts` (renamed or removed), so a stale
 *    exemption can never silently widen. See that guard's own doc
 *    comment for the exact mechanism and its proof.
 * 2. `as const satisfies` below (not a plain type annotation) keeps
 *    every `routePath` literal's own string type instead of widening to
 *    `string`. `accessibility.spec.ts` derives a `SweptRoutePath` union
 *    from this array and uses it to key its per-route sweep table as a
 *    `Record<SweptRoutePath, ...>` — a `Record` type rejects both a
 *    missing key and an excess one — so the TypeScript compiler itself
 *    (this repo's mandatory `npm run typecheck` gate) refuses to build
 *    the moment this manifest and the spec's actual sweep table name a
 *    different set of swept routes.
 *
 * Check (1) catches "the manifest and the real route tree disagree";
 * check (2) catches "the manifest and the spec's actual test table
 * disagree". Neither can compensate for a hole in the other, which is
 * why both exist.
 *
 * `routePath` is the literal `path:` string from that route's own
 * `createRoute({...})` call (e.g. `"/h/$serverId/session/$agentId"`) —
 * the TanStack Router PATTERN, not a resolved URL. Order here has no
 * meaning; both checks above compare as sets.
 */
export interface RouteCoverageEntry {
  readonly routePath: string;
  readonly swept: boolean;
  /** Required whenever `swept` is `false` — enforced by the guard, not by this type. */
  readonly reason?: string;
}

export const ROUTE_COVERAGE = [
  // `/` never renders content of its own (`index.tsx`'s `beforeLoad`
  // throws a redirect to `/connect` before any component mounts — the
  // same fact `shell.test.tsx`'s own `ROUTE_HEADINGS` doc comment
  // records). `accessibility.spec.ts`'s first case navigates here,
  // confirms the redirect actually lands on `/connect`, and axe-checks
  // the page that redirect produces — real coverage of this route's one
  // observable behaviour, not a placeholder.
  { routePath: "/", swept: true },
  { routePath: "/connect", swept: true },
  { routePath: "/h/$serverId", swept: true },
  { routePath: "/h/$serverId/sessions", swept: true },
  { routePath: "/h/$serverId/session/$agentId", swept: true },
  { routePath: "/h/$serverId/session/$agentId/files/$", swept: true },
  { routePath: "/h/$serverId/session/$agentId/terminal/$terminalId", swept: true },
  { routePath: "/h/$serverId/settings", swept: true },
  { routePath: "/h/$serverId/diagnostics", swept: true },
  {
    routePath: "/dev/component-lab",
    swept: false,
    reason:
      "T25A dev-only component lab (dev/component-lab-route.tsx): in a production build " +
      "import.meta.env.DEV collapses to false at compile time and this route's beforeLoad " +
      "throws notFound() instead of ever rendering a component. This harness's Playwright " +
      "run serves the production bundle (fixtures/preview-server.ts runs " +
      "scripts/build-daemon-web-ui.mjs, the same production build every packaging path " +
      "uses), so this route is not reachable to sweep here at all, in any build this suite " +
      "ever runs against.",
  },
  {
    routePath: "/dev/recipe-lab",
    swept: false,
    reason:
      "T25B dev-only recipe lab (dev/recipe-lab-route.tsx): identical production-bundle " +
      "exclusion as /dev/component-lab above, for the same reason.",
  },
] as const satisfies readonly RouteCoverageEntry[];
