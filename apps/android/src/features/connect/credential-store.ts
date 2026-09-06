/**
 * Credential storage policy for saved host profiles (plan.md §7.3, §12.1
 * "SecureStore for credentials and relay secrets"; §14.2 "store Android
 * passwords and relay secrets in SecureStore"; T32A2).
 *
 * Kept free of any React Native or Expo import — like `./connect-form-
 * model.ts` — so the policy is unit-testable without a device/emulator.
 * `../../platform/secure-storage.ts` is the thin Expo adapter that backs
 * the `SecureStorage` parameter at runtime; this module never imports it
 * and never imports `expo-secure-store` itself, so it can be exercised
 * in `vitest` against an in-memory fake of the same interface (see
 * `credential-store.test.ts`).
 *
 * The one rule this whole module exists to enforce: a daemon password
 * and a relay key are secrets and MUST go through `SecureStorage`
 * only — never through `KeyValueStorage` (the AsyncStorage-backed plain
 * sink a later task wires in), and never through `Logger`. That is
 * enforced *structurally*, not by convention:
 *
 *  - `HostProfileRecord`, the only shape ever handed to `plainStorage`,
 *    has no field that can hold a password or relay key — there is no
 *    string property on it a caller could mistakenly stash a secret in.
 *  - `HostProfileSecrets` is the only shape ever handed to
 *    `secureStorage`, and `saveHostProfile` never passes it, or any
 *    string drawn from it, to `plainStorage`.
 *  - `redactHostProfileForLogging` — the only function in this module
 *    that produces a `Logger`-shaped value — takes secrets only to
 *    compute two booleans (`hasPassword`, `hasRelayKey`); it has no
 *    branch that can copy a secret string into its return value.
 *
 * `credential-store.test.ts` proves this by saving a profile carrying a
 * real password and relay key against in-memory fakes, then asserting
 * neither secret substring ever reaches the fake plain sink or the fake
 * logger's recorded calls.
 *
 * **T66 ("Make a relay-paired profile reconnectable")**: `kind` is new
 * on `HostProfileRecord` — `connection-shell-model.ts`'s
 * `buildDirectHostProfile`/`buildRelayHostProfile` now stamp it, and
 * `host-profile-reconnect.ts`'s `createReconnectHostProfile` reads it to
 * decide which of the two connection shapes (`hosts.
 * DirectHostConnectionProfile` vs `hosts.RelayHostConnectionProfile`) to
 * rebuild a stored record into. `relayKey` — despite its name and its
 * original "private key material" doc here, corrected below — is what
 * actually closes T32A8's disclosed gap: a relay pairing's E2EE pin
 * (`hosts.RelayHostConnectionProfile.daemonPublicKeyB64`), the value a
 * relay reconnect must pin its `DaemonClientLifecycle` against. It is a
 * *public* key by cryptographic construction (`hosts/types.ts`'s
 * `RelayHostConnectionProfile` docstring: "not a secret by itself"), but
 * this module still routes it through `SecureStorage` only, never
 * `plainStorage`: a value that identifies *which daemon this app trusts*
 * deserves the same tamper-resistance a password gets, and reusing the
 * existing secret slot (rather than adding a third, differently-guarded
 * one) keeps the "every secret through `SecureStorage`, never
 * `KeyValueStorage`, never `Logger`" structural guarantee above true
 * without adding a fourth bullet to prove.
 */

import type { KeyValueStorage, LogFields, Logger, SecureStorage } from "@picompanion/frontend-core";

/** Which connection shape a saved profile was reached through — `host-profile-reconnect.ts`'s `createReconnectHostProfile` branches on this to know which secret (if any) and which URL builder a reconnect needs. */
export type HostProfileKind = "direct" | "relay";

/** A saved profile's non-secret identity and connection shape. Never carries a password or relay key. */
export interface HostProfileRecord {
  id: string;
  label: string;
  /** Whether this profile was reached directly or through the relay (T66) — see `host-profile-reconnect.ts`. */
  kind: HostProfileKind;
  /**
   * `host:port`, or `[host]:port` for an IPv6 host — see
   * `connect-form-model.ts`'s `ParsedConnectAddress.endpoint` for a
   * `kind: "direct"` record. For `kind: "relay"`, this is the *relay's*
   * own `host:port` (`hosts.RelayHostConnectionProfile.endpoint`), not a
   * directly-reachable daemon address — `id` doubles as the relay's
   * `serverId` for that case (see `connection-shell-model.ts`'s
   * `buildRelayHostProfile`).
   */
  endpoint: string;
  useTls: boolean;
  isIpv6: boolean;
}

/** The two kinds of secret this policy recognizes. Both are optional — a profile may have neither, either, or both. */
export interface HostProfileSecrets {
  /** The daemon's own password, used for direct `paseo.bearer.<token>` auth — on either `kind`, since a relay-tunnelled daemon can also require one (T32A5). */
  password?: string;
  /**
   * A `kind: "relay"` profile's E2EE pin — `hosts.
   * RelayHostConnectionProfile.daemonPublicKeyB64` (plan.md §12.1
   * "Relay profiles retain the daemon public key ... private material
   * never enters a URL query"). Named `relayKey` rather than
   * `daemonPublicKeyB64` for stability (every existing caller and test
   * already spells it this way); see this module's doc comment for why
   * it is treated as secret-shaped despite being cryptographically
   * public.
   */
  relayKey?: string;
}

