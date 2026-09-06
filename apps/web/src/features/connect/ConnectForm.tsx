import { useState } from "react";
import type { FormEvent } from "react";

import { Banner } from "../../ui/primitives/Banner.js";
import { Button } from "../../ui/primitives/Button.js";
import { Card } from "../../ui/primitives/Card.js";
import { Divider } from "../../ui/primitives/Divider.js";
import { Section } from "../../ui/primitives/Section.js";
import { TextField } from "../../ui/primitives/TextField.js";
import { Toggle } from "../../ui/primitives/Toggle.js";
import type { ApplyConnectionOfferOutcome } from "./apply-connection-offer.js";
import type { ConnectAndAuthenticateOutcome } from "./authenticate-host.js";
import { QrCaptureSheet } from "./QrCaptureSheet.js";
import { validateConnectForm } from "./validate-connect-form.js";
import type { ConnectDraft, ConnectFormFieldErrors } from "./validate-connect-form.js";

export interface ConnectFormProps {
  /**
   * Attempts the validated connection "through core"
   * (`authenticate-host.ts`'s `ConnectAndAuthenticateAttempt`, backed by
   * `hosts.ConnectionProber` and `connection.DaemonClientLifecycle`).
   * Injected so this component stays presentational and testable
   * without a real socket.
   */
  onAttempt: (draft: ConnectDraft) => Promise<ConnectAndAuthenticateOutcome>;
  /**
   * Applies a pasted `ConnectionOffer` pairing link (T27A3): parses it,
   * proves it still connects, and — only then — persists the resulting
   * relay-only profile. Wired to `apply-connection-offer.ts`'s
   * `createApplyConnectionOfferAttempt` in production; omitted in tests
   * that do not exercise the "pair with a link" affordance.
   */
  onApplyOffer?: (input: string) => Promise<ApplyConnectionOfferOutcome>;
  /**
   * Clears a saved profile's stored credentials (T27A2's "logout").
   * Wired to `authenticate-host.ts`'s `forgetHostCredentials` in
   * production; omitted in tests that do not exercise the post-success
   * "Forget saved credentials" action.
   */
  onForget?: (profileId: string) => Promise<void>;
}

type AttemptPhase = "idle" | "connecting" | "success" | "unreachable" | "auth-failed";
type OfferPhase = "idle" | "applying" | "success" | "malformed" | "wrong-daemon-key" | "expired";

/**
 * The `/connect` form (plan.md §8.3, T27A1/T27A2): host label, host
 * address, TLS, and an optional daemon access token, composed entirely
 * from existing primitives. Client-side validation
 * (`validate-connect-form.ts`) rejects a malformed address with a
 * visible, named error before any connection attempt is made; valid
 * input hands a `ConnectDraft` to `onAttempt`, which probes reachability
 * and — when a token was entered — verifies the daemon accepts it
 * through the `paseo.bearer.<token>` subprotocol before persisting the
 * profile and token. A successful, previously-saved connection exposes
 * "Forget saved credentials" so a user can sign out without leaving the
 * form (never a bare colour cue: the affordance is a labelled button
 * inside the status banner).
 *
 * A second, independent block (T27A3) applies a pasted `ConnectionOffer`
 * pairing link: a valid offer populates `label` with the profile it
 * derives and attempts a real relay connection through `onApplyOffer`;
 * a malformed link is rejected before any attempt, and one whose relay
 * connection fails is reported as expired — two distinct, named
 * outcomes, each surfaced through its own status banner so the two
 * pairing paths (direct vs. offer) never overwrite each other's status.
 *
 * That same offer path also accepts a camera-scanned QR code (T27A4):
 * "Scan QR code" opens `QrCaptureSheet`, whose decoded payload is fed
 * through the same `applyOfferValue` helper a pasted link uses — so
 * scanning and pasting are two entry points into one pairing attempt,
 * not two code paths to keep in sync. `QrCaptureSheet` itself explains
 * a denied or missing camera with its own status banner and always
 * offers a way back to this manual-entry field.
 */
