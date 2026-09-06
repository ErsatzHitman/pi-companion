/**
 * Android diagnostics screen data model — plan.md §13 Phase 7
 * ("Diagnostics screen with versions, capabilities, connection path, and
 * exportable redacted logs"), T42A3.
 *
 * Mirrors `apps/web/src/features/diagnostics/diagnostics-model.ts`
 * (T41B1) — that module is this task's specification, per its own doc
 * comment and T42A3's own brief ("that web screen is what you are
 * mirroring, and it is the specification"). This is a SEPARATE file, not
 * a copy or a cross-app import: `apps/web` and `apps/android` never
 * import each other's `src` (repository invariant — every workspace
 * depends on package *exports*, never a sibling app's source tree), and
 * `diagnostics-model.ts` itself lives only under `apps/web/src`, not in
 * `@picompanion/frontend-core`, so there is nothing here to import even
 * if that boundary were crossed. See this task's report for the exact
 * seam a future task would close by promoting the shared parts (the
 * versions/capabilities logic below, which depends on nothing
 * Android-specific) into `frontend-core`.
 *
 * Same three sections, same ids, same titles, same field ids —
 * `diagnostics-model.test.ts` proves this against the WEB FILE'S OWN
 * SOURCE TEXT (never a hand-typed list also living in this file), so a
 * future section or field added to the web model and not mirrored here
 * fails this suite instead of silently drifting.
 *
 * Deliberately framework-neutral: no React, React Native, DOM, or
 * `@picompanion/client` runtime import — exercised by plain `vitest`
 * calls with zero device/emulator, matching every other `*-model.ts` in
 * this tree (`settings-model.ts`, `files-model.ts`).
 *
 * ## Where Android's real sources differ from web's, and why
 *
 * `apps/android` never adopted `@picompanion/frontend-core`'s `hosts`
 * domain (`HostController`/`HostProfile`/`HostControllerConnectionInfo`)
 * that `apps/web`'s model reads from — it built its own
 * `DaemonConnectionStore`/`HostProfileRecord` pair
 * (`features/connect/daemon-connection-store.ts`,
 * `features/connect/credential-store.ts`) instead. That is a pre-existing
 * architectural divergence this task did not introduce and is not in
 * scope to unify (this task Owns only `features/diagnostics/`). This
 * model's `DiagnosticsModelInput` therefore declares its own small,
 * STRUCTURAL types (`DiagnosticsConnectionSnapshot`,
 * `DiagnosticsHostProfile`) shaped to match what
 * `DaemonConnectionStore`/`HostProfileRecord` actually produce today —
 * width subtyping means a real `DaemonConnectionSnapshot`/
 * `HostProfileRecord` value satisfies these without a cast or an import,
 * the same "structural typing, no cross-feature import needed" pattern
 * `daemon-connection-store.ts`'s own `DaemonConnectionSourceProfile`
 * already uses.
 *
 * - `appVersion` / `clientId` — this app's own `hello` declaration (the
 *   literal values this app sends the daemon on every connection
 *   attempt, connected or not) — same real-source discipline as web's
 *   `DAEMON_APP_VERSION`/`WEB_DAEMON_CLIENT_ID`, supplied by whichever
 *   caller constructs the real `DaemonClientLifecycleConfig`
 *   (`ANDROID_DAEMON_CLIENT_ID` in `app-shell/core.ts`).
 * - `connection` — `DaemonConnectionStore.getSnapshot()`'s real shape
 *   (`phase`/`path`/`daemonAddress`). Defined and truthful whether or
 *   not a daemon is reachable: `phase: "idle"`, `path: null`,
 *   `daemonAddress: null` is that store's own real idle value, not a
 *   special case this module invents.
 * - `profile` — the saved `HostProfileRecord` the current connection
 *   attempt is using (or `null` before one is chosen/loaded). Never
 *   carries a password or relay key — `credential-store.ts`'s own
 *   design doc: secrets go through `SecureStorage` only, never onto this
 *   record.
 * - `serverInfo` — `DaemonClientLike.getLastServerInfoMessage()`
 *   (`@picompanion/frontend-core`'s `connection.DaemonClientLike`,
 *   reachable in production via
 *   `connection.getActiveLifecycle()?.getDaemonClient()` —
 *   `app-shell/core.ts`'s own established pattern for every other
 *   daemon-sourced field on this app). `null` until a connection has
 *   actually negotiated once.
 *
 * Where a real source has nothing to report yet, every field says so in
 * words (`NOT_CONNECTED`, `NO_SERVER_INFO_YET`) rather than rendering
 * blank or a fabricated default — the "the screen works while
 * disconnected" acceptance criterion, proven by this file's own
 * disconnected-state tests.
 */
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

