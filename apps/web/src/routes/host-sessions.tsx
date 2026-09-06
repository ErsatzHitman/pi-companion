import { createRoute, lazyRouteComponent } from "@tanstack/react-router";

import { rootRoute } from "./root-route.js";

export const hostSessionsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/h/$serverId/sessions",
  component: lazyRouteComponent(
    () => import("./screens/host-sessions-screen.js"),
    "HostSessionsScreen",
  ),
});
