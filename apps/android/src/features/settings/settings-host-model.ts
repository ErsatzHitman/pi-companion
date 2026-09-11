/**
 * A3's host row, as pure functions — T366.
 *
 * `HANDOFF.md` §7.5 opens the Settings screen with the host it is
 * connected to: a name, an address, and a status pill. Nothing on the
 * screen said which daemon any of its settings belonged to.
 *
 * RN-free, so every string here is proven by execution rather than by
 * source regex (`CLAUDE.md`), the same split `settings-model.ts`
 * already has with `SettingsScreen.tsx`.
 *
 * ## What the artifact's row claims, and what this one can
 *
 * The artifact reads "mbp-14 / 192.168.1.40:6768 · paired Tue". The
 * first two are real: a saved profile carries a `label` and an
 * `endpoint`. The third is not — nothing persists when a profile was
 * paired (`credential-store.ts`'s `HostProfileRecord` has no timestamp
 * field of any kind), so printing a day name would mean inventing one.
 * What IS knowable and more useful is how the daemon is reached, which
 * the record does carry: directly or through the relay, over TLS or
 * not. That replaces the invented clause rather than padding beside it.
 */
import type { DaemonConnectionPhase } from "../connect/daemon-connection-store";
import type { StatusTone } from "../../ui/primitives";

/**
 * The fields of a saved profile this row reads. A structural subset of
 * `credential-store.ts`'s `HostProfileRecord`, declared here so this
 * module stays independent of that one's secret-handling concerns —
 * and so a caller cannot accidentally hand a whole record with secrets
 * attached to a function whose output is drawn on screen.
 */
export interface SettingsHostProfileView {
  label: string;
  endpoint: string;
  kind: "direct" | "relay";
  useTls: boolean;
}

/** The row's title: the name the reader gave this host when they saved it. */
export function settingsHostTitle(profile: SettingsHostProfileView | null): string {
  if (profile === null) return "No host saved";
  const label = profile.label.trim();
  return label.length === 0 ? profile.endpoint : label;
}

/**
 * The row's detail line: where the daemon is and how it is reached.
 *
 * A relay profile's `endpoint` is the RELAY's address, not the
 * daemon's — `HostProfileRecord.endpoint`'s own doc says so — so the
 * line says "via relay" beside it rather than presenting a relay
 * address as though the daemon were sitting there.
 */
export function settingsHostDetail(profile: SettingsHostProfileView | null): string {
  if (profile === null) {
    return "Connect to a daemon to see it here";
  }
  const transport = profile.kind === "relay" ? "via relay" : "direct";
  const security = profile.useTls ? "TLS" : "no TLS";
  return `${profile.endpoint} · ${transport} · ${security}`;
}

export interface SettingsHostStatus {
  label: string;
  tone: StatusTone;
}

const PHASE_STATUS = {
  idle: { label: "Not connected", tone: "neutral" },
  connecting: { label: "Connecting", tone: "info" },
  connected: { label: "Online", tone: "success" },
  disconnected: { label: "Offline", tone: "warning" },
  disposed: { label: "Closed", tone: "neutral" },
} as const satisfies Record<DaemonConnectionPhase, SettingsHostStatus>;

/**
 * The status pill beside the host.
 *
 * Every phase gets a word, so the pill is never a bare colour, and
 * `disconnected` reads "Offline" rather than "Error": a dropped socket
 * is the ordinary state of a phone that went through a tunnel, not a
 * fault to alarm anyone about. The tone follows the same reading —
 * `warning`, not `danger`.
 */
export function settingsHostStatus(phase: DaemonConnectionPhase): SettingsHostStatus {
  return PHASE_STATUS[phase];
}

/**
 * What the whole row says as one TalkBack stop. Built here rather than
 * in the JSX so the three pieces cannot be spoken in a different order
 * than they are drawn, and so the pill's word is included — it is the
 * one part of the row a reader most needs and the least likely to be
 * announced on its own inside a wrapper.
 */
export function settingsHostAccessibilityLabel(
  profile: SettingsHostProfileView | null,
  phase: DaemonConnectionPhase,
): string {
  return `${settingsHostTitle(profile)}, ${settingsHostStatus(phase).label}, ${settingsHostDetail(profile)}`;
}
