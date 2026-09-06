/**
 * Connect form validation — plan.md §8.3, §12.1, T27A1.
 *
 * Pure, framework-free validation for the `/connect` form's raw string
 * inputs. Parses a `host:port` (or `[ipv6]:port`) address by hand rather
 * than depending on `@picompanion/protocol` from `apps/web` (that
 * package is not among this app's declared dependencies, and
 * `@picompanion/frontend-core`'s `hosts` module — which this feature
 * already depends on for `ConnectionProber` — does not re-export a raw
 * parser). Every rejected address surfaces exactly one, human-readable,
 * field-scoped error string that `ConnectForm` renders through
 * `TextField`'s `error` prop, never a raw exception.
 *
 * A successful validation produces a `ConnectDraft`: the subset of
 * `@picompanion/frontend-core`'s `HostProfileDraft`/`HostProfile` shape
 * needed to attempt a direct connection (`attempt-host-connection.ts`)
 * and, when a `password`/access-token was entered, to authenticate it
 * (`authenticate-host.ts`, T27A2) through the `paseo.bearer.<token>`
 * subprotocol. An empty token means "this daemon has no password": the
 * field is entirely omitted from the draft (never sent as `""`), so
 * `authenticate-host.ts` and `@picompanion/frontend-core`'s
 * `DaemonClientLifecycle` never attach an `Authorization` header or a
 * `paseo.bearer.` subprotocol for an unauthenticated daemon.
 */

export interface ConnectFormValues {
  /** Optional human-readable label; an empty value derives one from the host. */
  label: string;
  /** Raw `host:port` (or `[ipv6]:port`) address, exactly as typed. */
  address: string;
  useTls: boolean;
  /** Optional daemon access token/password, exactly as typed; never persisted or logged in its raw form by this module. */
  password?: string;
}

export interface ConnectFormFieldErrors {
  address?: string;
}

export interface ConnectDraft {
  label: string;
  direct: { endpoint: string; useTls: boolean };
  preferDirect: true;
  /** Present only when a non-empty access token was entered. */
  password?: string;
}

export type ConnectFormValidation =
  | { ok: true; draft: ConnectDraft }
  | { ok: false; errors: ConnectFormFieldErrors };

interface ParsedHostAddress {
  host: string;
  port: number;
  isIpv6: boolean;
}

const IPV6_PATTERN = /^\[([^\]]+)\]:(\d{1,5})$/;
const HOST_PORT_PATTERN = /^([^:\s]+):(\d{1,5})$/;

function parsePort(raw: string): number {
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("Port must be between 1 and 65535.");
  }
  return port;
}

/**
 * Parses `host:port` (e.g. `localhost:6767`) or `[ipv6]:port` (e.g.
 * `[::1]:6767`) address input. Throws a message-only `Error` describing
 * exactly what is wrong; never returns a partially-valid result.
 */
export function parseHostAddress(input: string): ParsedHostAddress {
  const trimmed = input.trim();
  if (!trimmed) {
    throw new Error("Enter a host address.");
  }

  if (trimmed.startsWith("[")) {
    const match = IPV6_PATTERN.exec(trimmed);
    if (!match) {
      throw new Error("Enter an IPv6 host and port, like [::1]:6767.");
    }
    const host = match[1]!.trim();
    if (!host) {
      throw new Error("Enter a host address.");
    }
    return { host, port: parsePort(match[2]!), isIpv6: true };
  }

  const match = HOST_PORT_PATTERN.exec(trimmed);
  if (!match) {
    throw new Error("Enter a host and port, like localhost:6767.");
  }
  const host = match[1]!.trim();
  if (!host) {
    throw new Error("Enter a host address.");
  }
  return { host, port: parsePort(match[2]!), isIpv6: false };
}

/**
 * Validates a raw `ConnectFormValues` and, when the address is well
 * formed, builds the `ConnectDraft` `attempt-host-connection.ts` and
 * (eventually) `HostProfileStore.save` consume. An empty `label`
 * derives its value from the parsed host, matching
 * `@picompanion/frontend-core`'s `deriveLabelFromEndpoint` convention.
 */
export function validateConnectForm(values: ConnectFormValues): ConnectFormValidation {
  let parsed: ParsedHostAddress;
  try {
    parsed = parseHostAddress(values.address);
  } catch (error) {
    return {
      ok: false,
      errors: { address: error instanceof Error ? error.message : String(error) },
    };
  }

  const endpoint = parsed.isIpv6
    ? `[${parsed.host}]:${parsed.port}`
    : `${parsed.host}:${parsed.port}`;
  const label = values.label.trim() || parsed.host;
  const password = values.password?.trim() ?? "";

  return {
    ok: true,
    draft: {
      label,
      direct: { endpoint, useTls: values.useTls },
      preferDirect: true,
      ...(password ? { password } : {}),
    },
  };
}