/** Mirrors `DaemonClientLifecycleStatus` (`@picompanion/frontend-core`'s `connection` domain) and `DaemonConnectionStore`'s own `phase` — the same five-value set both already use. */
export type DiagnosticsConnectionPhase =
  | "idle"
  | "connecting"
  | "connected"
  | "disconnected"
  | "disposed";

/** Mirrors `DaemonConnectionPath` (`features/connect/daemon-connection-store.ts`). */
export type DiagnosticsConnectionPath = "direct" | "relay" | null;

/** Structural subset of `DaemonConnectionAddress` (`features/connect/daemon-connection-store.ts`) this model reads. Not imported from there — see this file's header comment on why sibling features stay decoupled in this tree. */
export interface DiagnosticsConnectionAddress {
  host: string;
  port: number;
  useTls: boolean;
  isIpv6: boolean;
}

/** Structural subset of `DaemonConnectionSnapshot` (`features/connect/daemon-connection-store.ts`) this model reads. A real snapshot satisfies this as-is (width subtyping); this model never imports that module. */
export interface DiagnosticsConnectionSnapshot {
  phase: DiagnosticsConnectionPhase;
  path: DiagnosticsConnectionPath;
  daemonAddress: DiagnosticsConnectionAddress | null;
}

/** Structural subset of `HostProfileRecord` (`features/connect/credential-store.ts`) this model reads. Never carries a password or relay key — see that module's own design doc. */
export interface DiagnosticsHostProfile {
  label: string;
  /** `host:port` (direct) or the relay's own `host:port` (relay) — `HostProfileRecord.endpoint`'s exact shape. Never pre-validated beyond that module's own parsing, which is exactly why `diagnostics-export.ts` still runs this through the same redaction rule web's model does. */
  endpoint: string;
}

export interface DiagnosticsModelInput {
  /** This app's declared `hello.appVersion`. */
  appVersion: string;
  /** This app's declared `hello.clientId` (`ANDROID_DAEMON_CLIENT_ID` in `app-shell/core.ts`). */
  clientId: string;
  /** `DaemonConnectionStore.getSnapshot()`'s live value. */
  connection: DiagnosticsConnectionSnapshot;
  /** The `HostProfileRecord` in use; `null` before any profile is selected/loaded. */
  profile: DiagnosticsHostProfile | null;
  /** `DaemonClientLike.getLastServerInfoMessage()`; `null` before the first `server_info` push. */
  serverInfo: ServerInfoStatusPayload | null;
}

/** Shown for every field that genuinely has no value yet because there is no connection at all. Matches web's own string exactly. */
export const NOT_CONNECTED = "Not connected";

/** Shown for every server-reported field while no `server_info` has ever arrived on this connection. Matches web's own string exactly. */
export const NO_SERVER_INFO_YET = "Unknown — no server info yet (not connected)";

function connectionPathLabel(path: DiagnosticsConnectionPath): string {
  if (path === "direct") return "Direct";
  if (path === "relay") return "Relay";
  return "Not established";
}

function endpointForCurrentConnection(
  profile: DiagnosticsHostProfile | null,
  path: DiagnosticsConnectionPath,
): string {
  if (!profile || !path) return NOT_CONNECTED;
  return profile.endpoint;
}

function buildConnectionSection(input: DiagnosticsModelInput): DiagnosticsSection {
  const { connection, profile, clientId } = input;
  return {
    id: "connection",
    title: "Connection",
    fields: [
      { id: "status", label: "Connection status", value: connection.phase },
      {
        id: "kind",
        label: "Connection path",
        value: connectionPathLabel(connection.path),
      },
      {
        id: "profile",
        label: "Host profile",
        value: profile?.label ?? "None selected",
      },
      {
        id: "endpoint",
        label: "Endpoint in use",
        value: endpointForCurrentConnection(profile, connection.path),
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
 * Identical logic to web's `buildCapabilitiesSection` — this half reads
 * only `ServerInfoStatusPayload` (a `@picompanion/protocol` type shared
 * by both apps), so nothing Android-specific changes it. Every
 * truthy/falsy key present on `server_info.features`, sorted for a
 * stable render order, plus the daemon's advertised voice capability
 * state. Never a fixed list of "capabilities we expect".
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
