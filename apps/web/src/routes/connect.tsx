import { createRoute, lazyRouteComponent } from "@tanstack/react-router";

import { rootRoute } from "./root-route.js";

export const connectRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/connect",
  component: lazyRouteComponent(() => import("./screens/connect-screen.js"), "ConnectScreen"),
});
