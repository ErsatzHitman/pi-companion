import { createRoute, lazyRouteComponent } from "@tanstack/react-router";

import { rootRoute } from "./root-route.js";

export const hostSessionTerminalRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/h/$serverId/session/$agentId/terminal/$terminalId",
  component: lazyRouteComponent(
    () => import("./screens/host-session-terminal-screen.js"),
    "HostSessionTerminalScreen",
  ),
});
