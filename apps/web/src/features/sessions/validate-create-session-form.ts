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

  return { ok: true, draft: { provider, cwd } };
}
