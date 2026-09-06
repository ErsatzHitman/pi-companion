/**
 * T37D — resolves one isolated daemon endpoint per flow run: an
 * ephemeral, never-6767 port and a fresh temp `PASEO_HOME` directory
 * nothing else on the machine shares.
 *
 * The port-allocation trick (bind a server to port 0, read back what the
 * OS assigned, close it) mirrors `apps/web/e2e/fixtures/ports.ts`'s
 * `reserveEphemeralPort` — that fixture already establishes this pattern
 * as the accepted way to pick a free, non-production port in this
 * repository's E2E harnesses. It binds and immediately releases a
 * loopback socket to *ask the OS for a free port number*; it never
 * connects to another process, so it never touches the production daemon
 * on 6767 or the shared dev daemon on 6768.
 *
 * Two calls to `resolveIsolatedDaemonEndpoint` never share a port or a
 * home directory (`os.tmpdir()` + `mkdtemp`'s random suffix), which is
 * what makes flows independent and repeatable — see
 * `apps/android/maestro/README.md`'s "flow independence" section.
 */
import { mkdtemp } from "node:fs/promises";
import net, { type AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";

import { assertNotProductionDaemonPort } from "./production-daemon-port.js";

export interface IsolatedDaemonEndpoint {
  /** The port the daemon process should bind on the host (127.0.0.1). */
  port: number;
  /** Fresh `PASEO_HOME` directory for this run only — never `~/.paseo`. */
  paseoHome: string;
  /** `host:port` the daemon process should listen on. */
  listenAddress: string;
  /**
   * `host:port` a flow running *inside* the Android emulator should use —
   * `10.0.2.2` is the AVD's fixed alias for the host machine's loopback
   * interface (plan.md §15.1), so this reaches the same daemon that
   * `listenAddress` binds without any port forwarding.
   */
  emulatorAddress: string;
}

const MAX_ALLOCATION_ATTEMPTS = 20;

async function allocateEphemeralPort(): Promise<number> {
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

/** Allocates a port, re-rolling the vanishingly unlikely case it lands on 6767. */
async function allocateNonProductionPort(): Promise<number> {
  for (let attempt = 0; attempt < MAX_ALLOCATION_ATTEMPTS; attempt += 1) {
    const port = await allocateEphemeralPort();
    if (port !== 6767) return port;
  }
  throw new Error(
    `Could not allocate an ephemeral daemon port distinct from the production port after ${MAX_ALLOCATION_ATTEMPTS} attempts`,
  );
}

async function createIsolatedDaemonHome(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "picompanion-maestro-home-"));
  return path.join(root, ".paseo");
}

export async function resolveIsolatedDaemonEndpoint(): Promise<IsolatedDaemonEndpoint> {
  const port = await allocateNonProductionPort();
  assertNotProductionDaemonPort(port, "allocated ephemeral daemon port");
  const paseoHome = await createIsolatedDaemonHome();

  return {
    port,
    paseoHome,
    listenAddress: `127.0.0.1:${port}`,
    emulatorAddress: `10.0.2.2:${port}`,
  };
}
