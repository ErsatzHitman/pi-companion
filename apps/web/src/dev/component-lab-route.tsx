import { createRoute, lazyRouteComponent, notFound } from "@tanstack/react-router";

import { rootRoute } from "../routes/root-route.js";

/**
 * `/dev/component-lab` — the T25A component lab (plan.md §10.3).
 *
 * "The component lab is development-only and must not ship in a
 * production bundle": `import.meta.env.DEV` is a compile-time constant
 * Vite substitutes with a literal boolean, so a production build's
 * `import.meta.env.DEV ? A : B` collapses to `B` before Rollup traces
 * imports — `A`'s `import("./component-lab.js")` (and everything that
 * module pulls in: every primitive, the shared lab fixtures) is never
 * reached and never bundled. The dev branch also uses
 * `lazyRouteComponent` so, in dev, the lab is its own chunk rather than
 * inflating the main entry.
 */
export const componentLabRoute = import.meta.env.DEV
  ? createRoute({
      getParentRoute: () => rootRoute,
      path: "/dev/component-lab",
      component: lazyRouteComponent(() => import("./component-lab.js"), "ComponentLab"),
    })
  : createRoute({
      getParentRoute: () => rootRoute,
      path: "/dev/component-lab",
      beforeLoad: () => {
        throw notFound();
      },
    });
