/**
 * Create-session form validation (T27B2), mirroring
 * `features/connect/validate-connect-form.ts`'s pure, framework-free
 * shape: one rejected field, one human-readable error, no partially
 * valid result.
 */
import type { CreateSessionInput } from "./sessions-client.js";

export interface CreateSessionFormValues {
  provider: string;
  cwd: string;
  /** UI-W13: an optional first prompt; see `CreateSessionInput.initialPrompt`'s doc. */
  initialPrompt?: string;
}

export interface CreateSessionFormFieldErrors {
  cwd?: string;
  provider?: string;
}

export type CreateSessionFormValidation =
  | { ok: true; draft: CreateSessionInput }
  | { ok: false; errors: CreateSessionFormFieldErrors };

/** This product's daemon currently only registers the `"pi"` provider (`AGENT_PROVIDER_DEFINITIONS`). */
export const DEFAULT_SESSION_PROVIDER = "pi";

export function validateCreateSessionForm(
  values: CreateSessionFormValues,
): CreateSessionFormValidation {
  const errors: CreateSessionFormFieldErrors = {};
  const cwd = values.cwd.trim();
  const provider = values.provider.trim();

  if (!cwd) {
    errors.cwd = "Enter a working directory for the new session.";
  }
  if (!provider) {
    errors.provider = "Choose a provider for the new session.";
  }

  if (Object.keys(errors).length > 0) {
    return { ok: false, errors };
  }

  // Nothing beyond trimming is validated for `initialPrompt` (UI-W13): it
  // is genuinely optional, so an empty (or whitespace-only) value is
  // omitted from the draft entirely rather than sent as `""`, keeping a
  // blank field byte-for-byte identical to today's create call.
  const initialPrompt = (values.initialPrompt ?? "").trim();

  return {
    ok: true,
    draft: { provider, cwd, ...(initialPrompt ? { initialPrompt } : {}) },
  };
}
