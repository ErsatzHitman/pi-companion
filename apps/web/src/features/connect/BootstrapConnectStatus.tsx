import { Banner } from "../../ui/primitives/Banner.js";
import { Button } from "../../ui/primitives/Button.js";
import { Card } from "../../ui/primitives/Card.js";
import { Section } from "../../ui/primitives/Section.js";
import { StatusIndicator } from "../../ui/primitives/StatusIndicator.js";

export type BootstrapConnectPhase = "connecting" | "success" | "error";

export interface BootstrapConnectStatusProps {
  /** The daemon-injected hint's label (`DaemonInjectedConnectionHint.label`); shown so a user recognizes which daemon this is. */
  label: string;
  phase: BootstrapConnectPhase;
  /** Human-readable status text; always present so tone is never the only signal (plan.md §10.5). */
  message: string;
  /** Retries the same bootstrap attempt; only rendered once `phase === "error"`. */
  onRetry: () => void;
  /** Switches to the ordinary manual-entry form, bypassing the bootstrap hint for the rest of this session. */
  onUseManual: () => void;
}

/**
 * The daemon-injected-bootstrap view (plan.md §8.2/§12.1, T27A5): shown
 * in place of the manual `ConnectForm` while a daemon-served page's
 * injected connection hint (`bootstrap-connection.ts`) is being
 * attempted, so "injected bootstrap connects without showing the
 * pairing form" (this task's first acceptance criterion) holds for as
 * long as that attempt might still succeed. A failed attempt offers
 * both a retry and an explicit, user-initiated escape hatch to the
 * manual form — never an automatic fallback that could silently swap
 * in a different host than the one the user is looking at.
 */
export function BootstrapConnectStatus({
  label,
  phase,
  message,
  onRetry,
  onUseManual,
}: BootstrapConnectStatusProps) {
  const tone = phase === "success" ? "success" : phase === "connecting" ? "info" : "danger";
  return (
    <Section title="Connect">
      <Card>
        <StatusIndicator
          label={label}
          tone={tone}
          statusText={message}
          testId="bootstrap-connect-status"
        />
        {phase === "error" ? (
          <Banner
            tone="danger"
            message={message}
            testId="bootstrap-connect-error-banner"
            actionLabel="Retry"
            onAction={onRetry}
          />
        ) : null}
        <Button
          type="button"
          kind="secondary"
          onClick={onUseManual}
          disabled={phase === "connecting"}
        >
          Connect to a different daemon
        </Button>
      </Card>
    </Section>
  );
}
