/**
 * Ephemeral port reservation and cross-process publication for the
 * Playwright harness (T31A). `playwright.config.ts` reserves two
 * non-production ports once per run (daemon, static web preview) and
 * publishes them two ways so every later stage — the same-process
 * `global-setup.ts` and the separate worker processes each spec file
 * runs in — agree on the exact same numbers:
 *
 * 1. `process.env` (the normal Playwright idiom: workers are spawned
 *    *after* the config module finishes evaluating, so they inherit
 *    whatever `publishE2EPorts` set);
 * 2. a small JSON file under `e2e/.tmp/`, read as a fallback by
 *    anything that — for whatever reason — did not inherit the
 *    environment. Removed again in `global-setup.ts`'s teardown.
 *
 * Every port reserved here is checked against
 * `PRODUCTION_DAEMON_PORT` and re-rolled if it collides — the harness
 * must never bind the real daemon's port 6767 (plan.md §15.1).
 */
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const PRODUCTION_DAEMON_PORT = 6767;

export const DAEMON_PORT_ENV = "PICOMPANION_E2E_DAEMON_PORT";
export const WEB_PORT_ENV = "PICOMPANION_E2E_WEB_PORT";

export interface E2EPorts {
  daemonPort: number;
  webPort: number;
}

const infoFilePath = fileURLToPath(new URL("../.tmp/e2e-ports.json", import.meta.url));

async function reserveEphemeralPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close(() => reject(new Error("Failed to reserve an ephemeral port")));
        return;
      }
      const { port } = address;
      server.close(() => resolve(port));
    });
  });
}

async function reserveDistinctEphemeralPort(exclude: readonly number[]): Promise<number> {
  const forbidden = new Set([PRODUCTION_DAEMON_PORT, ...exclude]);
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const port = await reserveEphemeralPort();
    if (!forbidden.has(port)) {
      return port;
    }
  }
  throw new Error(
    `Could not reserve an ephemeral E2E port distinct from ${[...forbidden].join(", ")} after 20 attempts`,
  );
}

/**
 * Reserves the daemon and web-preview ports for one Playwright run.
 * Call exactly once, from `playwright.config.ts`; everything else
 * reads the result back through `publishE2EPorts`/`readPublishedE2EPorts`.
 */
export async function reserveE2EPorts(): Promise<E2EPorts> {
  const daemonPort = await reserveDistinctEphemeralPort([]);
  const webPort = await reserveDistinctEphemeralPort([daemonPort]);
  return { daemonPort, webPort };
}

export function publishE2EPorts(ports: E2EPorts): void {
  process.env[DAEMON_PORT_ENV] = String(ports.daemonPort);
  process.env[WEB_PORT_ENV] = String(ports.webPort);
}

export function clearPublishedE2EPorts(): void {
  delete process.env[DAEMON_PORT_ENV];
  delete process.env[WEB_PORT_ENV];
}

/** Worker-process fallback for `readPublishedE2EPorts`; see file header. */
export async function writeE2EInfoFile(
  ports: E2EPorts,
  extra: Record<string, unknown> = {},
): Promise<void> {
  await mkdir(path.dirname(infoFilePath), { recursive: true });
  await writeFile(infoFilePath, JSON.stringify({ ...ports, ...extra }, null, 2), "utf8");
}

export async function removeE2EInfoFile(): Promise<void> {
  await rm(infoFilePath, { force: true });
}

async function readE2EInfoFile(): Promise<E2EPorts> {
  const raw = await readFile(infoFilePath, "utf8");
  const parsed = JSON.parse(raw) as Partial<E2EPorts>;
  if (typeof parsed.daemonPort !== "number" || typeof parsed.webPort !== "number") {
    throw new Error(`Malformed E2E port info file at ${infoFilePath}`);
  }
  return { daemonPort: parsed.daemonPort, webPort: parsed.webPort };
}

/**
 * Reads the ports `playwright.config.ts` reserved: the `process.env`
 * path first (the normal case for both `global-setup.ts` and test
 * workers), falling back to the `.tmp` info file `global-setup.ts`
 * writes for defensiveness.
 */
export async function readPublishedE2EPorts(): Promise<E2EPorts> {
  const envDaemon = process.env[DAEMON_PORT_ENV];
  const envWeb = process.env[WEB_PORT_ENV];
  if (
    envDaemon &&
    envWeb &&
    Number.isFinite(Number(envDaemon)) &&
    Number.isFinite(Number(envWeb))
  ) {
    return { daemonPort: Number(envDaemon), webPort: Number(envWeb) };
  }
  return readE2EInfoFile();
}
