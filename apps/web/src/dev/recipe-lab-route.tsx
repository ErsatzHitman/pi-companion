import { createRoute, lazyRouteComponent, notFound } from "@tanstack/react-router";

import { rootRoute } from "../routes/root-route.js";

/**
 * `/dev/recipe-lab` — the T25B recipe lab (plan.md §10.4).
 *
 * Same dev-only exclusion mechanism as `component-lab-route.tsx`: in a
 * production build `import.meta.env.DEV` collapses to `false` at compile
 * time, so the branch that imports `./recipe-lab.js` (and everything it
 * pulls in — every recipe, the shared lab fixtures) is never bundled.
 */
export const recipeLabRoute = import.meta.env.DEV
  ? createRoute({
      getParentRoute: () => rootRoute,
      path: "/dev/recipe-lab",
      component: lazyRouteComponent(() => import("./recipe-lab.js"), "RecipeLab"),
    })
  : createRoute({
      getParentRoute: () => rootRoute,
      path: "/dev/recipe-lab",
      beforeLoad: () => {
        throw notFound();
      },
    });