/** The dependencies this module needs, injected so it stays React Native-free and unit-testable. */
export interface CredentialStoreDeps {
  secureStorage: SecureStorage;
  /** The plain, non-secret sink — `apps/android`'s Expo SQLite/AsyncStorage-backed `KeyValueStorage`. */
  plainStorage: KeyValueStorage;
  /** Optional; when supplied, `saveHostProfile` logs one redacted `info` line per save through it. */
  logger?: Logger;
}

const PLAIN_KEY_PREFIX = "picompanion:host-profile:";
const SECRET_KIND = { password: "password", relayKey: "relay-key" } as const;

function plainKey(id: string): string {
  return `${PLAIN_KEY_PREFIX}${id}`;
}

/**
 * The `SecureStorage` key for one profile's one secret. Exported so
 * tests (and, if ever needed, a migration/debug tool) can name a key
 * without duplicating this format — never call `secureStorage` with a
 * hand-built string elsewhere in this module.
 */
export function secureStorageKey(id: string, kind: keyof HostProfileSecrets): string {
  return `picompanion:secure:host-profile:${id}:${SECRET_KIND[kind]}`;
}

/** Loggable, secret-free view of a profile plus which secrets it has — never the secrets themselves. */
export interface LoggableHostProfile extends LogFields {
  id: string;
  label: string;
  kind: HostProfileKind;
  endpoint: string;
  useTls: boolean;
  hasPassword: boolean;
  hasRelayKey: boolean;
}

/**
 * Builds the only shape this module ever hands to a `Logger`. Takes
 * `secrets` solely to compute presence booleans — it has no code path
 * that returns a secret's value.
 */
export function redactHostProfileForLogging(
  profile: HostProfileRecord,
  secrets: HostProfileSecrets = {},
): LoggableHostProfile {
  return {
    id: profile.id,
    label: profile.label,
    kind: profile.kind,
    endpoint: profile.endpoint,
    useTls: profile.useTls,
    hasPassword: Boolean(secrets.password),
    hasRelayKey: Boolean(secrets.relayKey),
  };
}

/**
 * Persists a host profile: the non-secret record to `plainStorage`, and
 * any password/relay key to `secureStorage`, each under its own
 * per-profile key. If `secrets` carries anything and `secureStorage`
 * reports itself unavailable, this throws *before writing anything* —
 * a profile is never left saved without the credentials it needs, and
 * a caller is never tempted to fall back to the plain sink.
 */
export async function saveHostProfile(
  deps: CredentialStoreDeps,
  profile: HostProfileRecord,
  secrets: HostProfileSecrets = {},
): Promise<void> {
  const hasSecrets = Boolean(secrets.password || secrets.relayKey);
  if (hasSecrets && !(await deps.secureStorage.isAvailable())) {
    throw new Error(
      `Secure storage is not available on this device — cannot save credentials for profile "${profile.id}".`,
    );
  }

  await deps.plainStorage.setItem(plainKey(profile.id), JSON.stringify(profile));

  if (secrets.password) {
    await deps.secureStorage.setSecret(secureStorageKey(profile.id, "password"), secrets.password);
  }
  if (secrets.relayKey) {
    await deps.secureStorage.setSecret(secureStorageKey(profile.id, "relayKey"), secrets.relayKey);
  }

  deps.logger?.info("connect: saved host profile", redactHostProfileForLogging(profile, secrets));
}

/** Reads back a profile's secrets. A field that was never saved (or was already removed) reads as `undefined`. */
export async function loadHostProfileSecrets(
  deps: CredentialStoreDeps,
  id: string,
): Promise<HostProfileSecrets> {
  const [password, relayKey] = await Promise.all([
    deps.secureStorage.getSecret(secureStorageKey(id, "password")),
    deps.secureStorage.getSecret(secureStorageKey(id, "relayKey")),
  ]);
  return {
    password: password ?? undefined,
    relayKey: relayKey ?? undefined,
  };
}

/** Lists every saved profile's non-secret record — never their secrets. */
export async function listHostProfiles(deps: CredentialStoreDeps): Promise<HostProfileRecord[]> {
  const keys = await deps.plainStorage.keys(PLAIN_KEY_PREFIX);
  const records = await Promise.all(
    keys.map(async (key) => {
      const raw = await deps.plainStorage.getItem(key);
      return raw ? (JSON.parse(raw) as HostProfileRecord) : null;
    }),
  );
  return records.filter((record): record is HostProfileRecord => record !== null);
}

/**
 * Removes one profile's plain record and both of its possible secrets.
 * Safe to call for a profile that never had one or the other — removing
 * an absent `SecureStorage` key is a no-op there, not an error.
 */
export async function clearHostProfile(deps: CredentialStoreDeps, id: string): Promise<void> {
  await Promise.all([
    deps.plainStorage.removeItem(plainKey(id)),
    deps.secureStorage.removeSecret(secureStorageKey(id, "password")),
    deps.secureStorage.removeSecret(secureStorageKey(id, "relayKey")),
  ]);
}

/**
 * Logout: clears every saved profile's plain record and both of its
 * secrets, so nothing pairing-related survives sign-out. Reads the
 * profile list first (rather than guessing ids), so it removes exactly
 * what was actually saved — no more, no less.
 */
export async function clearAllHostProfiles(deps: CredentialStoreDeps): Promise<void> {
  const profiles = await listHostProfiles(deps);
  await Promise.all(profiles.map((profile) => clearHostProfile(deps, profile.id)));
}
