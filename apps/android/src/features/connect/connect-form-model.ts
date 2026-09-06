/**
 * Connect form model — plan.md §9.2/§12.1, T32A1 ("Build the Android
 * connect form").
 *
 * Pure, framework-free validation and accessibility-string building for
 * the `/connect` screen's two inputs: which profile to use (an existing
 * saved one, or the details for a new direct connection) and, for a new
 * connection, the daemon's `ws://`/`wss://` address. Kept free of any
 * React Native import — like `../extensions/renderers/log-model.ts` — so
 * it is unit-testable in this workspace; `ConnectForm.tsx` is a thin view
 * over this module, per the workspace's "put every rule in an RN-free
 * model" pattern (`registry.test.ts`, `sessions-model.test.ts`).
 *
 * Deliberately narrower than `apps/web/src/features/connect/
 * validate-connect-form.ts`: the web form's `host:port` + a separate
 * "Use TLS" toggle is that app's own T27A1 design. This task's own
 * acceptance criteria ask specifically to reject "a missing scheme, a
 * bad port, a non-numeric port, an empty host" — so the Android address
 * field takes one self-describing string (`ws://host:port` or
 * `wss://host:port`) and this module is the sole place that decides
 * whether it is well formed, never a regex duplicated into the view.
 *
 * **Profile selection** here means choosing between "New profile" (enter
 * a fresh address below) and any already-known profile passed in via
 * `profiles` — the caller-supplied, non-secret `{ id, label }` pairs a
 * later task (T32A2, "Store credentials in SecureStore") is expected to
 * source from a persisted `HostProfileStore` list. This task owns no
 * storage adapter itself (`apps/android/src/app/core.ts` is out of this
 * task's `Owns:` grant, and the task is explicit that this form "must
 * not write anything to SecureStore or AsyncStorage"), so `profiles`
 * defaults to empty and selecting an existing profile only reports which
 * one was chosen — reconnecting to it is later tasks' work.
 */

/** Sentinel `profileId` meaning "the user is entering a new host's details", never a real saved profile's id. */
export const NEW_PROFILE_ID = "new" as const;

/** A saved profile's non-secret display identity — never carries an endpoint, password, or relay key (those stay out of this RN-free, storage-free module entirely). */
export interface ConnectProfileOption {
  id: string;
  label: string;
}

/** One entry `ConnectForm`'s `Select` renders: `NEW_PROFILE_ID` first, then every `ConnectProfileOption` in `profiles`. */
export interface ConnectProfileSelectOption {
  value: string;
  label: string;
}

export function buildProfileSelectOptions(
  profiles: readonly ConnectProfileOption[],
): ConnectProfileSelectOption[] {
  return [
    { value: NEW_PROFILE_ID, label: "New profile" },
    ...profiles.map((profile) => ({ value: profile.id, label: profile.label })),
  ];
}

/** Raw, as-typed form state — every field a plain string/id, validated only on submit. */
export interface ConnectFormValues {
  profileId: string;
  /** Optional free-text name for a new profile; only meaningful when `profileId === NEW_PROFILE_ID`. */
  profileName: string;
  /** Raw `ws://host:port` (or `wss://host:port`) address; only meaningful when `profileId === NEW_PROFILE_ID`. */
  address: string;
}

export interface ConnectFormFieldErrors {
  profileId?: string;
  address?: string;
}

export interface ParsedConnectAddress {
  scheme: "ws" | "wss";
  host: string;
  port: number;
  useTls: boolean;
  isIpv6: boolean;
  /** `host:port`, or `[host]:port` for an IPv6 host — the shape `@picompanion/frontend-core`'s `DirectHostConnectionProfile.endpoint` expects. */
  endpoint: string;
}

export interface ConnectFormDraft {
  profileName: string;
  parsed: ParsedConnectAddress;
}

export type ConnectFormValidation =
  | { ok: true; mode: "new"; draft: ConnectFormDraft }
  | { ok: true; mode: "existing"; profile: ConnectProfileOption }
  | { ok: false; errors: ConnectFormFieldErrors };

export type ConnectAddressErrorKind =
  | "empty-host"
  | "missing-scheme"
  | "unsupported-scheme"
  | "missing-port"
  | "non-numeric-port"
  | "port-out-of-range"
  | "malformed-ipv6";

export type ParseConnectAddressResult =
  | { ok: true; value: ParsedConnectAddress }
  | { ok: false; kind: ConnectAddressErrorKind; error: string };

const SCHEME_PATTERN = /^([a-zA-Z][a-zA-Z0-9+.-]*):\/\/(.*)$/;
const IPV6_HOST_PORT_PATTERN = /^\[([^\]]*)\](?::(.*))?$/;
const HOST_PORT_PATTERN = /^([^:\s]+):(.*)$/;

const EXAMPLE = "ws://192.168.1.10:6767";

/**
 * Parses a `ws://host:port` / `wss://host:port` (or bracketed-IPv6-host)
 * address, exactly as the field's acceptance criterion names each
 * rejection: a missing scheme, a bad (out-of-range) port, a non-numeric
 * port, and an empty host. Every branch returns exactly one human
 * readable, field-scoped message — this is the single source of that
 * text; `ConnectForm.tsx` never re-derives or duplicates it.
 */
