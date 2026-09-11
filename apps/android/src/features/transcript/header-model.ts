/**
 * plan.md §9.2 host/session header — view model (T33A1), restyled into
 * the redesign's S7 app bar by T351.
 *
 * Pure mapping from session identity (host label, session/agent title,
 * working directory) plus the shared `TranscriptStatus`
 * (`./status-model.ts`) to the strings `header.tsx` renders. Split out
 * from the component for the same reason as `status-model.ts`: no React
 * Native import, so it is directly unit-testable under this workspace's
 * plain `vitest` setup.
 *
 * **T351 changed what `subtitle` means, deliberately.** It used to be
 * the host label, sitting under the session title inside a `Section`.
 * The redesign's bar puts a mono line beside the title and that line is
 * the session's working directory — the one piece of identity a user
 * reading a transcript actually needs and cannot infer, since every
 * session on a host shares the host and only the cwd says which project
 * is being worked on. The host is not lost: it stays in
 * `accessibilityLabel`, which is the sentence TalkBack reads out, and it
 * is the heading of the session list this bar navigates back to.
 *
 * **The pill has its own tone table, not the status strip's.** They
 * report different things and must be allowed to disagree.
 * `buildTranscriptStatusViewModel` describes the CONNECTION ("Connected",
 * in green, because a live socket is good news). The bar's pill answers
 * "what is this session doing right now", where a healthy idle session is
 * the resting state and deserves the artifact's neutral `idle` pill, not
 * a green one that makes every screenshot look busy. `chipLabel` is
 * therefore a short word chosen for a 26dp pill rather than the strip's
 * fuller sentence, and any status detail reaches the user through
 * `accessibilityLabel` instead of being crammed into the pill.
 *
 * **The missing half of that answer is `activity`.** Connection alone
 * could never produce the artifact's `Thinking`/`Working`/`Needs you`
 * cycle — `streaming` was unreachable because no route ever derived an
 * agent-activity signal, and a pending approval had no pill state at
 * all. `./session-activity-signal.ts` derives it from the live
 * `agent_stream` and this model gives it priority over the connection
 * while it is active. A pending approval is the one state that must
 * never be missable: it becomes `Needs you`, exactly as the artifact
 * promises twice.
 */
import { buildTranscriptStatusViewModel, type TranscriptStatus } from "./status-model";
import type { SessionActivity } from "./session-activity-signal";
import type { StatusTone } from "../../ui/primitives";

export interface TranscriptHeaderInput {
  /** Host/server display name, e.g. "macbook-pro.local". Announced, not drawn — see this module's doc comment. */
  hostLabel: string;
  /** Session/agent display title. Falls back to a placeholder when blank. */
  sessionTitle: string;
  /**
   * The session's working directory, as the daemon's own agent snapshot
   * reports it (`AgentSnapshotPayloadSchema`'s `cwd`). Absent until that
   * snapshot arrives, and absent forever with no connection — the bar
   * simply draws no subtitle in that case rather than a placeholder,
   * because an invented path is worse than none.
   */
  cwd?: string;
  status: TranscriptStatus;
  statusDetail?: string;
  /**
   * What the session itself is doing (`./session-activity-signal.ts`).
   * Defaults to `"idle"`, which falls through to the connection-derived
   * pill below — so a caller that has no live signal (a lab, a test) gets
   * exactly the connection status it always got.
   */
  activity?: SessionActivity;
}

export interface TranscriptHeaderViewModel {
  title: string;
  /** The working directory's basename, or `""` when there is no cwd to show. */
  subtitle: string;
  tone: StatusTone;
  /** The short status word shown on the bar's pill, e.g. "Working". */
  chipLabel: string;
  /** Whether the pill draws its leading dot — see `SESSION_PILL_STATES`. */
  showDot: boolean;
  /** Full sentence for the bar's live-region accessibility label. */
  accessibilityLabel: string;
}

const UNTITLED_SESSION = "Untitled session";

/**
 * The four pill states the design artifact draws (`run`, `wait`, `idle`,
 * `info`), spread across the six statuses this app actually distinguishes.
 *
 * The dot is drawn for every state that means something is happening or
 * has gone wrong, and withheld from the two resting states — the
 * artifact's own split, which is also the one that keeps the dot
 * meaningful: a dot on every pill is a dot that says nothing. Colour is
 * never the only signal either way (plan.md §10.5); the word always
 * names the state.
 */
export const SESSION_PILL_STATES = {
  connecting: { word: "Connecting", tone: "info", showDot: true },
  connected: { word: "Idle", tone: "neutral", showDot: false },
  streaming: { word: "Working", tone: "success", showDot: true },
  reconnecting: { word: "Reconnecting", tone: "warning", showDot: true },
  disconnected: { word: "Offline", tone: "neutral", showDot: false },
  error: { word: "Error", tone: "danger", showDot: true },
} as const satisfies Record<TranscriptStatus, { word: string; tone: StatusTone; showDot: boolean }>;

