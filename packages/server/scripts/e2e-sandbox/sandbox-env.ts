/**
 * T101 — port and home-directory isolation for the server e2e/integration
 * sandbox runner (`run-e2e-lane.ts`).
 *
 * Mirrors the pattern already established and unit-tested elsewhere in this
 * repository — `apps/android/e2e/harness/daemon-endpoint.ts` (bind port 0,
 * read back what the OS assigned, close it) and `apps/web/e2e/fixtures/ports.ts`
 * — rather than inventing a new one. Individual daemon-e2e test files already
 * do their own per-test ephemeral-port + temp-home allocation through
 * `src/server/test-utils/paseo-daemon.ts` (`listen: "127.0.0.1:0"`,
 * `mkdtemp(os.tmpdir())`); this module is defense in depth at the *process*
 * level, so an ambient environment variable a developer's shell happens to
 * carry (a real `PASEO_HOME`, a `PORT=6767`) can never leak into a sandboxed
 * lane invocation even before any individual test file runs.
 *
 * PRODUCTION_DAEMON_PORT (6767) is the owner's real, running daemon.
 * DEV_DAEMON_PORT (6768) is the shared local dev daemon. Neither may ever be
 * bound or connected to by this sandbox (plan.md §15.1, CLAUDE.md "Hard
 * rules"). This module is the one place that knows both numbers.
 */
import { mkdtemp } from "node:fs/promises";
import net, { type AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";

export const PRODUCTION_DAEMON_PORT = 6767;
export const DEV_DAEMON_PORT = 6768;

const FORBIDDEN_PORTS: readonly number[] = [PRODUCTION_DAEMON_PORT, DEV_DAEMON_PORT];

export function isForbiddenPort(port: number): boolean {
  return FORBIDDEN_PORTS.includes(port);
}

/**
 * Throws when `port` is one of the two ports this repository never binds or
 * connects to. `context` is folded into the message so a thrown refusal
 * always says *where* it was caught.
 */
export function assertNotForbiddenPort(port: number, context: string): void {
  if (isForbiddenPort(port)) {
    throw new Error(
      `Refusing to use port ${port} (${context}). Port ${PRODUCTION_DAEMON_PORT} is the ` +
        `owner's production daemon and ${DEV_DAEMON_PORT} is the shared dev daemon ` +
        "(plan.md §15.1) — the server e2e/integration sandbox may only use an " +
        "ephemeral port distinct from both.",
    );
  }
}

const MAX_ALLOCATION_ATTEMPTS = 20;

async function bindEphemeralPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close((closeError) => {
        if (closeError) {
          reject(closeError);
          return;
        }
        if (!address || typeof address === "string") {
          reject(new Error("Could not allocate an ephemeral port: no address returned"));
          return;
        }
        resolve((address as AddressInfo).port);
      });
    });
  });
}

/** Allocates a port, re-rolling the vanishingly unlikely case it lands on a forbidden port. */
export async function allocateSandboxPort(): Promise<number> {
  for (let attempt = 0; attempt < MAX_ALLOCATION_ATTEMPTS; attempt += 1) {
    const port = await bindEphemeralPort();
    if (!isForbiddenPort(port)) {
      return port;
    }
  }
  throw new Error(
    `Could not allocate an ephemeral sandbox port distinct from ${FORBIDDEN_PORTS.join(
      " or ",
    )} after ${MAX_ALLOCATION_ATTEMPTS} attempts`,
  );
}

/** A fresh temp directory root nothing else on the machine shares — never the real `~/.paseo`. */
export async function createIsolatedPaseoHomeRoot(): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), "picompanion-server-e2e-sandbox-"));
}

const FORBIDDEN_ENV_PORT_VARS = ["PORT", "PASEO_PORT", "DAEMON_PORT"] as const;

export interface SandboxEnvResult {
  env: NodeJS.ProcessEnv;
  paseoHomeRoot: string;
  paseoHome: string;
  port: number;
}

/**
 * Builds the environment a sandboxed e2e/integration vitest invocation
 * should run under:
 *
 * - a fresh, mkdtemp-created PASEO_HOME nothing else on the machine shares;
 * - a reserved ephemeral port distinct from both forbidden ports, published
 *   as PICOMPANION_E2E_SANDBOX_PORT for any test file that wants it;
 * - every ambient env var that names a forbidden port stripped, so a
 *   developer's real shell environment can never leak one in.
 *
 * `base` is injectable so tests can assert on the stripping behavior without
 * mutating `process.env`.
 */
export async function buildSandboxEnv(
  base: NodeJS.ProcessEnv = process.env,
): Promise<SandboxEnvResult> {
  const port = await allocateSandboxPort();
  assertNotForbiddenPort(port, "buildSandboxEnv allocated port");
  const paseoHomeRoot = await createIsolatedPaseoHomeRoot();
  const paseoHome = path.join(paseoHomeRoot, ".paseo");

  const env: NodeJS.ProcessEnv = { ...base };
  for (const key of FORBIDDEN_ENV_PORT_VARS) {
    const raw = env[key];
    if (raw === undefined) {
      continue;
    }
    const parsed = Number(raw);
    if (Number.isFinite(parsed) && isForbiddenPort(parsed)) {
      delete env[key];
    }
  }
  env.PASEO_HOME = paseoHome;
  env.PICOMPANION_E2E_SANDBOX_PORT = String(port);
  env.PICOMPANION_E2E_SANDBOX = "1";

  return { env, paseoHomeRoot, paseoHome, port };
}
