// T44A3: CI guard — version drift between this repository's own workspace
// packages, and between the wire-protocol version literals that protocol,
// client and daemon each declare independently.
//
// ## Why this exists
//
// Every `@picompanion/*` workspace package in this repository is pinned by
// its consumers with an EXACT version string (no semver range — see any
// `package.json` under `packages/*` or `apps/*`). That is a deliberate
// choice (single-repo, single-published-set, no external consumers), but it
// only holds if something notices when a pin and the package's own
// `version` field disagree — a bump to one `package.json` with a stale pin
// left in a sibling manifest would otherwise sit unnoticed until an
// `npm install --save-exact` finally re-pins it, or forever if nobody ever
// runs that command again.
//
// `scripts/ci/guard-declared-workspace-deps.mjs` (T60B) already answers a
// *different* question — "does the app's manifest declare every
// `@picompanion/*` package its source imports at all?" — by parsing every
// workspace manifest. This guard reuses that same manifest inventory but
// asks a question T60B's guard does not: for a package that IS declared,
// does the declared VERSION STRING match the version the target package
// currently claims for itself? A dependency can be correctly declared and
// still wrong.
//
// A second, unrelated drift axis lives in wire-protocol version literals,
// not `package.json` fields at all:
//
//   - The daemon (`packages/server/src/server/websocket-server.ts`) closes
//     a hello handshake with `WS_CLOSE_INCOMPATIBLE_PROTOCOL` when
//     `message.protocolVersion !== WS_PROTOCOL_VERSION`. The CLIENT side of
//     that same handshake (`packages/client/src/daemon-client.ts`,
//     `sendHelloMessage`) sends a hand-written literal `protocolVersion: 1`
//     — not a value imported from anywhere. `packages/protocol` (the
//     supposed single source of truth for wire shapes) only types this
//     field as `z.number().int()` in `WSHelloMessageSchema`; it declares no
//     constant either side could import to guarantee agreement. So today
//     these two literals agree only because nobody has edited either file
//     since the other's value was last checked by eye.
//   - The relay wire version has almost the identical shape:
//     `packages/protocol/src/daemon-endpoints.ts` exports
//     `CURRENT_RELAY_PROTOCOL_VERSION = "2"`, correctly imported by
//     `packages/frontend-core/src/hosts/connection-url.ts` for the CLIENT
//     side of a relay connection — but the relay's OWN server-side adapter,
//     `packages/relay/src/cloudflare-adapter.ts`, re-declares
//     `CURRENT_RELAY_VERSION = "2"` as its own independent literal (`packages/relay`
//     declares no `@picompanion/protocol` dependency at all — it deploys to
//     Cloudflare Workers, a separate runtime from every other workspace —
//     so it cannot simply `import` protocol's constant without first
//     solving that packaging question, which is out of this task's scope;
//     see docs/security-and-version-drift.md for the disclosed gap this
//     leaves).
//
// Both wire-literal pairs are checked by SOURCE-TEXT extraction (this
// repository has no runtime that could evaluate `packages/client` and
// `packages/server` against each other at check time without a build), the
// same technique `guard-no-legacy-schema-reader.mjs` and
// `guard-capability-prose.mjs` already use elsewhere in this directory.
//
// ## What deliberately fails LOUD rather than silently passing
//
// If either literal cannot be found at all (renamed, refactored away, moved
// to a different file), `findWsHelloProtocolVersionDrift` and
// `findRelayProtocolVersionDrift` report an `extraction-failed` violation
// rather than treating "nothing found" as "nothing wrong". A guard that
// can't find the thing it is supposed to compare must never report success
// by default — see this repository's own CLAUDE.md, "A fix that no test
// can fail is not a fix".
//
// Pure, dependency-free check functions only. `run-guard-version-drift.mjs`
// is the CLI entry point CI actually runs.

/**
 * @typedef {{
 *   manifestPath: string,
 *   name: string,
 *   version: string,
 *   dependencies?: Record<string, string>,
 *   devDependencies?: Record<string, string>,
 * }} WorkspaceManifest
 */

/**
 * @param {WorkspaceManifest[]} workspaces every workspace's own parsed manifest
 * @returns {{ manifestPath: string, dependent: string, packageName: string, section: "dependencies" | "devDependencies", pinnedVersion: string, actualVersion: string }[]}
 *   every `@picompanion/*` pin whose declared version string does not equal
 *   the target workspace's own current `version`, sorted by manifest path
 *   then package name. A package not found among the known workspaces is
 *   skipped here — that is `guard-declared-workspace-deps.mjs`'s concern
 *   (an undeclared or unresolvable package), not a version mismatch.
 */
