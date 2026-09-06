/**
 * Isolated daemon fixture for the Playwright harness (T31A).
 *
 * Starts one real `@picompanion/server` daemon (`createPaseoDaemon`,
 * `@picompanion/server`'s public export) per E2E run: an ephemeral,
 * caller-chosen port that is never `PRODUCTION_DAEMON_PORT`, a fresh
 * temp `PASEO_HOME` directory (never the real `~/.paseo`), no real
 * agent provider clients (`agentClients: {}` — the same minimal shape
 * `packages/server`'s own `createTestPaseoDaemon` test fixture uses,
 * see `packages/server/src/server/test-utils/paseo-daemon.ts`), and
 * the bundled web UI disabled (`preview-server.ts` serves a separate
 * static production build instead — plan.md §15.2's artifact, not the
 * daemon's own §15.2 bundling path).
 *
 * `stop()` always tears the daemon down and removes its temp
 * directories; callers must invoke it from a `finally`/`afterAll` so a
 * failing test can never leak a daemon process or a stale home
 * directory (see `global-setup.ts`).
 */
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import pino from "pino";
import { createPaseoDaemon } from "@picompanion/server";
import type { PaseoDaemonConfig } from "@picompanion/server";

import { FakePiAgentClient } from "./fake-pi-agent-client.js";
import { PRODUCTION_DAEMON_PORT } from "./ports.js";

const START_TIMEOUT_MS = 20_000;

export interface StartIsolatedDaemonOptions {
  /** The ephemeral port to bind; must not be `PRODUCTION_DAEMON_PORT`. */
  port: number;
  /** Origins allowed to reach this daemon over HTTP/WebSocket CORS — the preview server's origin. */
  corsAllowedOrigins: string[];
}

export interface IsolatedDaemon {
  port: number;
  paseoHome: string;
  baseUrl: string;
  /** `host:port`, ready to type into the `/connect` form's address field. */
  address: string;
  stop: () => Promise<void>;
}

export async function startIsolatedDaemon(
  options: StartIsolatedDaemonOptions,
): Promise<IsolatedDaemon> {
  if (options.port === PRODUCTION_DAEMON_PORT) {
    throw new Error(
      `Refusing to start the isolated E2E daemon on the production port ${PRODUCTION_DAEMON_PORT}.`,
    );
  }

  const homeRoot = await mkdtemp(path.join(os.tmpdir(), "picompanion-e2e-home-"));
  const paseoHome = path.join(homeRoot, ".paseo");
  await mkdir(paseoHome, { recursive: true });
  const staticDir = await mkdtemp(path.join(os.tmpdir(), "picompanion-e2e-static-"));

  const config: PaseoDaemonConfig = {
    listen: `127.0.0.1:${options.port}`,
    paseoHome,
    corsAllowedOrigins: options.corsAllowedOrigins,
    staticDir,
    mcpEnabled: false,
    mcpDebug: false,
    hostnames: true,
    // T31B: a deterministic fake `pi` provider (this product's only
    // provider id -- see `fake-pi-agent-client.ts`'s module doc for why
    // T31A's original `{}` here made every `createAgent` call reject
    // with "Provider pi is not configured", and why that file, not
    // `packages/server`'s own Paseo-era `claude`/`codex`/`opencode`
    // test-utils fake clients, is what belongs here). No real Pi binary
    // is ever spawned by this isolated daemon.
    agentClients: { pi: new FakePiAgentClient() },
    agentStoragePath: path.join(paseoHome, "agents"),
    relayEnabled: false,
    webUi: { enabled: false, distDir: null },
    desktopManaged: false,
    isDev: true,
  };

  const logger = pino({ level: "silent" });
  const daemon = await createPaseoDaemon(config, logger);

  const cleanupTempDirs = async (): Promise<void> => {
    await Promise.all([
      rm(homeRoot, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }),
      rm(staticDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }),
    ]);
  };

  try {
    await startWithTimeout(daemon);
  } catch (error) {
    await daemon.stop().catch(() => undefined);
    await cleanupTempDirs();
    throw error;
  }

  const listenTarget = daemon.getListenTarget();
  if (!listenTarget || listenTarget.type !== "tcp") {
    await daemon.stop().catch(() => undefined);
    await cleanupTempDirs();
    throw new Error("Isolated E2E daemon did not bind a TCP listen target");
  }
  if (listenTarget.port === PRODUCTION_DAEMON_PORT) {
    await daemon.stop().catch(() => undefined);
    await cleanupTempDirs();
    throw new Error("Isolated E2E daemon bound the production port; refusing to continue");
  }

  let stopped = false;
  const stop = async (): Promise<void> => {
    if (stopped) return;
    stopped = true;
    await daemon.stop().catch(() => undefined);
    await cleanupTempDirs();
  };

  return {
    port: listenTarget.port,
    paseoHome,
    baseUrl: `http://127.0.0.1:${listenTarget.port}`,
    address: `127.0.0.1:${listenTarget.port}`,
    stop,
  };
}

async function startWithTimeout(daemon: { start: () => Promise<void> }): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Timed out starting the isolated E2E daemon after ${START_TIMEOUT_MS}ms`));
    }, START_TIMEOUT_MS);
    daemon.start().then(
      () => {
        clearTimeout(timer);
        resolve();
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}
