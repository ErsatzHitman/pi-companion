/**
 * The Phase 2 exit fixture (plan.md §13 Phase 2 "Exit": "node tests can
 * drive a complete recorded session from hello through reconnect, gap
 * recovery, extension action, and final correction without React"), T24.
 *
 * Five named chapters, each a self-contained, ordered set of `FixtureFrame`s
 * a plain Node test can replay through the real `frontend-core` modules
 * that own that behavior:
 *
 * 1. `hello`       — initial hello and `server_info` capability negotiation
 *                    (`connection/daemon-client-lifecycle.ts`, T19A). Mirrors
 *                    `@picompanion/protocol`'s recorded
 *                    `fixtures/daemon-ws/hello-capability-negotiation.json`.
 * 2. `reconnect`    — a resumed hello after a daemon restart, same client id
 *                    (`connection/daemon-client-lifecycle.ts`). Mirrors
 *                    `fixtures/daemon-ws/reconnect-with-gap.json`'s hello
 *                    pair (the gap/reset half of that fixture is exercised
 *                    directly by `timeline/fixtures/scenarios/gap-backfill.ts`
 *                    via `gapRecoveryChapter` below, so this chapter only
 *                    covers the reconnect handshake itself).
 * 3. `gapRecovery`  — reuses `timeline/fixtures/scenarios/gap-backfill.ts`
 *                    (T20B): a live seq jump opens a gap, two backfill pages
 *                    close it (`timeline/reducer.ts`'s
 *                    `planGapBackfillRequest`/`ingestTimelineWindow`).
 * 4. `extensionAction` — a Pi UI Bridge composer suggestion dispatched and
 *                    settled (`extensions/action-controller.ts`, T21C).
 *                    Mirrors `fixtures/pi-ui-bridge/composer.json`.
 * 5. `correction`   — reuses
 *                    `timeline/fixtures/scenarios/assistant-message-correction.ts`
 *                    (T20A): a live assistant row corrected in place via
 *                    `replaceMessageId`.
 *
 * As with `timeline/fixtures`, these are typed TS modules, not JSON files
 * read at runtime: this package's purity guard
 * (`../../import-guard.test.ts`, `../../.oxlintrc.json`) disallows Node
 * ambient globals (`node:fs`, etc.) under `src/`, and a static import keeps
 * this fixture loadable from any bundler — `apps/web` and `apps/android`'s
 * test suites and dev-only fixture-driven surfaces (plan.md §13 Phase 3's
 * component lab) can reuse it without a filesystem, exactly like
 * `loadTimelineFixtureScenario`.
 *
 * All ids, hostnames, and timestamps here are synthetic; none of this was
 * captured from a real daemon or Pi session. Nothing here was copied from
 * `D:\paseo`'s frontend — this only mirrors this repository's own,
 * already-ported protocol/wire fixtures and this package's own earlier
 * timeline fixtures (plan.md §5's exclusion boundary; the reference
 * checkout is behavioral documentation only, never a code source).
 */
import { loadTimelineFixtureScenario } from "../../timeline/fixtures/index.js";
import type { RecordedSessionChapter } from "./types.js";

const helloChapter: RecordedSessionChapter = {
  chapter: "hello",
  description:
    "Client connects, sends the WebSocket hello with declared capabilities, and the daemon replies with server_info advertising its feature flags.",
  planRef: "plan.md §14.2 (hello and server capability negotiation); §13 Phase 2 exit",
  frames: [
    {
      id: "hello-1",
      direction: "client_to_daemon",
      wireType: "hello",
      note: "First hello on a fresh WebSocket connection; clientId is generated locally by the client.",
      message: {
        type: "hello",
        clientId: "clid_fixture_recorded_session_0001",
        clientType: "browser",
        protocolVersion: 1,
        appVersion: "0.1.0-fixture",
        capabilities: {
          voice: false,
          pushNotifications: false,
          selective_agent_timeline: true,
          reasoning_merge_enum: true,
          custom_mode_icons: true,
          terminal_reflowable_snapshot: true,
          provider_subagents: true,
          project_updates: true,
          compact_provider_snapshots: true,
          pi_ui_bridge: true,
        },
      },
    },
    {
      id: "server-info-1",
      direction: "daemon_to_client",
      wireType: "session(status:server_info)",
      note: "Server info is delivered as a session-wrapped status message immediately after a valid hello.",
      message: {
        type: "session",
        message: {
          type: "status",
          payload: {
            status: "server_info",
            serverId: "srv_fixture_recorded_session_0001",
            hostname: "fixture-daemon",
            version: "0.1.0-fixture",
            desktopManaged: false,
            features: {
              piUiBridge: true,
              trustedDevices: true,
              rewind: true,
              workspaceMultiplicity: true,
            },
          },
        },
      },
    },
  ],
};

