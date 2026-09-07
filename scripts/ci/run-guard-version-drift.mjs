#!/usr/bin/env node
// CLI entry point for the version-drift guard (T44A3). Run from the
// repository root (CI runs it via `node scripts/ci/run-guard-version-drift.mjs`).
// See scripts/ci/guard-version-drift.mjs for the checked rules and their
// reasoning.

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  findRelayProtocolVersionDrift,
  findWorkspacePinDrift,
  findWsHelloProtocolVersionDrift,
} from "./guard-version-drift.mjs";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));

function readManifest(relativePath) {
  const manifest = JSON.parse(readFileSync(join(repoRoot, relativePath), "utf8"));
  return {
    manifestPath: relativePath,
    name: manifest.name,
    version: manifest.version,
    dependencies: manifest.dependencies,
    devDependencies: manifest.devDependencies,
  };
}

function discoverWorkspaceManifests() {
  const manifests = [];
  for (const group of ["packages", "apps"]) {
    let entries;
    try {
      entries = readdirSync(join(repoRoot, group));
    } catch {
      continue;
    }
    for (const entry of entries) {
      const relativePath = `${group}/${entry}/package.json`;
      try {
        manifests.push(readManifest(relativePath));
      } catch {
        // Not a workspace directory (no package.json) — skip.
      }
    }
  }
  return manifests;
}

function main() {
  let anyViolations = false;

  // --- Axis 1: every @picompanion/* pin equals its target's own version ---
  const workspaces = discoverWorkspaceManifests();
  const pinDrift = findWorkspacePinDrift(workspaces);
  if (pinDrift.length === 0) {
    console.log(
      `guard-version-drift: OK — every @picompanion/* pin across ${workspaces.length} workspace manifest(s) matches its target's own version.`,
    );
  } else {
    anyViolations = true;
    console.error("guard-version-drift: FAILED — workspace version pins have drifted:");
    for (const v of pinDrift) {
      console.error(
        `  ${v.manifestPath} (${v.dependent}) pins ${v.packageName}@${v.pinnedVersion} in "${v.section}", but ${v.packageName}'s own package.json now says ${v.actualVersion}.`,
      );
      console.error(`    fix: update the pin in ${v.manifestPath} to "${v.actualVersion}".`);
    }
  }

  // --- Axis 2: daemon <-> client WS hello protocol version literal --------
  const serverSource = readFileSync(
    join(repoRoot, "packages/server/src/server/websocket-server.ts"),
    "utf8",
  );
  const clientSource = readFileSync(join(repoRoot, "packages/client/src/daemon-client.ts"), "utf8");
  const wsDrift = findWsHelloProtocolVersionDrift({ serverSource, clientSource });
  if (wsDrift.length === 0) {
    console.log(
      "guard-version-drift: OK — daemon WS_PROTOCOL_VERSION and client protocolVersion agree.",
    );
  } else {
    anyViolations = true;
    console.error("guard-version-drift: FAILED — daemon/client hello protocol version:");
    for (const v of wsDrift) console.error(`  [${v.kind}] ${v.detail}`);
  }

  // --- Axis 3: protocol <-> relay relay-wire-version literal ---------------
  const protocolSource = readFileSync(
    join(repoRoot, "packages/protocol/src/daemon-endpoints.ts"),
    "utf8",
  );
  const relaySource = readFileSync(
    join(repoRoot, "packages/relay/src/cloudflare-adapter.ts"),
    "utf8",
  );
  const relayDrift = findRelayProtocolVersionDrift({ protocolSource, relaySource });
  if (relayDrift.length === 0) {
    console.log(
      "guard-version-drift: OK — protocol's CURRENT_RELAY_PROTOCOL_VERSION and relay's own CURRENT_RELAY_VERSION agree.",
    );
  } else {
    anyViolations = true;
    console.error("guard-version-drift: FAILED — protocol/relay wire version:");
    for (const v of relayDrift) console.error(`  [${v.kind}] ${v.detail}`);
  }

  // Drift axes this guard does NOT check — see
  // docs/security-and-version-drift.md for the full, reasoned list.
  console.log(
    "guard-version-drift: NOTE — this guard does not check: third-party dependency SemVer ranges (see the dependency-audit job), the Expo/React Native SDK version pinned in apps/android, or the daemon's own self-reported `daemonVersion` (read live from packages/server's package.json at runtime via resolveDaemonVersion(), so it cannot drift by construction).",
  );

  if (anyViolations) process.exitCode = 1;
}

main();
