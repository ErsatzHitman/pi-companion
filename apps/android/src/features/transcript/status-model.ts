/**
 * plan.md §9.2 compact status strip — status vocabulary (T33A1).
 *
 * Flattens connection lifecycle (`DaemonClient`'s own `ConnectionState`,
 * `packages/client/src/daemon-client.ts` — `"idle" | "connecting" |
 * "connected" | "disconnected" | "disposed"`, refined here into a
 * distinct "reconnecting" once a `connecting` attempt isn't the first)
 * and session activity (`AgentLifecycleStatus`,
 * `packages/protocol/src/agent-lifecycle.ts`) into the single ordered set
 * of states the header and status strip both render, so the two
 * components never disagree about which state wins when more than one is
 * true at once — e.g. still "reconnecting" even though the agent was
 * mid-`streaming` when the socket dropped.
 *
 * Kept free of any React Native import so it is unit-testable in this
 * workspace's plain `vitest` setup — see
 * `../extensions/renderers/log-model.ts`'s doc comment for why that
 * matters here (any module that reaches `react-native` fails to import
 * under this workspace's Vitest config).
 */
import type { StatusTone } from "../../ui/primitives";

/** Every status this screen can announce, in no particular priority order. */
export const TRANSCRIPT_STATUSES = [
  "connecting",
  "connected",
  "streaming",
  "reconnecting",
  "disconnected",
  "error",
] as const;

export type TranscriptStatus = (typeof TRANSCRIPT_STATUSES)[number];

export interface TranscriptStatusViewModel {
  status: TranscriptStatus;
  tone: StatusTone;
  /** The StatusIndicator/Chip label, e.g. "Connection" — constant across states. */
  label: string;
  /** The human status word(s), e.g. "Reconnecting…" — always distinct per state. */
  statusText: string;
  /** `"<label>: <statusText>"`, the sentence a live region/TalkBack announces. */
  accessibilityAnnouncement: string;
}

const BASE_VIEW_MODELS: Record<
  TranscriptStatus,
  { tone: StatusTone; label: string; statusText: string }
> = {
  connecting: { tone: "info", label: "Connection", statusText: "Connecting…" },
  connected: { tone: "success", label: "Connection", statusText: "Connected" },
  streaming: { tone: "info", label: "Connection", statusText: "Streaming response" },
  reconnecting: { tone: "warning", label: "Connection", statusText: "Reconnecting…" },
  disconnected: { tone: "neutral", label: "Connection", statusText: "Disconnected" },
  error: { tone: "danger", label: "Connection", statusText: "Connection error" },
};

/**
 * Builds the tone + human strings for one status. `detail` folds in extra
 * context (an error message, a reconnect attempt count) without changing
 * the base word each state is keyed by, so
 * `buildTranscriptStatusViewModel(s).statusText` stays comparable across
 * calls with and without a detail.
 */
export function buildTranscriptStatusViewModel(
  status: TranscriptStatus,
  detail?: string,
): TranscriptStatusViewModel {
  const base = BASE_VIEW_MODELS[status];
  const trimmedDetail = detail?.trim();
  const statusText =
    trimmedDetail && trimmedDetail.length > 0
      ? `${base.statusText} — ${trimmedDetail}`
      : base.statusText;

  return {
    status,
    tone: base.tone,
    label: base.label,
    statusText,
    accessibilityAnnouncement: `${base.label}: ${statusText}`,
  };
}

export interface DeriveTranscriptStatusInput {
  connection: "idle" | "connecting" | "connected" | "disconnected" | "disposed";
  /** `DaemonClient`'s `{status: "connecting"; attempt: number}` payload; `1` (or absent) is the first attempt. */
  reconnectAttempt?: number;
  agentActivity?: "streaming" | "idle" | "error";
}

/**
 * Picks the single status the header/status strip should render from the
 * connection and agent-activity signals a real session actually produces.
 * Priority, highest first: an agent error, then connection loss, then a
 * reconnect in progress, then a fresh connect, then active streaming,
 * falling back to plain "connected".
 */
export function deriveTranscriptStatus(input: DeriveTranscriptStatusInput): TranscriptStatus {
  if (input.agentActivity === "error") {
    return "error";
  }
  if (input.connection === "disconnected" || input.connection === "disposed") {
    return "disconnected";
  }
  if (input.connection === "connecting" || input.connection === "idle") {
    return (input.reconnectAttempt ?? 1) > 1 ? "reconnecting" : "connecting";
  }
  if (input.agentActivity === "streaming") {
    return "streaming";
  }
  return "connected";
}
