/**
 * `ConnectionShell` outcome model — T32A8 ("Complete the connect-to-
 * session-list path").
 *
 * Pure, React/React-Native-free logic for what a successful or failed
 * connect attempt (either path — `ConnectForm`'s direct submit, or
 * `QrPairingPanel`'s relay pairing) should persist and where it should
 * send the user next. Kept out of `connection-shell.tsx` itself for the
 * same reason every other `-model.ts` in this feature is split from its
 * `.tsx` (`connect-form-model.ts`, `qr-scan-model.ts`): this workspace's
 * `vitest` setup cannot import any module that reaches `react-native`
 * (`../../CLAUDE.md`'s "VITEST LIMITATION" note), so every rule here is
 * proven directly, and `connection-shell.tsx` is a thin, source-text-
 * proven caller of it.
 *
 * ## The gap this closes
 *
 * Found at the P5-W16 merge gate: `credential-store.ts`'s
 * `saveHostProfile` had no caller anywhere, and nothing navigated after
 * a successful connect, so `core-context.tsx`'s cold-start restore (a
 * stored profile skipping `/connect` straight to `/h/:serverId/
 * sessions`) was unreachable in practice — nothing ever stored a
 * profile for it to find. This module is the missing translation from
 * "a connect attempt just succeeded" to "the `HostProfileRecord` (and
 * any secrets) that belongs in `credential-store.ts`, and the
 * `/h/:serverId/sessions` href to navigate to" — `connection-shell.tsx`
 * is what actually calls `saveHostProfile` and navigates, but every
 * *decision* about what to save and where to go lives here, unit-tested
 * without a component render.
 *
 * ## Profile identity
 *
 * Neither connect path has a real `HostProfileStore`-style id generator
 * (`packages/frontend-core/src/hosts/host-profile-store.ts`'s
 * `defaultCreateIdFactory` belongs to a persistence path Android's
 * `credential-store.ts` deliberately does not use — see that module's
 * own docstring). Rather than inventing a random-id generator this
 * workspace has no precedent for (React Native's Hermes has historically
 * lacked `crypto.randomUUID()`), both paths derive a stable id from data
 * the connection itself already carries, uniquely:
 *
 *  - Direct connect: `ParsedConnectAddress.endpoint` (`host:port`, or
 *    `[host]:port` for IPv6) — two direct profiles for the same host:port
 *    are the same host, so collapsing them onto one saved id (last
 *    connect wins) is correct, not a bug.
 *  - Relay pairing: `RelayHostConnectionProfile.serverId` — the offer's
 *    own daemon identity, already unique by construction
 *    (`hosts.hostProfileDraftFromConnectionOffer`).
 *
 * This also makes `destinationHref({ type: "sessionList", serverId })`
 * trivial: `serverId` is just the saved profile's own `id`, exactly as
 * `core-context.tsx`'s cold-start redirect already assumes
 * (`destinationHref({ type: "sessionList", serverId: profile.id })`).
 *
 * ## Closed: relay profiles are now reconnectable (T66)
 *
 * `credential-store.ts`'s `HostProfileRecord` (`id`, `label`, `endpoint`,
 * `useTls`, `isIpv6`) was designed for the direct-connect path (T32A2,
 * before T32A5's relay work existed) and used to carry no
 * `daemonPublicKeyB64`/E2EE-pin field a relay reconnect would need. T66
 * widened it with a `kind: "direct" | "relay"` discriminator and wired
 * `HostProfileSecrets.relayKey` (previously never populated by any
 * caller) to actually carry the relay's E2EE pin —
 * `buildRelayHostProfile` below now stamps `kind: "relay"` and
 * `derivePairingOutcome` now saves that pin through `secureStorage`,
 * never `plainStorage`. `host-profile-reconnect.ts`'s
 * `createReconnectHostProfile` is the new module that turns a restored
 * `(HostProfileRecord, HostProfileSecrets)` pair back into a live
 * connection attempt for either `kind` — `connection-shell-model.test.ts`
 * covers the *build* half (this module); `host-profile-reconnect.test.ts`
 * covers the *reconnect* half, proven against the same injected-transport
 * seam `apply-connection-offer.test.ts` and `daemon-connect-attempt.
 * fixture.test.ts` already use.
 *
 * ## Closed: a saved profile is reconnectable from the UI (T32S14)
 *
 * `createReconnectHostProfile` above had zero production callers until
 * this task: `connection-shell.tsx` used to hand `ConnectForm` an always-
 * empty `profiles` list (see that component's old doc comment), so
 * `ConnectFormValidation`'s `"existing"` mode was structurally
 * unreachable from the UI no matter how complete `host-profile-
 * reconnect.ts` was. `ConnectionShell` now loads the real saved-profile
 * list (`credential-store.ts`'s `listHostProfiles`) and passes it
 * through, and `deriveReconnectOutcome` below is the new "existing
 * profile" mirror of `deriveConnectSubmitOutcome` that turns a real
 * reconnect attempt's result into what to do next — see that function's
 * own doc comment.
 */
