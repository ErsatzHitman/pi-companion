/**
 * Diagnostics screen data model — plan.md §10.1/§13 Phase 7 ("Diagnostics
 * screen with versions, capabilities, connection path, and exportable
 * redacted logs"), T41B1.
 *
 * Deliberately framework-neutral: no React, DOM, or `@picompanion/client`
 * runtime import, so this module is exercised by plain `node --test`/
 * vitest calls, and so `apps/android`'s mirror (T42A3) can share the
 * exact same shape without pulling in web-only code.
 *
 * **Every field is built from a value a real source actually produced —
 * never a plausible-looking constant:**
 *
 * - `appVersion` / `clientId` — this app's own `hello` declaration
 *   (`daemon-client-context.tsx`'s exported `DAEMON_APP_VERSION` /
 *   `WEB_DAEMON_CLIENT_ID`), the literal values this app sends the
 *   daemon on every connection attempt, connected or not.
 * - `connectionInfo` — `HostController.getConnectionInfo()`
 *   (`@picompanion/frontend-core`'s `hosts` domain), reachable via
 *   `useDaemonClientContext().info`. Defined and truthful whether or
 *   not a daemon is reachable: the idle/disconnected shape
 *   (`{ status: "idle", profileId: null, kind: null }`) is this
 *   function's real input while disconnected, not a special case this
 *   module invents.
 * - `profile` — `HostController.getCurrentProfile()`, the saved/
 *   ephemeral `HostProfile` the current connection attempt is using (or
 *   `null` before one is chosen). Never carries a password or relay key
 *   (`types.ts`'s own doc comment: secrets never live on `HostProfile`).
 * - `serverInfo` — `DaemonClient.getLastServerInfoMessage()`, the
 *   daemon's own `server_info` handshake payload (version, server id,
 *   hostname, `desktopManaged`, `features`, `capabilities`). `null`
 *   until a connection has actually negotiated once — there is no
 *   substitute value for "the daemon has not told us its version yet"
 *   other than saying so.
 *
 * Where a real source has nothing to report yet, every field says so in
 * words (`"Not connected"`, `"Unknown — no server info yet (not
 * connected)"`) rather than rendering blank or a fabricated default —
 * this is the "the screen works while disconnected" acceptance
 * criterion, proven by `diagnostics-model.test.ts`'s disconnected-state
 * cases.
 */
import type { hosts } from "@picompanion/frontend-core";
import type { ServerInfoStatusPayload } from "@picompanion/protocol/messages";

export interface DiagnosticsField {
  id: string;
  label: string;
  value: string;
}

export interface DiagnosticsSection {
  id: string;
  title: string;
  fields: DiagnosticsField[];
}

export interface DiagnosticsModelInput {
  /** This app's declared `hello.appVersion` — `daemon-client-context.tsx`'s `DAEMON_APP_VERSION`. */
  appVersion: string;
  /** This app's declared `hello.clientId` — `daemon-client-context.tsx`'s `WEB_DAEMON_CLIENT_ID`. */
  clientId: string;
  /** `HostController.getConnectionInfo()` / `subscribeConnectionInfo`'s live snapshot. */
  connectionInfo: hosts.HostControllerConnectionInfo;
  /** `HostController.getCurrentProfile()`; `null` before any profile is selected. */
  profile: hosts.HostProfile | null;
  /** `DaemonClient.getLastServerInfoMessage()`; `null` before the first `server_info` push. */
  serverInfo: ServerInfoStatusPayload | null;
}

/** Shown for every field that genuinely has no value yet because there is no connection at all. */
export const NOT_CONNECTED = "Not connected";

/** Shown for every server-reported field while no `server_info` has ever arrived on this connection. */
export const NO_SERVER_INFO_YET = "Unknown — no server info yet (not connected)";

function connectionKindLabel(kind: hosts.HostConnectionKind | null): string {
  if (kind === "direct") return "Direct";
  if (kind === "relay") return "Relay";
  return "Not established";
}

function endpointForCurrentConnection(
  profile: hosts.HostProfile | null,
  kind: hosts.HostConnectionKind | null,
): string {
  if (!profile || !kind) return NOT_CONNECTED;
  if (kind === "direct") {
    return profile.direct?.endpoint ?? "Direct endpoint not configured on this profile";
  }
  return profile.relay?.endpoint ?? "Relay endpoint not configured on this profile";
}

