/**
 * Session rename validation (T38A4, plan.md §7.1/§11.1's "rename"
 * command). Pure and framework-free, mirroring
 * `validate-create-session-form.ts`'s shape: one rejected field (there
 * is only one field here), one human-readable error, no partially
 * valid result.
 *
 * The bound and character policy are matched, deliberately, against the
 * one daemon-enforced session-title constraint that exists today:
 * `AgentSessionConfigSchema.title` (`@picompanion/protocol`'s
 * `messages.ts`) is
 * `z.string().trim().min(1).max(MAX_EXPLICIT_AGENT_TITLE_CHARS)` —
 * trimmed, non-empty after trimming, at most
 * `MAX_EXPLICIT_AGENT_TITLE_CHARS` (200) characters, with **no**
 * character-set restriction beyond that: any Unicode text the daemon
 * would already accept for a session's title at creation time.
 *
 * No dedicated `set_session_name` wire validation exists yet — see
 * `daemon-sessions-client.ts`'s `renameAgent` doc for that disclosed
 * protocol/client gap (T38A0 only mirrored `set_session_name` for the
 * daemon's own local Pi RPC use, not a client-reachable message). Until
 * one does, reusing the create-time bound rather than inventing a
 * second, unverified number is the defensible choice: a rename writes
 * the exact same `title` field a create does, and `MAX_EXPLICIT_AGENT_
 * TITLE_CHARS` is the only number in this codebase the daemon is
 * actually, verifiably enforcing for that field today.
 */
import { MAX_EXPLICIT_AGENT_TITLE_CHARS } from "@picompanion/protocol/agent-title-limits";

export { MAX_EXPLICIT_AGENT_TITLE_CHARS };

export type SessionNameValidation = { ok: true; name: string } | { ok: false; error: string };

/**
 * Validates and bounds a candidate session name. Trims first (matching
 * the daemon schema's `.trim()`, which runs before `.min()`/`.max()`
 * apply), so a name that is only whitespace is rejected as empty rather
 * than as "too long" or accepted as a name of pure whitespace.
 */
export function validateSessionName(raw: string): SessionNameValidation {
  const name = raw.trim();

  if (name.length === 0) {
    return { ok: false, error: "Enter a name for this session." };
  }
  if (name.length > MAX_EXPLICIT_AGENT_TITLE_CHARS) {
    return {
      ok: false,
      error: `Names can be at most ${MAX_EXPLICIT_AGENT_TITLE_CHARS} characters (this one is ${name.length}).`,
    };
  }

  return { ok: true, name };
}
