/**
 * Secret-shaped key/value detection — T60A, plan.md §7/§14.
 *
 * Before this module, two independent "is this secret-shaped?" pattern
 * lists existed, written in the same wave, each with a hole the P5-W9
 * merge gate proved by running its own probe:
 *
 *  - `apps/android/src/features/transcript/tool-call-row-model.ts` (T33A4)
 *    redacted by key-name substring and value-shape, but its value
 *    patterns were `^...$`-anchored, so a secret embedded in a longer
 *    string survived verbatim — the exact shape a shell-ish unknown tool
 *    call produces, e.g. `{"command": "curl -H 'Authorization: Bearer
 *    sk-LIVEKEY1234567890' https://api.example.com"}`.
 *  - `apps/android/src/platform/offline/sqlite-structured-storage.ts`
 *    (T37A) matched key names *exactly*, so `accessToken`, `refreshToken`,
 *    `relayPassword`, and `sessionCookie` — every one a realistic field
 *    name that merely *contains* a secret-shaped word rather than *being*
 *    one — sailed through and were stored in plaintext.
 *
 * This module is the one place both pattern lists now live. It answers
 * only "is this key or value secret-shaped?" — each call site keeps its
 * own *reaction* to a "yes" (the transcript row redacts to `[redacted]`
 * and keeps rendering; the offline cache throws and refuses the write
 * entirely). Collapsing those two reactions into one behaviour was
 * explicitly out of scope: T37A's "never persist a secret, ever" bound
 * is stricter than a UI redaction and must stay a hard failure.
 *
 * ## What this is defence in depth *for*, and what it is not
 *
 * This is defence in depth against two accidents, not a security
 * boundary:
 *
 *  1. **Accidental display** (`tool-call-row-model.ts`): an arbitrary,
 *     unrecognized tool call's arguments or result may legitimately
 *     contain a token, password, or cookie a plugin author never meant
 *     the user to see rendered in the transcript.
 *  2. **Accidental persistence** (`sqlite-structured-storage.ts`): a
 *     value shape that should have gone through `SecureStorage` gets
 *     handed to the plain offline cache by mistake.
 *
 * **The primary control is architectural, not pattern-matching: nothing
 * in this codebase's call paths ever hands a real secret to either of
 * these functions in the first place.** Daemon passwords and relay keys
 * go through `SecureStorage` only (see
 * `apps/android/src/features/connect/credential-store.ts`'s header for
 * the structural argument on that path — no string property on the
 * types it persists can even hold a secret). This module exists for the
 * case that discipline slips, or an unrecognized third-party tool call
 * hands back something it shouldn't.
 *
 * **A pattern list can never be complete.** `isSecretShapedKey` only
 * recognizes key names built from a fixed vocabulary of English words
 * ("token", "password", "bearer", …); a field named e.g. `pw` or `k` in
 * a language other than English passes through untouched.
 * `isSecretShapedValue` only recognizes a handful of well-known token
 * *shapes* (`sk-…`, `ghp_…`, `xox…-…`, a JWT, an `Authorization: Bearer`
 * clause, or a long hex/base64 blob) — a novel secret shape, or a secret
 * with no distinguishing shape at all (a short plain-English passphrase,
 * a numeric PIN), passes through both functions undetected. Neither
 * function is a substitute for keeping secrets out of these code paths.
 */

/**
 * Case-insensitive substring match against a field/key name — a real
 * key is rarely exactly `"token"`; it is `accessToken`, `refreshToken`,
 * `relayPassword`, `sessionCookie`, `X-Api-Key`, `daemonKey`. Each
 * fragment below targets a specific, real key vocabulary rather than a
 * bare word like `"key"` that would also match ordinary fields such as
 * `keyboardVisible` — see `secret-shape.test.ts`'s explicit
 * false-positive guard for that exact name.
 */
const SECRET_KEY_PATTERN =
  /token|secret|password|passwd|api[_-]?key|relay[_-]?key|daemon[_-]?key|private[_-]?key|auth(?:orization)?|credential|bearer|cookie/i;

/** True when `key` looks like the name of a field that would hold a secret. */
export function isSecretShapedKey(key: string): boolean {
  return SECRET_KEY_PATTERN.test(key);
}

/**
 * High-confidence token *shapes*, matched as a substring anywhere in a
 * string (deliberately unanchored — this is the fix for the "embedded
 * in a longer string" hole above). Each targets a real, common secret
 * shape rather than "any long string", so ordinary long text (a
 * sentence, a file path, a UUID) does not trip these.
 */
const EMBEDDED_SECRET_VALUE_PATTERNS: readonly RegExp[] = [
  /\bsk-[A-Za-z0-9]{10,}/, // OpenAI-style API key
  /\bgh[pousr]_[A-Za-z0-9]{20,}/, // GitHub personal-access/app/user/... tokens
  /\bxox[baprs]-[A-Za-z0-9-]{10,}/, // Slack tokens
  /\bBearer\s+\S{10,}/i, // an "Authorization: Bearer <token>" clause
  /\b[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/, // JWT-shaped
];

/**
 * Lower-confidence shapes: plain hex and base64 charsets. These are
 * common *substrings* of ordinary long text (file content, encoded
 * blobs, hashes, binary dumps rendered as text) — searching for them
 * unanchored inside an arbitrary string would false-positive constantly.
 * Checked only against the *entire* trimmed value, so they only fire
 * when the whole value looks like nothing but a secret.
 */
const WHOLE_VALUE_SECRET_PATTERNS: readonly RegExp[] = [
  /^[A-Fa-f0-9]{32,}$/, // long hex (API keys, hashes, secrets)
  /^[A-Za-z0-9+/]{40,}={0,2}$/, // long base64 (no separators — not a path/URL)
];

/**
 * True when `value` itself, or a high-confidence token shape embedded
 * anywhere within it, looks secret-shaped. Unlike the anchored patterns
 * this module replaces, this catches a secret embedded in a longer
 * string (e.g. a full shell command) as well as a value that is nothing
 * but the secret.
 */
export function isSecretShapedValue(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return false;
  }
  if (EMBEDDED_SECRET_VALUE_PATTERNS.some((pattern) => pattern.test(value))) {
    return true;
  }
  return WHOLE_VALUE_SECRET_PATTERNS.some((pattern) => pattern.test(trimmed));
}

/**
 * Convenience combinator: true when either the key hint or the value
 * itself looks secret-shaped. Equivalent to
 * `(keyHint !== undefined && isSecretShapedKey(keyHint)) ||
 * isSecretShapedValue(value)`, exported so a call site that has both a
 * key and a value in hand (the common case) doesn't need to spell that
 * out itself.
 */
export function isSecretShaped(value: string, keyHint?: string): boolean {
  if (keyHint !== undefined && isSecretShapedKey(keyHint)) {
    return true;
  }
  return isSecretShapedValue(value);
}