import type { ConnectFormDraft } from "./connect-form-model.js";
import type { ConnectAttemptResult } from "./daemon-connect-attempt.js";
import type { ApplyConnectionOfferSuccess } from "./apply-connection-offer.js";
import type { HostProfileRecord, HostProfileSecrets } from "./credential-store.js";
import type { ReconnectResult } from "./host-profile-reconnect.js";
import { destinationHref } from "../../app-shell/top-level-destinations.js";

/** The `/h/:serverId/sessions` href for an already-saved (or about-to-be-saved) profile id. Single source of this translation — never re-derived inline. */
export function sessionListHref(profileId: string): string {
  return destinationHref({ type: "sessionList", serverId: profileId });
}

/**
 * The `HostProfileRecord` a successful `ConnectForm` submission should
 * save. `label` falls back to the parsed host when the user left
 * "Profile name" blank — `connect-form-model.ts`'s own docstring
 * documents this exact fallback, previously implemented nowhere (no
 * caller of `saveHostProfile` existed at all).
 */
export function buildDirectHostProfile(draft: ConnectFormDraft): HostProfileRecord {
  return {
    id: draft.parsed.endpoint,
    label: draft.profileName || draft.parsed.host,
    kind: "direct",
    endpoint: draft.parsed.endpoint,
    useTls: draft.parsed.useTls,
    isIpv6: draft.parsed.isIpv6,
  };
}

/** `credential-store.ts`'s `HostProfileSecrets` shape for a direct connect's optional password. `{}` when none was supplied — `saveHostProfile` never touches `SecureStorage` in that case. */
export function directHostProfileSecrets(password?: string): HostProfileSecrets {
  return password ? { password } : {};
}

export type ConnectSubmitOutcome =
  | {
      kind: "connected";
      profile: HostProfileRecord;
      secrets: HostProfileSecrets;
      href: string;
    }
  | {
      /** Named failure state (T32A8's second acceptance criterion): distinct from `"connected"` so a caller — and a test — can assert nothing is saved and nowhere is navigated to without inspecting `error` first. */
      kind: "failed";
      error: string;
    };

/**
 * Turns one `ConnectForm` submission's parsed draft plus the
 * `DaemonConnectionStore.connect()` result it produced into what
 * `connection-shell.tsx` should do next. A failure carries no `profile`/
 * `secrets`/`href` at all — the type itself makes "saves nothing, sends
 * nowhere" true by construction, not by a caller remembering to skip a
 * step.
 */
export function deriveConnectSubmitOutcome(
  draft: ConnectFormDraft,
  password: string | undefined,
  result: ConnectAttemptResult,
): ConnectSubmitOutcome {
  if (!result.ok) {
    return { kind: "failed", error: result.error };
  }
  const profile = buildDirectHostProfile(draft);
  return {
    kind: "connected",
    profile,
    secrets: directHostProfileSecrets(password),
    href: sessionListHref(profile.id),
  };
}

