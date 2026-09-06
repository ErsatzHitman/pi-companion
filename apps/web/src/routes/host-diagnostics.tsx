import { createRoute, lazyRouteComponent } from "@tanstack/react-router";

import { rootRoute } from "./root-route.js";

/**
 * `/h/:serverId/diagnostics` (T41B1, plan.md §13 Phase 7). Not part of
 * plan.md §8.2's original route list (written before Phase 7 existed);
 * placed alongside `/h/:serverId/settings` (`host-settings.tsx`), the
 * closest existing precedent for a per-host operational screen.
 */
export const hostDiagnosticsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/h/$serverId/diagnostics",
  component: lazyRouteComponent(
    () => import("./screens/host-diagnostics-screen.js"),
    "HostDiagnosticsScreen",
  ),
});
