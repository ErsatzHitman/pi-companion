import { readFileSync } from "node:fs";
import { join } from "node:path";
import assert from "node:assert/strict";
import test from "node:test";

import {
  findRelayProtocolVersionDrift,
  findWorkspacePinDrift,
  findWsHelloProtocolVersionDrift,
} from "./guard-version-drift.mjs";

const repoRoot = join(import.meta.dirname, "..", "..");

// --- findWorkspacePinDrift ------------------------------------------------

test("passes when every pin equals its target's own version (fixture)", () => {
  const workspaces = [
    {
      manifestPath: "packages/protocol/package.json",
      name: "@picompanion/protocol",
      version: "0.3.0-beta.2",
    },
    {
      manifestPath: "packages/client/package.json",
      name: "@picompanion/client",
      version: "0.3.0-beta.2",
      dependencies: { "@picompanion/protocol": "0.3.0-beta.2" },
    },
  ];

  assert.deepEqual(findWorkspacePinDrift(workspaces), []);
});

test("fails when a dependent pins a stale version of a workspace package (missing-declaration fixture)", () => {
  const workspaces = [
    {
      manifestPath: "packages/protocol/package.json",
      name: "@picompanion/protocol",
      version: "0.3.0-beta.3",
    },
    {
      manifestPath: "packages/client/package.json",
      name: "@picompanion/client",
      version: "0.3.0-beta.2",
      dependencies: { "@picompanion/protocol": "0.3.0-beta.2" },
    },
  ];

  assert.deepEqual(findWorkspacePinDrift(workspaces), [
    {
      manifestPath: "packages/client/package.json",
      dependent: "@picompanion/client",
      packageName: "@picompanion/protocol",
      section: "dependencies",
      pinnedVersion: "0.3.0-beta.2",
      actualVersion: "0.3.0-beta.3",
    },
  ]);
});

test("checks devDependencies too, and ignores a package not among the known workspaces", () => {
  const workspaces = [
    {
      manifestPath: "packages/client/package.json",
      name: "@picompanion/client",
      version: "0.3.0-beta.2",
    },
    {
      manifestPath: "apps/web/package.json",
      name: "@picompanion/web",
      version: "0.1.0",
      devDependencies: {
        "@picompanion/client": "0.3.0-beta.1",
        "@picompanion/never-published": "9.9.9",
      },
    },
  ];

  assert.deepEqual(findWorkspacePinDrift(workspaces), [
    {
      manifestPath: "apps/web/package.json",
      dependent: "@picompanion/web",
      packageName: "@picompanion/client",
      section: "devDependencies",
      pinnedVersion: "0.3.0-beta.1",
      actualVersion: "0.3.0-beta.2",
    },
  ]);
});

test("ignores a non-@picompanion dependency entirely", () => {
  const workspaces = [
    {
      manifestPath: "apps/web/package.json",
      name: "@picompanion/web",
      version: "0.1.0",
      dependencies: { react: "18.3.1" },
    },
  ];

  assert.deepEqual(findWorkspacePinDrift(workspaces), []);
});

// --- findWsHelloProtocolVersionDrift --------------------------------------

test("passes when the daemon and client hello literals agree (fixture)", () => {
  const violations = findWsHelloProtocolVersionDrift({
    serverSource: "const WS_PROTOCOL_VERSION = 1;\nif (x !== WS_PROTOCOL_VERSION) {}",
    clientSource:
      'this.sendJsonMessage("hello", "hello", {\n  protocolVersion: 1,\n  capabilities: {},\n});',
  });
  assert.deepEqual(violations, []);
});

test("fails when the daemon and client hello literals disagree (mismatch fixture)", () => {
  const violations = findWsHelloProtocolVersionDrift({
    serverSource: "const WS_PROTOCOL_VERSION = 2;",
    clientSource: "protocolVersion: 1,",
  });
  assert.equal(violations.length, 1);
  assert.equal(violations[0].kind, "mismatch");
  assert.match(violations[0].detail, /WS_PROTOCOL_VERSION=2/);
  assert.match(violations[0].detail, /protocolVersion=1/);
});

test("fails loudly (not silently) when a literal cannot be found in either source", () => {
  const bothMissing = findWsHelloProtocolVersionDrift({
    serverSource: "// renamed away",
    clientSource: "// renamed away",
  });
  assert.equal(bothMissing.length, 1);
  assert.equal(bothMissing[0].kind, "extraction-failed");

  const oneMissing = findWsHelloProtocolVersionDrift({
    serverSource: "const WS_PROTOCOL_VERSION = 1;",
    clientSource: "// no protocolVersion literal here any more",
  });
  assert.equal(oneMissing.length, 1);
  assert.equal(oneMissing[0].kind, "extraction-failed");
  assert.match(oneMissing[0].detail, /daemon-client\.ts/);
});

