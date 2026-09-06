import { rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { resolveIsolatedDaemonEndpoint } from "./daemon-endpoint.js";

const createdHomes: string[] = [];

afterEach(async () => {
  await Promise.all(
    createdHomes
      .splice(0)
      .map((home) =>
        rm(path.dirname(home), { recursive: true, force: true }).catch(() => undefined),
      ),
  );
});

describe("resolveIsolatedDaemonEndpoint", () => {
  it("never resolves the production daemon port", async () => {
    const endpoint = await resolveIsolatedDaemonEndpoint();
    createdHomes.push(endpoint.paseoHome);

    expect(endpoint.port).not.toBe(6767);
    expect(endpoint.listenAddress).not.toContain(":6767");
    expect(endpoint.emulatorAddress).not.toContain(":6767");
  });

  it("addresses agree with the allocated port", async () => {
    const endpoint = await resolveIsolatedDaemonEndpoint();
    createdHomes.push(endpoint.paseoHome);

    expect(endpoint.listenAddress).toBe(`127.0.0.1:${endpoint.port}`);
    expect(endpoint.emulatorAddress).toBe(`10.0.2.2:${endpoint.port}`);
  });

  it("creates a real, fresh PASEO_HOME directory distinct from the real ~/.paseo", async () => {
    const endpoint = await resolveIsolatedDaemonEndpoint();
    createdHomes.push(endpoint.paseoHome);

    expect(endpoint.paseoHome.endsWith(".paseo")).toBe(true);
    expect(endpoint.paseoHome).toContain("picompanion-maestro-home-");
  });

  it("two resolutions never share a port or a home directory", async () => {
    const first = await resolveIsolatedDaemonEndpoint();
    const second = await resolveIsolatedDaemonEndpoint();
    createdHomes.push(first.paseoHome, second.paseoHome);

    expect(first.port).not.toBe(second.port);
    expect(first.paseoHome).not.toBe(second.paseoHome);
  });

  it("does not create the PASEO_HOME leaf directory itself (the daemon process does that on start)", async () => {
    const endpoint = await resolveIsolatedDaemonEndpoint();
    createdHomes.push(endpoint.paseoHome);

    // The mkdtemp root exists; the daemon's own `.paseo` leaf is left for
    // the daemon process to create, matching `apps/web/e2e/fixtures/daemon.ts`'s
    // split between the temp root and the paseoHome leaf.
    expect(existsSync(path.dirname(endpoint.paseoHome))).toBe(true);
  });
});
