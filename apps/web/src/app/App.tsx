import { RouterProvider } from "@tanstack/react-router";

import { AppErrorBoundary } from "./app-error-boundary.js";
import { CoreProvider } from "./core-context.js";
import { DaemonClientProvider } from "./daemon-client-context.js";
import { router } from "./router.js";

/**
 * `DaemonClientProvider` (T53A1) is nested inside `CoreProvider` — it
 * reads `useCore()` for its platform adapters — and outside
 * `RouterProvider`, so every route can reach the live `DaemonClient` via
 * `useDaemonClientContext()`/`useDaemonClient()` without prop-drilling
 * through the route tree.
 *
 * `AppErrorBoundary` (FIX-W3, `app-error-boundary.tsx`) wraps
 * `RouterProvider` so an uncaught render error anywhere in the routed app
 * yields a recoverable in-app error state instead of blanking the page —
 * it sits *inside* `CoreProvider`/`DaemonClientProvider` (rather than
 * around them) because it reads the live platform `Logger` off
 * `useCore()` to report what it catches, the same live adapter every
 * other feature in this app already reaches through that provider.
 */
export function App() {
  return (
    <CoreProvider>
      <DaemonClientProvider>
        <AppErrorBoundary>
          <RouterProvider router={router} />
        </AppErrorBoundary>
      </DaemonClientProvider>
    </CoreProvider>
  );
}
