import { componentLabRoute } from "../dev/component-lab-route.js";
import { recipeLabRoute } from "../dev/recipe-lab-route.js";
import { connectRoute } from "./connect.js";
import { hostDiagnosticsRoute } from "./host-diagnostics.js";
import { hostSessionFilesRoute } from "./host-session-files.js";
import { hostSessionTerminalRoute } from "./host-session-terminal.js";
import { hostSessionRoute } from "./host-session.js";
import { hostSessionsRoute } from "./host-sessions.js";
import { hostSettingsRoute } from "./host-settings.js";
import { hostRoute } from "./host.js";
import { indexRoute } from "./index.js";
import { rootRoute } from "./root-route.js";

/**
 * The full §8.2 route set, assembled in code rather than generated from
 * the filesystem. Route order does not affect matching (TanStack Router
 * scores by specificity), so this list mirrors §8.2's declared order.
 */
export const routeTree = rootRoute.addChildren([
  indexRoute,
  connectRoute,
  hostRoute,
  hostSessionsRoute,
  hostSessionRoute,
  hostSessionFilesRoute,
  hostSessionTerminalRoute,
  hostSettingsRoute,
  hostDiagnosticsRoute,
  // T25A: dev-only component lab. `componentLabRoute` itself resolves to
  // a 404-throwing route in production builds; see
  // `../dev/component-lab-route.js` for why its dev branch never ships.
  componentLabRoute,
  // T25B: dev-only recipe lab, same production-bundle exclusion as above;
  // see `../dev/recipe-lab-route.js`.
  recipeLabRoute,
]);