export function parseConnectAddress(input: string): ParseConnectAddressResult {
  const trimmed = input.trim();
  if (!trimmed) {
    return { ok: false, kind: "empty-host", error: `Enter a host address, like ${EXAMPLE}.` };
  }

  const schemeMatch = SCHEME_PATTERN.exec(trimmed);
  if (!schemeMatch) {
    return {
      ok: false,
      kind: "missing-scheme",
      error: `Host address needs a scheme — start it with ws:// or wss://, like ${EXAMPLE}.`,
    };
  }

  const scheme = schemeMatch[1]!.toLowerCase();
  if (scheme !== "ws" && scheme !== "wss") {
    return {
      ok: false,
      kind: "unsupported-scheme",
      error: `"${schemeMatch[1]}://" isn't supported — use ws:// or wss://, like ${EXAMPLE}.`,
    };
  }

  const rest = schemeMatch[2]!.trim();
  if (!rest) {
    return { ok: false, kind: "empty-host", error: `Enter a host, like ${EXAMPLE}.` };
  }

  let host: string;
  let portRaw: string | undefined;
  let isIpv6 = false;

  if (rest.startsWith("[")) {
    const ipv6Match = IPV6_HOST_PORT_PATTERN.exec(rest);
    if (!ipv6Match) {
      return {
        ok: false,
        kind: "malformed-ipv6",
        error: `Enter an IPv6 host and port, like ${scheme}://[::1]:6767.`,
      };
    }
    isIpv6 = true;
    host = ipv6Match[1]!.trim();
    portRaw = ipv6Match[2];
    if (!host) {
      return { ok: false, kind: "empty-host", error: `Enter a host, like ${scheme}://[::1]:6767.` };
    }
  } else {
    const hostPortMatch = HOST_PORT_PATTERN.exec(rest);
    if (!hostPortMatch) {
      return {
        ok: false,
        kind: "missing-port",
        error: `Enter a host and port, like ${EXAMPLE}.`,
      };
    }
    host = hostPortMatch[1]!.trim();
    portRaw = hostPortMatch[2];
    if (!host) {
      return { ok: false, kind: "empty-host", error: `Enter a host, like ${EXAMPLE}.` };
    }
  }

  if (!portRaw) {
    return { ok: false, kind: "missing-port", error: `Enter a port, like ${EXAMPLE}.` };
  }
  if (!/^\d+$/.test(portRaw)) {
    return {
      ok: false,
      kind: "non-numeric-port",
      error: `Port must be a number, like ${EXAMPLE}.`,
    };
  }
  const port = Number(portRaw);
  if (port < 1 || port > 65535) {
    return { ok: false, kind: "port-out-of-range", error: "Port must be between 1 and 65535." };
  }

  const endpoint = isIpv6 ? `[${host}]:${port}` : `${host}:${port}`;
  return {
    ok: true,
    value: {
      scheme: scheme as "ws" | "wss",
      host,
      port,
      useTls: scheme === "wss",
      isIpv6,
      endpoint,
    },
  };
}

/**
 * Validates the whole form. Choosing an existing profile skips address
 * parsing entirely (there is nothing to type); choosing "New profile"
 * requires a well-formed address (`profileName` stays optional — an
 * empty name is not an error, `ConnectForm.tsx` falls back to the parsed
 * host, matching `apps/web`'s `validateConnectForm` label convention).
 */
export function validateConnectForm(
  values: ConnectFormValues,
  profiles: readonly ConnectProfileOption[],
): ConnectFormValidation {
  if (values.profileId !== NEW_PROFILE_ID) {
    const profile = profiles.find((candidate) => candidate.id === values.profileId);
    if (!profile) {
      return { ok: false, errors: { profileId: "Select a profile to continue." } };
    }
    return { ok: true, mode: "existing", profile };
  }

  const parsed = parseConnectAddress(values.address);
  if (!parsed.ok) {
    return { ok: false, errors: { address: parsed.error } };
  }

  return {
    ok: true,
    mode: "new",
    draft: { profileName: values.profileName.trim(), parsed: parsed.value },
  };
}

/** Accessibility hint (`accessibilityHint`) for the address `TextField` — always present, independent of any error, so TalkBack states the expected format up front. */
export const ADDRESS_FIELD_HINT =
  "Starts with ws:// for a plain connection or wss:// for a secure one, followed by host and port, " +
  `like ${EXAMPLE}.`;

/**
 * A single TalkBack-facing announcement summarizing every current field
 * error, for the status `Banner` shown after a failed submit — each
 * field also carries its own error inline (via `TextField`'s
 * `error`/`accessibilityLabel` fold and `Select`'s own accessible
 * label), so this is a second, redundant announcement point rather than
 * the only one. Returns `undefined` when there is nothing to report.
 */
export function buildErrorSummaryMessage(errors: ConnectFormFieldErrors): string | undefined {
  const messages = [errors.profileId, errors.address].filter((message): message is string =>
    Boolean(message),
  );
  if (messages.length === 0) return undefined;
  if (messages.length === 1) return messages[0];
  return `Fix ${messages.length} problems before connecting: ${messages.join(" ")}`;
}
