import { createRoute, redirect } from "@tanstack/react-router";

import { rootRoute } from "./root-route.js";

/** `/` has no content of its own; it hands off to `/connect` (plan.md §8.2). */
export const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  beforeLoad: () => {
    throw redirect({ to: "/connect" });
  },
});