// --- findRelayProtocolVersionDrift -----------------------------------------

test("passes when protocol's and relay's own relay-version literals agree (fixture)", () => {
  const violations = findRelayProtocolVersionDrift({
    protocolSource: 'export const CURRENT_RELAY_PROTOCOL_VERSION: RelayProtocolVersion = "2";',
    relaySource: 'const CURRENT_RELAY_VERSION: RelayProtocolVersion = "2";',
  });
  assert.deepEqual(violations, []);
});

test("fails when protocol's and relay's own relay-version literals disagree (mismatch fixture)", () => {
  const violations = findRelayProtocolVersionDrift({
    protocolSource: 'export const CURRENT_RELAY_PROTOCOL_VERSION: RelayProtocolVersion = "3";',
    relaySource: 'const CURRENT_RELAY_VERSION: RelayProtocolVersion = "2";',
  });
  assert.equal(violations.length, 1);
  assert.equal(violations[0].kind, "mismatch");
  assert.match(violations[0].detail, /"3"/);
  assert.match(violations[0].detail, /"2"/);
});

test("fails loudly when the relay literal cannot be found", () => {
  const violations = findRelayProtocolVersionDrift({
    protocolSource: 'export const CURRENT_RELAY_PROTOCOL_VERSION: RelayProtocolVersion = "2";',
    relaySource: "// no such constant any more",
  });
  assert.equal(violations.length, 1);
  assert.equal(violations[0].kind, "extraction-failed");
  assert.match(violations[0].detail, /cloudflare-adapter\.ts/);
});

// --- real-tree assertions --------------------------------------------------
//
// Weaker than the dedicated CI job `run-guard-version-drift.mjs` is wired as
// (see .github/workflows/ci.yml), but per this repository's own
// guard-run-guard-wiring.mjs header ("real protection, but a materially
// weaker contract than a dedicated guard job"), a second, independent layer
// costs little: these three assertions read the ACTUAL committed files this
// guard cares about and prove the real tree carries no drift today.

function readWorkspaceManifests() {
  const manifestPaths = [
    "packages/cli/package.json",
    "packages/client/package.json",
    "packages/design-tokens/package.json",
    "packages/expo-two-way-audio/package.json",
    "packages/frontend-core/package.json",
    "packages/highlight/package.json",
    "packages/pi-bridge/package.json",
    "packages/protocol/package.json",
    "packages/relay/package.json",
    "packages/server/package.json",
    "apps/android/package.json",
    "apps/web/package.json",
  ];
  return manifestPaths.map((manifestPath) => {
    const manifest = JSON.parse(readFileSync(join(repoRoot, manifestPath), "utf8"));
    return {
      manifestPath,
      name: manifest.name,
      version: manifest.version,
      dependencies: manifest.dependencies,
      devDependencies: manifest.devDependencies,
    };
  });
}

test("real tree: every @picompanion/* pin across every workspace manifest matches its target's own version", () => {
  const violations = findWorkspacePinDrift(readWorkspaceManifests());
  assert.deepEqual(violations, [], JSON.stringify(violations, null, 2));
});

test("real tree: the daemon and client hello-handshake protocol version literals agree", () => {
  const serverSource = readFileSync(
    join(repoRoot, "packages/server/src/server/websocket-server.ts"),
    "utf8",
  );
  const clientSource = readFileSync(join(repoRoot, "packages/client/src/daemon-client.ts"), "utf8");
  const violations = findWsHelloProtocolVersionDrift({ serverSource, clientSource });
  assert.deepEqual(violations, [], JSON.stringify(violations, null, 2));
});

test("real tree: protocol's and relay's own relay wire-version literals agree", () => {
  const protocolSource = readFileSync(
    join(repoRoot, "packages/protocol/src/daemon-endpoints.ts"),
    "utf8",
  );
  const relaySource = readFileSync(
    join(repoRoot, "packages/relay/src/cloudflare-adapter.ts"),
    "utf8",
  );
  const violations = findRelayProtocolVersionDrift({ protocolSource, relaySource });
  assert.deepEqual(violations, [], JSON.stringify(violations, null, 2));
});
