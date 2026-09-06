import { RouterProvider } from "@tanstack/react-router";

import { CoreProvider } from "./core-context.js";
import { DaemonClientProvider } from "./daemon-client-context.js";
import { router } from "./router.js";

/**
 * `DaemonClientProvider` (T53A1) is nested inside `CoreProvider` — it
 * reads `useCore()` for its platform adapters — and outside
 * `RouterProvider`, so every route can reach the live `DaemonClient` via
 * `useDaemonClientContext()`/`useDaemonClient()` without prop-drilling
 * through the route tree.
 */
export function App() {
  return (
    <CoreProvider>
      <DaemonClientProvider>
        <RouterProvider router={router} />
      </DaemonClientProvider>
    </CoreProvider>
  );
}
