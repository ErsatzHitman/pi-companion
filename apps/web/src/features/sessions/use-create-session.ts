/**
 * Create-session dialog state (T27B2).
 *
 * Owns the create-session form's draft fields, submit lifecycle, and
 * error surfacing. A failed `client.createSession` call leaves `cwd`/
 * `provider` exactly as the user typed them (T27B2's "a failed create
 * surfaces an error without losing typed input" acceptance criterion):
 * only a *successful* create clears the draft and closes the dialog.
 */
import { useCallback, useRef, useState } from "react";

import type { SessionsClient } from "./sessions-client.js";
import type { SessionSummary } from "./types.js";
import {
  DEFAULT_SESSION_PROVIDER,
  validateCreateSessionForm,
} from "./validate-create-session-form.js";
import type { CreateSessionFormFieldErrors } from "./validate-create-session-form.js";

export type CreateSessionPhase = "idle" | "submitting" | "error";

export interface UseCreateSessionOptions {
  client: SessionsClient;
  /** Called with the newly created session once the daemon acknowledges it. */
  onCreated?: (session: SessionSummary) => void;
}

export interface CreateSessionController {
  open: boolean;
  cwd: string;
  provider: string;
  phase: CreateSessionPhase;
  errors: CreateSessionFormFieldErrors;
  /** The raw daemon error message from the last failed attempt, if any. */
  errorMessage: string | null;
  openDialog: () => void;
  closeDialog: () => void;
  setCwd: (value: string) => void;
  setProvider: (value: string) => void;
  submit: () => Promise<void>;
}

export function useCreateSession(options: UseCreateSessionOptions): CreateSessionController {
  const { client, onCreated } = options;
  const [open, setOpen] = useState(false);
  const [cwd, setCwd] = useState("");
  const [provider, setProvider] = useState(DEFAULT_SESSION_PROVIDER);
  const [phase, setPhase] = useState<CreateSessionPhase>("idle");
  const [errors, setErrors] = useState<CreateSessionFormFieldErrors>({});
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // A plain ref, not `phase` state, drives the double-submit/close-while-
  // submitting guards below so `closeDialog` can stay referentially
  // stable (`[]` deps) across every `cwd`/`provider` keystroke.
  // `useModalBehavior` (via `Dialog`) re-runs its focus-management effect
  // whenever `onClose`'s identity changes, and it moves focus to the
  // panel's first focusable field when it does — a fresh `closeDialog`
  // on every keystroke would re-steal focus out of whichever field the
  // user is actively typing into after each character.
  const submittingRef = useRef(false);

  const openDialog = useCallback((): void => {
    setOpen(true);
    setPhase("idle");
    setErrors({});
    setErrorMessage(null);
  }, []);

  const closeDialog = useCallback((): void => {
    if (submittingRef.current) return; // never abandon an in-flight request
    setOpen(false);
  }, []);

  const submit = useCallback(async (): Promise<void> => {
    // Dialog's confirm button has no `disabled` affordance to lean on,
    // so guard the double-submit case here instead.
    if (submittingRef.current) return;

    const result = validateCreateSessionForm({ provider, cwd });
    if (!result.ok) {
      setErrors(result.errors);
      setErrorMessage(null);
      return;
    }

    setErrors({});
    setErrorMessage(null);
    submittingRef.current = true;
    setPhase("submitting");
    try {
      const session = await client.createSession(result.draft);
      submittingRef.current = false;
      setPhase("idle");
      setOpen(false);
      setCwd("");
      setProvider(DEFAULT_SESSION_PROVIDER);
      onCreated?.(session);
    } catch (error) {
      submittingRef.current = false;
      setPhase("error");
      setErrorMessage(error instanceof Error ? error.message : String(error));
    }
  }, [client, cwd, onCreated, provider]);

  return {
    open,
    cwd,
    provider,
    phase,
    errors,
    errorMessage,
    openDialog,
    closeDialog,
    setCwd,
    setProvider,
    submit,
  };
}
