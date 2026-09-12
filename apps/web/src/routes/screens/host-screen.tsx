import { useMemo } from "react";
import { Link, getRouteApi } from "@tanstack/react-router";

import { useDaemonClientContext } from "../../app/daemon-client-context.js";
import { Section, StatusIndicator } from "../../ui/primitives/index.js";
import type { StatusTone } from "../../ui/primitives/index.js";
import "./host-screen.css";

const routeApi = getRouteApi("/h/$serverId");

/**
 * Plain-language mapping of `HostControllerConnectionStatus`
 * (`packages/frontend-core/src/hosts/host-controller.ts`) onto the
 * `StatusIndicator` primitive's tone plus visible text. Every value gets a
 * sentence — a status is never a colour alone (plan.md §10.5). Kept local to
 * this screen: it is the only place that renders the connection status as
 * prose rather than reusing `features/connection`'s badge.
 */
function connectionStatusCopy(status: string): { tone: StatusTone; text: string } {
  switch (status) {
    case "connected":
      return { tone: "success", text: "Connected" };
    case "connecting":
      return { tone: "info", text: "Connecting…" };
    case "probing":
      return { tone: "info", text: "Probing the host…" };
    case "reconnect-pending":
      return { tone: "info", text: "Reconnect pending" };
    case "disconnected":
      return { tone: "warning", text: "Disconnected" };
    case "offline":
      return { tone: "warning", text: "Offline" };
    case "disposed":
      return { tone: "neutral", text: "Connection closed" };
    default:
      return { tone: "neutral", text: "Not connected" };
  }
}

interface HostFact {
  key: string;
  term: string;
  testId: string;
  value: React.ReactNode;
}

/**
 * `/h/:serverId` host landing (T393). Before this, the route rendered
 * `ui/route-placeholder.tsx`'s bare stub; there was no host-dashboard
 * feature to hand a screen to, so it only echoed the `serverId` and the
 * connection status.
 *
 * This is deliberately a landing, not a second session list: the session
 * rail above it (`routes/root-route.tsx`'s `SessionRailContent`) already
 * renders every session for this host, so this screen points at the real
 * destinations instead of duplicating them. It invents no data: every fact
 * comes from the route param or `useDaemonClientContext()`'s live
 * `HostControllerConnectionInfo`, and a fact the app does not have yet
 * (no connected profile, for example) says so rather than showing a
 * plausible-looking placeholder.
 */
export function HostScreen() {
  const { serverId } = routeApi.useParams();
  const { info, hostController } = useDaemonClientContext();

  // `getCurrentProfile()` is a synchronous getter outside the `info`
  // snapshot, so it is memoised against the two `info` fields that actually
  // change when the active profile does (the same dependency choice
  // `host-session-screen.tsx` makes for `getCurrentProfile()`).
  const profile = useMemo(
    () => hostController?.getCurrentProfile() ?? null,
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `getCurrentProfile()` is read fresh; `info.profileId`/`info.kind` are what change with it.
    [hostController, info.profileId, info.kind],
  );
  const connection = connectionStatusCopy(info.status);

  const facts: HostFact[] = [
    {
      key: "server-id",
      term: "Server id",
      testId: "host-server-id",
      value: serverId,
    },
    {
      key: "profile",
      term: "Connection profile",
      testId: "host-profile-id",
      value: info.profileId ?? "No saved profile connected",
    },
    {
      key: "kind",
      term: "Route",
      testId: "host-connection-kind",
      value: info.kind ?? "Not established",
    },
    {
      key: "status",
      term: "Status",
      testId: "host-connection-status",
      value: (
        <StatusIndicator
          label="Connection"
          tone={connection.tone}
          statusText={connection.text}
          testId="host-connection-status-indicator"
        />
      ),
    },
  ];
  if (profile?.label) {
    facts.splice(1, 0, {
      key: "profile-label",
      term: "Profile label",
      testId: "host-profile-label",
      value: profile.label,
    });
  }

  return (
    <div className="pc-host-screen" data-testid="host-screen">
      <Section title="Host" id="host-overview">
        <p className="pc-host-screen__copy">
          A host is one running pi daemon this console connects to. Sessions for it stay visible in
          the rail on the left; use the links below for its list, its settings, and the live
          connection details.
        </p>
        <dl className="pc-host-screen__facts">
          {facts.map((fact) => (
            <div className="pc-host-screen__fact" key={fact.key}>
              <dt className="pc-host-screen__term">{fact.term}</dt>
              <dd className="pc-host-screen__value" data-testid={fact.testId}>
                {fact.value}
              </dd>
            </div>
          ))}
        </dl>
      </Section>
      <Section title="Open" id="host-open">
        <ul className="pc-host-screen__links" data-testid="host-links">
          <li>
            <Link className="pc-link" to="/h/$serverId/sessions" params={{ serverId }}>
              Sessions
            </Link>
          </li>
          <li>
            <Link className="pc-link" to="/h/$serverId/settings" params={{ serverId }}>
              Settings
            </Link>
          </li>
          <li>
            <Link className="pc-link" to="/h/$serverId/diagnostics" params={{ serverId }}>
              Diagnostics
            </Link>
          </li>
        </ul>
      </Section>
    </div>
  );
}
