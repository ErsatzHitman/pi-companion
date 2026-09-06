import { createRoute, lazyRouteComponent } from "@tanstack/react-router";

import { rootRoute } from "./root-route.js";

export const hostSessionFilesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/h/$serverId/session/$agentId/files/$",
  component: lazyRouteComponent(
    () => import("./screens/host-session-files-screen.js"),
    "HostSessionFilesScreen",
  ),
});
