import { createRoute, lazyRouteComponent } from "@tanstack/react-router";

import { rootRoute } from "./root-route.js";

export const hostSettingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/h/$serverId/settings",
  component: lazyRouteComponent(
    () => import("./screens/host-settings-screen.js"),
    "HostSettingsScreen",
  ),
});