export function ConnectForm({ onAttempt, onApplyOffer, onForget }: ConnectFormProps) {
  const [label, setLabel] = useState("");
  const [address, setAddress] = useState("");
  const [useTls, setUseTls] = useState(false);
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<ConnectFormFieldErrors>({});
  const [phase, setPhase] = useState<AttemptPhase>("idle");
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [savedProfileId, setSavedProfileId] = useState<string | null>(null);
  const [forgetting, setForgetting] = useState(false);

  const [offerInput, setOfferInput] = useState("");
  const [offerPhase, setOfferPhase] = useState<OfferPhase>("idle");
  const [offerMessage, setOfferMessage] = useState<string | null>(null);
  const [offerProfileId, setOfferProfileId] = useState<string | null>(null);
  const [offerForgetting, setOfferForgetting] = useState(false);
  const [qrOpen, setQrOpen] = useState(false);

  const submitting = phase === "connecting";
  const applyingOffer = offerPhase === "applying";

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const result = validateConnectForm({ label, address, useTls, password });
    if (!result.ok) {
      setErrors(result.errors);
      setPhase("idle");
      setStatusMessage(null);
      setSavedProfileId(null);
      return;
    }

    setErrors({});
    setPhase("connecting");
    setSavedProfileId(null);
    setStatusMessage(`Connecting to ${result.draft.label}…`);
    try {
      const outcome = await onAttempt(result.draft);
      if (outcome.ok) {
        setPhase("success");
        setStatusMessage(
          result.draft.password
            ? `Signed in to ${result.draft.label}.`
            : `Reached ${result.draft.label}.`,
        );
        setSavedProfileId(outcome.savedProfileId);
      } else if (!outcome.reachable) {
        setPhase("unreachable");
        setStatusMessage(`Could not reach ${result.draft.label}. Check the address and try again.`);
      } else {
        setPhase("auth-failed");
        setStatusMessage(outcome.error ?? `Could not sign in to ${result.draft.label}.`);
      }
    } catch (error) {
      setPhase("unreachable");
      setStatusMessage(error instanceof Error ? error.message : "Connection attempt failed.");
    }
  }

  async function handleForget(): Promise<void> {
    if (!onForget || !savedProfileId) return;
    setForgetting(true);
    try {
      await onForget(savedProfileId);
      setSavedProfileId(null);
      setPassword("");
      setPhase("idle");
      setStatusMessage("Forgot the saved credentials for this daemon.");
    } finally {
      setForgetting(false);
    }
  }

  async function applyOfferValue(value: string): Promise<void> {
    if (!onApplyOffer) return;
    setOfferPhase("applying");
    setOfferProfileId(null);
    setOfferMessage("Applying pairing link\u2026");
    try {
      const outcome = await onApplyOffer(value);
      if (outcome.ok) {
        setOfferPhase("success");
        setOfferMessage(outcome.label ? `Paired with ${outcome.label}.` : "Paired successfully.");
        setOfferProfileId(outcome.savedProfileId);
        if (outcome.label) setLabel(outcome.label);
      } else if (outcome.kind === "malformed") {
        setOfferPhase("malformed");
        setOfferMessage(outcome.error ?? "This pairing link isn't valid.");
      } else if (outcome.kind === "wrong-daemon-key") {
        // T27A6: a wrong daemon key is a distinct failure from a wrong
        // password or a merely-unreachable relay, so it gets its own
        // phase and its own (already-classified) message rather than
        // falling into the generic "expired" copy below.
        setOfferPhase("wrong-daemon-key");
        setOfferMessage(
          outcome.error ??
            "This pairing link's daemon key no longer matches. Ask for a new pairing link.",
        );
      } else {
        setOfferPhase("expired");
        setOfferMessage(outcome.error ?? "This pairing link is no longer valid.");
      }
    } catch (error) {
      setOfferPhase("expired");
      setOfferMessage(error instanceof Error ? error.message : "Applying the pairing link failed.");
    }
  }

  async function handleApplyOffer(): Promise<void> {
    await applyOfferValue(offerInput);
  }

  /** T27A4: a scanned QR payload is the same offer string a pasted link
   * is, so it is applied through the identical `applyOfferValue` path
   * ("A scanned offer completes pairing"). The field is populated too,
   * so the status banner and any "Forget saved credentials" affordance
   * that follow read the same way a pasted link would have produced. */
  async function handleScannedOffer(value: string): Promise<void> {
    setQrOpen(false);
    setOfferInput(value);
    await applyOfferValue(value);
  }

  async function handleForgetOffer(): Promise<void> {
    if (!onForget || !offerProfileId) return;
    setOfferForgetting(true);
    try {
      await onForget(offerProfileId);
      setOfferProfileId(null);
      setOfferInput("");
      setOfferPhase("idle");
      setOfferMessage("Forgot the saved credentials for this daemon.");
    } finally {
      setOfferForgetting(false);
    }
  }

  const bannerTone =
    phase === "success"
      ? "success"
      : phase === "connecting"
        ? "info"
        : phase === "idle"
          ? "info"
          : "danger";

  const offerBannerTone =
    offerPhase === "success"
      ? "success"
      : offerPhase === "applying"
        ? "info"
        : offerPhase === "idle"
          ? "info"
          : "danger";

  return (
    <Section title="Connect">
      <Card>
        <form onSubmit={(event) => void handleSubmit(event)} noValidate>
          <TextField
            label="Host label"
            value={label}
            onChange={(event) => setLabel(event.target.value)}
            placeholder="My daemon"
            testId="connect-label-field"
            autoComplete="off"
          />
          <TextField
            label="Host address"
            value={address}
            onChange={(event) => setAddress(event.target.value)}
            placeholder="localhost:6767"
            required
            error={errors.address}
            testId="connect-address-field"
            autoComplete="off"
            spellCheck={false}
          />
          <Toggle
            label="Use TLS"
            checked={useTls}
            onCheckedChange={setUseTls}
            testId="connect-tls-toggle"
          />
          <TextField
            label="Access token"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="Leave blank if this daemon has no password"
            testId="connect-token-field"
            autoComplete="current-password"
          />
          {statusMessage ? (
            <Banner
              tone={bannerTone}
              message={statusMessage}
              testId="connect-status-banner"
              {...(phase === "success" && savedProfileId && onForget
                ? {
                    actionLabel: forgetting ? "Forgetting…" : "Forget saved credentials",
                    onAction: () => void handleForget(),
                  }
                : {})}
            />
          ) : null}
          <Button type="submit" kind="primary" disabled={submitting}>
            {submitting ? "Connecting…" : "Connect"}
          </Button>
        </form>
        {onApplyOffer ? (
          <div data-testid="connect-offer-section">
            <Divider />
            <TextField
              label="Pairing link"
              value={offerInput}
              onChange={(event) => setOfferInput(event.target.value)}
              placeholder="https://app.paseo.sh/#offer=…"
              testId="connect-offer-field"
              autoComplete="off"
              spellCheck={false}
            />
            {offerMessage ? (
              <Banner
                tone={offerBannerTone}
                message={offerMessage}
                testId="connect-offer-status-banner"
                {...(offerPhase === "success" && offerProfileId && onForget
                  ? {
                      actionLabel: offerForgetting ? "Forgetting…" : "Forget saved credentials",
                      onAction: () => void handleForgetOffer(),
                    }
                  : {})}
              />
            ) : null}
            <Button
              type="button"
              kind="secondary"
              disabled={applyingOffer || !offerInput.trim()}
              onClick={() => void handleApplyOffer()}
            >
              {applyingOffer ? "Pairing…" : "Pair"}
            </Button>
            <Button
              type="button"
              kind="secondary"
              disabled={applyingOffer}
              onClick={() => setQrOpen(true)}
              data-testid="connect-qr-trigger-button"
            >
              Scan QR code
            </Button>
            <QrCaptureSheet
              open={qrOpen}
              onClose={() => setQrOpen(false)}
              onScanned={(value) => void handleScannedOffer(value)}
            />
          </div>
        ) : null}
      </Card>
    </Section>
  );
}