const reconnectChapter: RecordedSessionChapter = {
  chapter: "reconnect",
  description:
    "The client reconnects after a transient disconnect using the same clientId; the daemon treats this as a resumed hello rather than a brand-new session.",
  planRef: "plan.md §14.2 (reconnect with the same client id); §13 Phase 2 exit",
  frames: [
    {
      id: "hello-resumed-1",
      direction: "client_to_daemon",
      wireType: "hello",
      note: "Same clientId as the hello chapter's connection.",
      message: {
        type: "hello",
        clientId: "clid_fixture_recorded_session_0001",
        clientType: "browser",
        protocolVersion: 1,
        appVersion: "0.1.0-fixture",
        capabilities: {
          selective_agent_timeline: true,
          pi_ui_bridge: true,
        },
      },
    },
    {
      id: "server-info-resumed-1",
      direction: "daemon_to_client",
      wireType: "session(status:server_info)",
      note: "The daemon always answers hello with server_info, whether or not the clientId is resumed.",
      message: {
        type: "session",
        message: {
          type: "status",
          payload: {
            status: "server_info",
            serverId: "srv_fixture_recorded_session_0001",
            hostname: "fixture-daemon",
            version: "0.1.0-fixture",
            features: { piUiBridge: true, workspaceMultiplicity: true },
          },
        },
      },
    },
  ],
};

const extensionActionChapter: RecordedSessionChapter = {
  chapter: "extensionAction",
  description:
    "The prompt-arbitrage extension suggests replacing the composer draft; the user rejects it (dispatches the composer's `undo` action), and the daemon settles the action both at the RPC level and via the async pi_ui_action_result.",
  planRef:
    "plan.md §11.3 (composer), §11.7 (prompt-arbitrage), §12.3 (action round trip); §13 Phase 2 exit",
  frames: [
    {
      id: "composer-delta-1",
      direction: "daemon_to_client",
      wireType: "session(agent_stream:pi_ui_delta)",
      message: {
        type: "session",
        message: {
          type: "agent_stream",
          payload: {
            agentId: "agt_fixture_recorded_session_0001",
            timestamp: "2026-09-02T09:00:00.000Z",
            event: {
              type: "pi_ui_delta",
              provider: "pi",
              agentId: "agt_fixture_recorded_session_0001",
              revision: 1,
              delta: {
                op: "upsert",
                element: {
                  id: "arbitrage-suggestion",
                  ns: "prompt-arbitrage",
                  kind: "composer",
                  placement: "inline",
                  title: "Composer replacement suggested",
                  actions: [
                    { id: "accept", label: "Use suggestion", variant: "primary" },
                    { id: "undo", label: "Undo", variant: "secondary" },
                  ],
                  ttl: 60_000,
                },
              },
            },
          },
        },
      },
    },
    {
      id: "action-request-1",
      direction: "client_to_daemon",
      wireType: "session(pi.ui.action.request)",
      note: "User rejects the suggested rewrite and restores their original composer draft.",
      message: {
        type: "session",
        message: {
          type: "pi.ui.action.request",
          agentId: "agt_fixture_recorded_session_0001",
          actionId: "undo",
          elementId: "arbitrage-suggestion",
          payload: {},
          requestId: "req_fixture_recorded_session_action_0001",
        },
      },
    },
    {
      id: "action-response-1",
      direction: "daemon_to_client",
      wireType: "session(pi.ui.action.response)",
      message: {
        type: "session",
        message: {
          type: "pi.ui.action.response",
          payload: {
            requestId: "req_fixture_recorded_session_action_0001",
            ok: true,
            error: null,
          },
        },
      },
    },
    {
      id: "action-result-1",
      direction: "daemon_to_client",
      wireType: "session(agent_stream:pi_ui_action_result)",
      message: {
        type: "session",
        message: {
          type: "agent_stream",
          payload: {
            agentId: "agt_fixture_recorded_session_0001",
            timestamp: "2026-09-02T09:00:03.000Z",
            event: {
              type: "pi_ui_action_result",
              provider: "pi",
              result: {
                actionId: "undo",
                elementId: "arbitrage-suggestion",
                ok: true,
              },
            },
          },
        },
      },
    },
  ],
};

function timelineScenarioAsChapter(
  chapter: string,
  scenario: string,
  planRefSuffix: string,
): RecordedSessionChapter {
  const timelineScenario = loadTimelineFixtureScenario(scenario);
  return {
    chapter,
    description: timelineScenario.description,
    planRef: `${timelineScenario.planRef}; ${planRefSuffix}`,
    frames: timelineScenario.frames,
  };
}

/** Ordered chapters making up the full recorded session (plan.md §13 Phase 2 exit). */
export function loadRecordedSessionFixture(): RecordedSessionChapter[] {
  return [
    helloChapter,
    reconnectChapter,
    timelineScenarioAsChapter("gapRecovery", "gap-backfill", "§13 Phase 2 exit (gap recovery)"),
    extensionActionChapter,
    timelineScenarioAsChapter(
      "correction",
      "assistant-message-correction",
      "§13 Phase 2 exit (final correction)",
    ),
  ];
}

/** Loads one named chapter of the recorded session by name. */
export function loadRecordedSessionChapter(chapter: string): RecordedSessionChapter {
  const found = loadRecordedSessionFixture().find((candidate) => candidate.chapter === chapter);
  if (!found) {
    throw new Error(`unknown recorded-session chapter: ${chapter}`);
  }
  return found;
}

/** Chapter names, in recorded-session order. */
export function listRecordedSessionChapters(): string[] {
  return loadRecordedSessionFixture().map((chapter) => chapter.chapter);
}
