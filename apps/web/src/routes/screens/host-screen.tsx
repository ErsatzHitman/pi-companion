import { getRouteApi } from "@tanstack/react-router";

import { useDaemonClientContext } from "../../app/daemon-client-context.js";
import { RoutePlaceholder } from "../../ui/route-placeholder.js";

const routeApi = getRouteApi("/h/$serverId");

/**
 * `/h/:serverId` screen body (T27S2 placeholder). `getRouteApi` reaches
 * the route by its string id instead of importing the route object from
 * `host.tsx`, so this module has no value-level dependency back on its
 * own lazy boundary.
 *
 * No real host-dashboard feature exists in this repository yet to hand
 * the live client to (this route redirects/serves as a landing stub;
 * `/h/:serverId/sessions` is the real screen). This task's
 * `useDaemonClientContext()` (T53A1) read surfaces the live connection
 * state here rather than inventing dashboard functionality outside this
 * task's "assembly, not new features" scope.
 */
export function HostScreen() {
  const { serverId } = routeApi.useParams();
  const { info } = useDaemonClientContext();
  return <RoutePlaceholder title="Host" params={{ serverId, connection: info.status }} />;
}
