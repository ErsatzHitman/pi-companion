import { createRoute, lazyRouteComponent } from "@tanstack/react-router";

import { rootRoute } from "./root-route.js";

export const hostRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/h/$serverId",
  component: lazyRouteComponent(() => import("./screens/host-screen.js"), "HostScreen"),
});
