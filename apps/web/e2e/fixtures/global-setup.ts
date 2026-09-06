/**
 * Playwright global setup/teardown (T31A).
 *
 * Playwright guarantees this module's default export runs exactly
 * once per invocation, in the orchestrating process — unlike
 * `playwright.config.ts`, which gets reloaded once per worker (and
 * again on a retry). That makes this the one place that may reserve
 * the run's two ephemeral, non-production ports (`reserveE2EPorts`)
 * and actually own the daemon and the web preview server; every
 * spec/fixture reads the result back afterwards through
 * `readPublishedE2EPorts` (env vars this function publishes, with the
 * `.tmp` info file it also writes as a fallback — see `ports.ts`'s
 * file header).
 *
 * Builds and serves the production web bundle (`preview-server.ts`)
 * and starts one isolated daemon (`daemon.ts`) bound to the *other*
 * reserved port, wired to accept the preview server's origin over
 * CORS.
 *
 * The returned teardown function always stops both, so a crashed or
 * failed run cannot leave the daemon or the preview server listening
 * — matching the "always tear it down" rule this harness must not
 * violate.
 */
import type { FullConfig } from "@playwright/test";

import { startIsolatedDaemon } from "./daemon.js";
import { buildAndServeWebApp } from "./preview-server.js";
import {
  clearPublishedE2EPorts,
  publishE2EPorts,
  removeE2EInfoFile,
  reserveE2EPorts,
  writeE2EInfoFile,
} from "./ports.js";

export default async function globalSetup(_config: FullConfig): Promise<() => Promise<void>> {
  const ports = await reserveE2EPorts();
  publishE2EPorts(ports);
  // Worker-process fallback (see ports.ts); harmless if unused.
  await writeE2EInfoFile(ports);

  const webApp = await buildAndServeWebApp({ port: ports.webPort });

  let daemon: Awaited<ReturnType<typeof startIsolatedDaemon>>;
  try {
    daemon = await startIsolatedDaemon({
      port: ports.daemonPort,
      corsAllowedOrigins: [webApp.baseUrl],
    });
  } catch (error) {
    await webApp.stop().catch(() => undefined);
    throw error;
  }

  await writeE2EInfoFile(ports, { paseoHome: daemon.paseoHome });

  return async function globalTeardown(): Promise<void> {
    try {
      await webApp.stop().catch(() => undefined);
    } finally {
      try {
        await daemon.stop().catch(() => undefined);
      } finally {
        clearPublishedE2EPorts();
        await removeE2EInfoFile().catch(() => undefined);
      }
    }
  };
}
