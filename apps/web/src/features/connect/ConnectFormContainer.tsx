import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useCore } from "../../app/core-context.js";
import { BootstrapConnectStatus } from "./BootstrapConnectStatus.js";
import type { BootstrapConnectPhase } from "./BootstrapConnectStatus.js";
import { ConnectForm } from "./ConnectForm.js";
import { createApplyConnectionOfferAttempt } from "./apply-connection-offer.js";
import type {
  ApplyConnectionOfferAttempt,
  CreateApplyConnectionOfferOptions,
} from "./apply-connection-offer.js";
import { createConnectAndAuthenticateAttempt, forgetHostCredentials } from "./authenticate-host.js";
import type {
  ConnectAndAuthenticateAttempt,
  CreateConnectAndAuthenticateOptions,
} from "./authenticate-host.js";
import { readBootstrapConnectDraft } from "./bootstrap-connection.js";
import type { ConnectDraft } from "./validate-connect-form.js";

/**
 * The `clientId` this app identifies itself with when negotiating a
 * daemon connection (`@picompanion/protocol`'s hello exchange). A fixed,
 * per-build id is enough for T27A2's "attempt an authenticated
 * connection and persist the result" scope; a per-installation id is a
 * later concern, not this feature's.
 */
const WEB_CONNECT_CLIENT_ID = "picompanion-web";

export interface ConnectFormContainerProps {
  /**
   * Overrides the real `createConnectAndAuthenticateAttempt` wiring;
   * test-only (lets a test supply a fake `DaemonClientFactory`/probe
   * instead of exercising a real `WebSocket`, without weakening that
   * this is the same `hosts.HostProfileStore`/`connection.DaemonClientLifecycle`-backed
   * factory production code uses).
   */
  createAttempt?: (options: CreateConnectAndAuthenticateOptions) => ConnectAndAuthenticateAttempt;
  /**
   * Overrides the real `createApplyConnectionOfferAttempt` wiring
   * (T27A3); test-only, same rationale as `createAttempt`.
   */
  createApplyOffer?: (options: CreateApplyConnectionOfferOptions) => ApplyConnectionOfferAttempt;
  /**
   * Overrides the real `readBootstrapConnectDraft` (T27A5); test-only.
   * Returns `null` for "no daemon-injected bootstrap hint", exactly
   * like the production reader does for a missing or malformed one.
   */
  readBootstrap?: (globalObject?: unknown) => ConnectDraft | null;
}

/**
 * Wires `ConnectForm` to a real "connection attempt through core"
 * (T27A1's acceptance criterion) that also authenticates and persists
 * credentials (T27A2): one `ConnectAndAuthenticateAttempt` — backed by
 * `@picompanion/frontend-core`'s `hosts.ConnectionProber`,
 * `connection.DaemonClientLifecycle`, and `hosts.HostProfileStore` (all
 * layered on this app's `platform.structuredStorage`/`secureStorage`/
 * `clock` from `useCore()`) — is built once per mount and reused across
 * submissions. This is the only place in the connect feature that
 * reaches into `useCore()`; `ConnectForm` itself stays presentational.
 *
 * `onApplyOffer` (T27A3) wires the same `ConnectForm` to a second,
 * relay-only attempt built the same way from a real
 * `createApplyConnectionOfferAttempt`, for the "pair with a link"
 * affordance.
 *
 * T27A5: when the daemon serves this app itself, it injects a
 * same-origin connection hint (`bootstrap-connection.ts`'s
 * `readBootstrapConnectDraft`, reading `window.__PASEO_INITIAL_DAEMON_CONNECTION__`).
 * A valid hint is read exactly once per mount and, unless the user has
 * already chosen to connect manually this session, drives
 * `BootstrapConnectStatus` through the very same `attempt` `ConnectForm`
 * uses — so a bootstrapped connection persists through the same
 * `hosts.HostProfileStore` path a manual one does, and "the pairing
 * form" (`ConnectForm`) never renders while that attempt might still
 * succeed. A missing/malformed hint, or a bootstrap attempt the user
 * dismisses via "Connect to a different daemon", falls back to the
 * ordinary `ConnectForm` below — whose own fields are never populated
 * from the hint, so a bootstrap value can never silently override a
 * host the user typed themselves.
 */
export function ConnectFormContainer({
  createAttempt = createConnectAndAuthenticateAttempt,
  createApplyOffer = createApplyConnectionOfferAttempt,
  readBootstrap = readBootstrapConnectDraft,
}: ConnectFormContainerProps = {}) {
  const { platform } = useCore();
  const attempt = useMemo(
    () =>
      createAttempt({
        clock: platform.clock,
        storage: platform.structuredStorage,
        secrets: platform.secureStorage,
        clientId: WEB_CONNECT_CLIENT_ID,
        clientType: "browser",
      }),
    [createAttempt, platform],
  );
  const applyOffer = useMemo(
    () =>
      createApplyOffer({
        clock: platform.clock,
        storage: platform.structuredStorage,
        secrets: platform.secureStorage,
        clientId: WEB_CONNECT_CLIENT_ID,
        clientType: "browser",
      }),
    [createApplyOffer, platform],
  );

  const [bootstrapDraft] = useState<ConnectDraft | null>(() => readBootstrap());
  const [useManual, setUseManual] = useState(false);
  const [bootstrapPhase, setBootstrapPhase] = useState<BootstrapConnectPhase>("connecting");
  const [bootstrapMessage, setBootstrapMessage] = useState(
    bootstrapDraft ? `Connecting to ${bootstrapDraft.label}\u2026` : "",
  );
  const bootstrapAttemptId = useRef(0);

  const runBootstrapAttempt = useCallback(() => {
    if (!bootstrapDraft) return;
    const attemptId = ++bootstrapAttemptId.current;
    setBootstrapPhase("connecting");
    setBootstrapMessage(`Connecting to ${bootstrapDraft.label}\u2026`);
    void attempt(bootstrapDraft).then(
      (outcome) => {
        if (attemptId !== bootstrapAttemptId.current) return;
        if (outcome.ok) {
          setBootstrapPhase("success");
          setBootstrapMessage(`Connected to ${bootstrapDraft.label}.`);
        } else {
          setBootstrapPhase("error");
          setBootstrapMessage(outcome.error ?? `Could not connect to ${bootstrapDraft.label}.`);
        }
      },
      (error: unknown) => {
        if (attemptId !== bootstrapAttemptId.current) return;
        setBootstrapPhase("error");
        setBootstrapMessage(
          error instanceof Error ? error.message : "Bootstrap connection failed.",
        );
      },
    );
  }, [attempt, bootstrapDraft]);

  const bootstrapStarted = useRef(false);
  useEffect(() => {
    if (!bootstrapDraft || useManual || bootstrapStarted.current) return;
    bootstrapStarted.current = true;
    runBootstrapAttempt();
  }, [bootstrapDraft, useManual, runBootstrapAttempt]);

  if (bootstrapDraft && !useManual) {
    return (
      <BootstrapConnectStatus
        label={bootstrapDraft.label}
        phase={bootstrapPhase}
        message={bootstrapMessage}
        onRetry={runBootstrapAttempt}
        onUseManual={() => setUseManual(true)}
      />
    );
  }

  return (
    <ConnectForm
      onAttempt={attempt}
      onApplyOffer={applyOffer}
      onForget={(profileId) =>
        forgetHostCredentials(
          {
            clock: platform.clock,
            storage: platform.structuredStorage,
            secrets: platform.secureStorage,
          },
          profileId,
        )
      }
    />
  );
}