function buildConnectionSection(input: DiagnosticsModelInput): DiagnosticsSection {
  const { connectionInfo, profile, clientId } = input;
  return {
    id: "connection",
    title: "Connection",
    fields: [
      { id: "status", label: "Connection status", value: connectionInfo.status },
      {
        id: "kind",
        label: "Connection path",
        value: connectionKindLabel(connectionInfo.kind),
      },
      {
        id: "profile",
        label: "Host profile",
        value: profile?.label ?? connectionInfo.profileId ?? "None selected",
      },
      {
        id: "endpoint",
        label: "Endpoint in use",
        value: endpointForCurrentConnection(profile, connectionInfo.kind),
      },
      { id: "client-id", label: "Client id declared to daemon", value: clientId },
    ],
  };
}

function buildVersionSection(input: DiagnosticsModelInput): DiagnosticsSection {
  const { appVersion, serverInfo } = input;
  return {
    id: "versions",
    title: "Versions",
    fields: [
      { id: "app-version", label: "App protocol version", value: appVersion },
      {
        id: "daemon-version",
        label: "Daemon version",
        value: serverInfo?.version ?? NO_SERVER_INFO_YET,
      },
      {
        id: "server-id",
        label: "Server id",
        value: serverInfo?.serverId ?? NO_SERVER_INFO_YET,
      },
      {
        id: "hostname",
        label: "Daemon hostname",
        value: serverInfo?.hostname ?? NO_SERVER_INFO_YET,
      },
      {
        id: "desktop-managed",
        label: "Desktop-managed",
        value: serverInfo ? String(serverInfo.desktopManaged ?? false) : NO_SERVER_INFO_YET,
      },
    ],
  };
}

/**
 * Every truthy/falsy key present on `server_info.features` (the
 * daemon's per-connection feature-flag advertisement — see
 * `@picompanion/frontend-core`'s `feature-gates.ts` for the same
 * "explicit `true`, everything else disabled" reading this mirrors),
 * sorted for a stable render order, plus the daemon's advertised voice
 * capability state (`server_info.capabilities.voice`). Never a fixed
 * list of "capabilities we expect" — whatever the daemon actually sent
 * is what renders, so a newly added or removed flag shows up here
 * without this module changing.
 */
function buildCapabilitiesSection(input: DiagnosticsModelInput): DiagnosticsSection {
  const { serverInfo } = input;
  if (!serverInfo) {
    return {
      id: "capabilities",
      title: "Capabilities",
      fields: [
        { id: "capabilities-unavailable", label: "Capabilities", value: NO_SERVER_INFO_YET },
      ],
    };
  }

  const fields: DiagnosticsField[] = [];
  const featureEntries = Object.entries(serverInfo.features ?? {}).filter(
    (entry): entry is [string, boolean] => entry[1] !== undefined,
  );
  if (featureEntries.length === 0) {
    fields.push({ id: "features-none", label: "Feature flags", value: "None advertised" });
  } else {
    for (const [key, value] of featureEntries.sort(([a], [b]) => a.localeCompare(b))) {
      fields.push({ id: `feature-${key}`, label: key, value: value ? "Enabled" : "Disabled" });
    }
  }

  const voice = serverInfo.capabilities?.voice;
  fields.push({
    id: "voice-dictation",
    label: "Voice dictation",
    value: voice?.dictation
      ? `${voice.dictation.enabled ? "Enabled" : "Disabled"} — ${voice.dictation.reason}`
      : "Not advertised",
  });
  fields.push({
    id: "voice-capture",
    label: "Voice capture",
    value: voice?.voice
      ? `${voice.voice.enabled ? "Enabled" : "Disabled"} — ${voice.voice.reason}`
      : "Not advertised",
  });

  return { id: "capabilities", title: "Capabilities", fields };
}

/** Builds the full diagnostics screen model from real, named sources only — see this module's doc comment. */
export function buildDiagnosticsSnapshot(input: DiagnosticsModelInput): DiagnosticsSection[] {
  return [
    buildConnectionSection(input),
    buildVersionSection(input),
    buildCapabilitiesSection(input),
  ];
}