/**
 * The `HostProfileRecord` a successful QR/pasted-offer pairing
 * (`QrPairingPanel`'s `onPaired`) should save. `isIpv6` is computed from
 * the relay's own bracketed-or-not `endpoint` string
 * (`RelayHostConnectionProfile.endpoint`, `host:port` or
 * `[host]:port` — same convention `connect-form-model.ts`'s
 * `parseConnectAddress` uses) since `hosts.RelayHostConnectionProfile`
 * carries no separate boolean for it.
 */
export function buildRelayHostProfile(result: ApplyConnectionOfferSuccess): HostProfileRecord {
  return {
    id: result.relay.serverId,
    label: result.label,
    kind: "relay",
    endpoint: result.relay.endpoint,
    useTls: result.relay.useTls,
    isIpv6: result.relay.endpoint.startsWith("["),
  };
}

/**
 * `HostProfileSecrets` for a successful relay pairing (T66) — carries
 * the offer's own `daemonPublicKeyB64` as `relayKey`, the one value a
 * later reconnect (`host-profile-reconnect.ts`) must pin against. Split
 * out from `derivePairingOutcome` so it is independently testable, the
 * same reason `directHostProfileSecrets` is split from
 * `deriveConnectSubmitOutcome`. There is no password to carry here: a
 * completed `ApplyConnectionOfferSuccess` never returns the password the
 * caller offered (see `apply-connection-offer.ts`'s module doc, "never
 * persisted by this module") — a relay profile with a daemon password
 * reconnects without one and relies on `host-profile-reconnect.ts`'s
 * `wrong-password` classification if that daemon still requires it.
 */
export function relayHostProfileSecrets(result: ApplyConnectionOfferSuccess): HostProfileSecrets {
  return { relayKey: result.relay.daemonPublicKeyB64 };
}

/**
 * A completed pairing always succeeded by the time `onPaired` fires
 * (`qr-scan-model.ts`'s `handleScannedText` only ever calls `onPaired`
 * from its `paired` branch) — so, unlike the direct path, there is no
 * `"failed"` outcome to derive here; a failed pairing attempt stays on
 * the scan surface showing `qr-scan-model.ts`'s own `"error"` phase and
 * never reaches this function at all.
 */
export function derivePairingOutcome(result: ApplyConnectionOfferSuccess): {
  profile: HostProfileRecord;
  secrets: HostProfileSecrets;
  href: string;
} {
  const profile = buildRelayHostProfile(result);
  return { profile, secrets: relayHostProfileSecrets(result), href: sessionListHref(profile.id) };
}

/**
 * `ConnectionShell`'s "existing profile" outcome (T32S14) — the mirror
 * of `deriveConnectSubmitOutcome` above, for a saved profile reconnected
 * through `host-profile-reconnect.ts`'s `createReconnectHostProfile`
 * rather than a fresh `ConnectForm` submission. `profile.id` never
 * changes on a reconnect (it is what identified the saved profile in
 * the first place), so `href` reuses the exact same `sessionListHref`
 * translation `deriveConnectSubmitOutcome`/`derivePairingOutcome` do —
 * no new href-building logic to duplicate or drift.
 *
 * A failure carries `pinMismatch` straight through from
 * `ReconnectFailure`, unmodified — `host-profile-reconnect.ts`'s own
 * doc comment on that field ("must never be treated the same as `kind
 * === 'unreachable'`") is a contract on the *value*, not on how far it
 * travels; this function is the one place it crosses from
 * `ReconnectResult` into what `connection-shell.tsx` renders, and it
 * does not re-derive or discard it.
 */
export type ReconnectSubmitOutcome =
  | {
      kind: "reconnected";
      lifecycle: Extract<ReconnectResult, { ok: true }>["lifecycle"];
      path: Extract<ReconnectResult, { ok: true }>["path"];
      href: string;
    }
  | {
      kind: "failed";
      error: string;
      pinMismatch: boolean;
    };

export function deriveReconnectOutcome(
  profile: HostProfileRecord,
  result: ReconnectResult,
): ReconnectSubmitOutcome {
  if (!result.ok) {
    return { kind: "failed", error: result.error, pinMismatch: result.pinMismatch };
  }
  return {
    kind: "reconnected",
    lifecycle: result.lifecycle,
    path: result.path,
    href: sessionListHref(profile.id),
  };
}
