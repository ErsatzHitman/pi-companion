import { createRoute, lazyRouteComponent } from "@tanstack/react-router";

import { rootRoute } from "./root-route.js";

export const hostSessionRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/h/$serverId/session/$agentId",
  component: lazyRouteComponent(
    () => import("./screens/host-session-screen.js"),
    "HostSessionScreen",
  ),
});