/**
 * The three ACTIVE session states, in the artifact's own vocabulary.
 * `idle` is deliberately absent: it has no pill of its own, because the
 * resting state is whatever the connection says ("Idle" when
 * connected, "Offline"/"Reconnecting" when not) and a second Idle
 * would be able to disagree with it.
 *
 * **The words are the reference's; two of the tones are the closest
 * `StatusTone` role, and that is a primitive boundary rather than a
 * preference.** The artifact draws `Thinking` on `.pill.info`
 * (`extension-bg`/`purple`) and `Working` on `.pill.run`
 * (`accent-tint`/`accent-ink`); `StatusTone` (`ui/primitives/
 * StatusIndicator.tsx`) exposes five roles and `StatusPill` maps them
 * to its tints, so neither the purple nor a distinct run tint can be
 * invented here. `warning` on `Needs you` is exact (`.pill.wait` =
 * `orange-tint`/`orange`). Colour is never the only signal either way
 * (plan.md §10.5) — the word always names the state.
 */
export const SESSION_ACTIVITY_PILL_STATES = {
  thinking: { word: "Thinking", tone: "info", showDot: true },
  working: { word: "Working", tone: "success", showDot: true },
  "needs-you": { word: "Needs you", tone: "warning", showDot: true },
} as const satisfies Record<
  Exclude<SessionActivity, "idle">,
  { word: string; tone: StatusTone; showDot: boolean }
>;

/**
 * The full sentence each active state contributes to the announced
 * label — the pill's word plus what it means, because the header's
 * wrapper is ONE accessibility node and the pill's own text is not read
 * on its own (`header.tsx`'s doc comment). `needs-you` states the
 * promise the artifact makes twice: the turn is waiting for the user.
 */
const SESSION_ACTIVITY_ANNOUNCEMENTS = {
  thinking: "Thinking.",
  working: "Working.",
  "needs-you": "Waiting for your approval.",
} as const satisfies Record<Exclude<SessionActivity, "idle">, string>;

/**
 * The last segment of a working directory, for the bar's mono subtitle.
 *
 * Splits on both separators rather than picking one: the daemon reports
 * whatever its own host uses, so a Windows daemon answers
 * `C:\work\pi-companion` and a Linux one `/home/a/pi-companion`, and this
 * app cannot tell which by looking at its own platform. Trailing
 * separators are ignored so `/a/b/` and `/a/b` agree, and a path with no
 * segment at all (`/`, or an absent cwd) yields `""`, on which the bar
 * draws no subtitle rather than an empty one. A bare drive root
 * (`C:\`) does have a segment and reports it as `C:` — an odd-looking
 * subtitle, but a truthful one, and a session actually rooted at a drive
 * is not a case worth a special rule.
 */
export function deriveCwdBasename(cwd: string | undefined): string {
  if (!cwd) return "";
  const segments = cwd.split(/[/\\]+/).filter((segment) => segment.length > 0);
  const last = segments[segments.length - 1];
  return last ?? "";
}

export function buildTranscriptHeaderViewModel({
  hostLabel,
  sessionTitle,
  cwd,
  status,
  statusDetail,
  activity = "idle",
}: TranscriptHeaderInput): TranscriptHeaderViewModel {
  const title = sessionTitle.trim().length > 0 ? sessionTitle : UNTITLED_SESSION;
  const subtitle = deriveCwdBasename(cwd);
  // The session's own activity wins over the connection when it is
  // active — see this module's doc comment and
  // `./session-activity-signal.ts` for the priority the activity itself
  // already resolved.
  const pill =
    activity === "idle" ? SESSION_PILL_STATES[status] : SESSION_ACTIVITY_PILL_STATES[activity];
  // The strip's fuller sentence, detail and all. Never drawn on the
  // pill; announced, so a status detail (a socket error's message, a
  // reconnect attempt count) still reaches someone who cannot see the
  // transcript underneath.
  const announced = buildTranscriptStatusViewModel(status, statusDetail).statusText;
  const place = subtitle.length > 0 ? `${subtitle} on ${hostLabel}` : hostLabel;
  const activityAnnouncement =
    activity === "idle" ? "" : ` ${SESSION_ACTIVITY_ANNOUNCEMENTS[activity]}`;

  return {
    title,
    subtitle,
    tone: pill.tone,
    chipLabel: pill.word,
    showDot: pill.showDot,
    accessibilityLabel: `${title}, in ${place}. ${announced}.${activityAnnouncement}`,
  };
}
