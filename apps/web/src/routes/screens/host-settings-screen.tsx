import { useMemo } from "react";
import { Link, useParams } from "@tanstack/react-router";

import { useDaemonClientContext } from "../../app/daemon-client-context.js";
import { ConnectionStatus } from "../../features/connection/connection-status.js";
import {
  AgentSettingsPanel,
  ThemePreferenceControl,
  createDaemonSettingsClient,
  useAgentPicker,
  useAutoCompaction,
  useAutoRetry,
} from "../../features/settings/index.js";
import { NEW_TERMINAL_ROUTE_SEGMENT } from "../../features/terminal/terminal-route-params.js";
import { Icon, Section, Select } from "../../ui/primitives/index.js";
import "./host-settings-screen.css";

/**
 * `/h/:serverId/settings` screen body (T27S2 placeholder, T38B2 built the
 * settings surface, T131 mounts it here).
 *
 * `AgentSettingsPanel` (auto-compaction / auto-retry toggles) is wired to
 * `useDaemonClientContext()`'s live client (T53A1) through
 * `createDaemonSettingsClient` — both settings now have a real wire (auto-
 * compaction since T131, auto-retry since wire-apps-followup), so a current
 * client resolves both to real controls. CORRECTED (wire-apps-followup):
 * this previously said "(auto-compaction, since T131; auto-retry remains
 * `\"unsupported\"`, disclosed and gated". That was true when written
 * and is false now. `useAgentPicker` (from `features/settings`) resolves
 * which agent those settings target — defaulting to the most recently
 * updated agent, changeable through the picker. WEB-SETTINGS-1 deleted
 * this route's former second fetch, `useCurrentAgentId`: it resolved the
 * same most-recently-updated agent as `useAgentPicker`'s own default via
 * an independent `fetchAgents` call and emitted the identical empty-state
 * string, so it was purely redundant. While there is no client, or no
 * agent yet, the panel still mounts (proving it renders on this route
 * regardless), but both rows render their own truthful `"no-client"`
 * state via `agentId: ""` —
 * `useAutoCompaction`/`useAutoRetry` key off `client` being present, not
 * `agentId` being non-empty, so this never throws.
 *
 * UI-X3: also the header gear's own destination once the reference's
 * pixel-for-pixel top bar (`docs/ui-reference/pi-companion-web.html`'s
 * `.bar-tools`, which holds only `#settings-btn`) left no room in the
 * header for the connection badge or the session's Files/Terminal links.
 * Both moved onto this route rather than a new surface (this route is
 * already "the Settings/gear menu" — the gear has linked here since
 * T131) with their `data-testid`s carried over unchanged
 * (`shell-files-link`/`shell-terminal-link`). The Files/Terminal links
 * need a session to point at and this route has no `agentId` param of
 * its own (`/h/$serverId/settings`), so they target the same
 * most-recently-updated agent this screen already resolves for its own
 * Agent picker below (`effectiveAgentId`) — truthfully hidden behind a
 * note, never a dead link, when the host has no agent yet.
 */
export function HostSettingsScreen() {
  const { serverId } = useParams({ strict: false }) as { serverId?: string };
  const { client } = useDaemonClientContext();
  const picker = useAgentPicker(client);

  const settingsClient = useMemo(
    () => (client ? createDaemonSettingsClient(client) : undefined),
    [client],
  );

  const effectiveAgentId = picker.selectedAgentId ?? "";
  const autoCompaction = useAutoCompaction({ agentId: effectiveAgentId, client: settingsClient });
  const autoRetry = useAutoRetry({ agentId: effectiveAgentId, client: settingsClient });

  const pickerOptions =
    picker.status === "ready"
      ? picker.agents.map((option) => ({
          value: option.id,
          label: option.title ? `${option.title} (${option.id})` : option.id,
        }))
      : [];

  return (
    <>
      <Section title="Connection">
        <ConnectionStatus />
      </Section>
      <Section title="Navigation">
        {serverId && effectiveAgentId ? (
          <div className="pc-settings-nav">
            <Link
              className="pc-settings-nav-link"
              to="/h/$serverId/session/$agentId/files/$"
              params={{ serverId, agentId: effectiveAgentId, _splat: "" }}
              data-testid="shell-files-link"
            >
              <Icon name="folder" className="pc-settings-nav-link-icon" />
              <span>Files</span>
            </Link>
            <Link
              className="pc-settings-nav-link"
              to="/h/$serverId/session/$agentId/terminal/$terminalId"
              params={{
                serverId,
                agentId: effectiveAgentId,
                terminalId: NEW_TERMINAL_ROUTE_SEGMENT,
              }}
              data-testid="shell-terminal-link"
            >
              <Icon name="terminal" className="pc-settings-nav-link-icon" />
              <span>Terminal</span>
            </Link>
          </div>
        ) : (
          <p className="pc-agent-settings__note">Open a session to reach its files and terminal.</p>
        )}
      </Section>
      <Section title="Agent">
        {picker.status === "ready" ? (
          <Select
            label="Agent"
            options={pickerOptions}
            value={effectiveAgentId}
            onChange={(event) => picker.selectAgent(event.target.value)}
            testId="host-settings-agent-picker"
          />
        ) : picker.status === "loading" || picker.status === "idle" ? (
          <p className="pc-agent-settings__note">Loading agents…</p>
        ) : (
          <p className="pc-agent-settings__note">{picker.reason}</p>
        )}
      </Section>
      {/*
        The Theme control is a real, persisted System/Light/Dark choice
        (`features/settings/ThemePreferenceControl.tsx` +
        `styles/theme-preference.ts`). It lives on this route rather than
        in a slide-over sheet: this route is the one axe/route-coverage
        guards and the header gear links to, and that
        sheet-vs-route shape is a recorded product decision — the
        reference's 420px sheet was not adopted.
      */}
      <Section title="Appearance">
        <ThemePreferenceControl testId="host-settings-theme" />
      </Section>
      <AgentSettingsPanel
        autoCompaction={autoCompaction}
        autoRetry={autoRetry}
        testId="host-settings-agent-settings"
      />
    </>
  );
}