export function findWorkspacePinDrift(workspaces) {
  const versionByName = new Map(workspaces.map((w) => [w.name, w.version]));
  const violations = [];

  for (const workspace of workspaces) {
    for (const section of /** @type {const} */ (["dependencies", "devDependencies"])) {
      const deps = workspace[section] ?? {};
      for (const [packageName, pinnedVersion] of Object.entries(deps)) {
        if (!packageName.startsWith("@picompanion/")) continue;
        const actualVersion = versionByName.get(packageName);
        if (actualVersion === undefined) continue; // unknown workspace — not this guard's concern.
        if (pinnedVersion !== actualVersion) {
          violations.push({
            manifestPath: workspace.manifestPath,
            dependent: workspace.name,
            packageName,
            section,
            pinnedVersion,
            actualVersion,
          });
        }
      }
    }
  }

  violations.sort(
    (a, b) =>
      a.manifestPath.localeCompare(b.manifestPath) || a.packageName.localeCompare(b.packageName),
  );
  return violations;
}

const WS_SERVER_LITERAL_PATTERN = /const\s+WS_PROTOCOL_VERSION\s*=\s*(\d+)\s*;/;
const WS_CLIENT_LITERAL_PATTERN = /\bprotocolVersion:\s*(\d+)\s*,/;

/**
 * @param {{ serverSource: string, clientSource: string }} sources raw text of
 *   `packages/server/src/server/websocket-server.ts` and
 *   `packages/client/src/daemon-client.ts`
 * @returns {{ kind: "mismatch" | "extraction-failed", detail: string }[]}
 *   empty when both literals are found and equal.
 */
export function findWsHelloProtocolVersionDrift({ serverSource, clientSource }) {
  const serverMatch = serverSource.match(WS_SERVER_LITERAL_PATTERN);
  const clientMatch = clientSource.match(WS_CLIENT_LITERAL_PATTERN);

  if (!serverMatch || !clientMatch) {
    const missing = [
      !serverMatch ? "packages/server/src/server/websocket-server.ts's WS_PROTOCOL_VERSION" : null,
      !clientMatch ? "packages/client/src/daemon-client.ts's protocolVersion literal" : null,
    ].filter(Boolean);
    return [
      {
        kind: "extraction-failed",
        detail: `could not find: ${missing.join(" and ")}. This guard's regex is now blind — update it alongside whatever moved or renamed the literal.`,
      },
    ];
  }

  if (serverMatch[1] !== clientMatch[1]) {
    return [
      {
        kind: "mismatch",
        detail: `daemon WS_PROTOCOL_VERSION=${serverMatch[1]} but client sendHelloMessage's protocolVersion=${clientMatch[1]}`,
      },
    ];
  }

  return [];
}

const PROTOCOL_RELAY_LITERAL_PATTERN =
  /CURRENT_RELAY_PROTOCOL_VERSION\s*:\s*RelayProtocolVersion\s*=\s*"(\d+)"/;
const RELAY_ADAPTER_LITERAL_PATTERN =
  /CURRENT_RELAY_VERSION\s*:\s*RelayProtocolVersion\s*=\s*"(\d+)"/;

/**
 * @param {{ protocolSource: string, relaySource: string }} sources raw text of
 *   `packages/protocol/src/daemon-endpoints.ts` and
 *   `packages/relay/src/cloudflare-adapter.ts`
 * @returns {{ kind: "mismatch" | "extraction-failed", detail: string }[]}
 */
export function findRelayProtocolVersionDrift({ protocolSource, relaySource }) {
  const protocolMatch = protocolSource.match(PROTOCOL_RELAY_LITERAL_PATTERN);
  const relayMatch = relaySource.match(RELAY_ADAPTER_LITERAL_PATTERN);

  if (!protocolMatch || !relayMatch) {
    const missing = [
      !protocolMatch
        ? "packages/protocol/src/daemon-endpoints.ts's CURRENT_RELAY_PROTOCOL_VERSION"
        : null,
      !relayMatch ? "packages/relay/src/cloudflare-adapter.ts's CURRENT_RELAY_VERSION" : null,
    ].filter(Boolean);
    return [
      {
        kind: "extraction-failed",
        detail: `could not find: ${missing.join(" and ")}. This guard's regex is now blind — update it alongside whatever moved or renamed the literal.`,
      },
    ];
  }

  if (protocolMatch[1] !== relayMatch[1]) {
    return [
      {
        kind: "mismatch",
        detail: `protocol's CURRENT_RELAY_PROTOCOL_VERSION="${protocolMatch[1]}" but relay's own CURRENT_RELAY_VERSION="${relayMatch[1]}"`,
      },
    ];
  }

  return [];
}
