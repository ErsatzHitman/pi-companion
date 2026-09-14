/**
 * Thin view over `./recovered-turn-model.ts`'s `AwaitingConfirmationEntry`
 * selection (FIX-W6). One `Banner` (`../../ui/primitives`, tone
 * `"warning"`) per parked, unconfirmed send, with two separate, individually
 * focusable `Button`s below it — "Resend" (`confirmRecoveredTurn`) and
 * "Discard" (`discardRecoveredTurn`) — mirroring
 * `apps/android/src/features/transcript/recovered-turn-banner.tsx`'s own
 * "not folded into `Banner`'s single `actionLabel`/`onAction` slot" choice:
 * this row needs two actions, and `Banner` only ever renders one.
 *
 * Renders `null` — not an empty wrapping element — when `turns` is empty:
 * "the empty case renders nothing rather than an empty shell", the same
 * acceptance criterion `OfflineTranscriptBanner` and Android's T95 both
 * follow.
 *
 * Both buttons are native `<button>`s (via the `Button` primitive), so they
 * are keyboard-reachable (Tab/Space/Enter) for free, and each carries its
 * own `aria-label` naming the action so a screen reader announces "Resend
 * the message that could not be confirmed as sent" rather than a bare
 * "Resend" ambiguous against any other control on the page.
 */
import { Fragment } from "react";

import { Banner, Button } from "../../ui/primitives/index.js";

import "./recovered-turn-banner.css";

import {
  confirmRecoveredTurn,
  describeRecoveredTurn,
  discardRecoveredTurn,
  type AwaitingConfirmationEntry,
  type RecoveredTurnOutbox,
} from "./recovered-turn-model.js";

export interface RecoveredTurnBannerProps {
  turns: readonly AwaitingConfirmationEntry[];
  outbox: RecoveredTurnOutbox;
  /** Called after either action settles (success or failure), so a caller can re-poll immediately rather than waiting for the next interval tick. */
  onChange?: () => void;
  testId?: string;
}

export function RecoveredTurnBanner({ turns, outbox, onChange, testId }: RecoveredTurnBannerProps) {
  if (turns.length === 0) {
    return null;
  }
  return (
    <>
      {turns.map((turn) => (
        <Fragment key={turn.id}>
          <Banner
            tone="warning"
            message={describeRecoveredTurn(turn)}
            testId={testId ? `${testId}-${turn.id}` : undefined}
          />
          <div
            className="pc-recovered-turn-actions"
            data-testid={testId ? `${testId}-${turn.id}-actions` : undefined}
          >
            <Button
              kind="secondary"
              aria-label="Resend the message that could not be confirmed as sent"
              data-testid={testId ? `${testId}-${turn.id}-resend` : undefined}
              onClick={() => {
                void confirmRecoveredTurn(outbox, turn)
                  .then(() => onChange?.())
                  .catch(() => onChange?.());
              }}
            >
              Resend
            </Button>
            <Button
              kind="danger"
              aria-label="Discard the message that could not be confirmed as sent"
              data-testid={testId ? `${testId}-${turn.id}-discard` : undefined}
              onClick={() => {
                void discardRecoveredTurn(outbox, turn)
                  .then(() => onChange?.())
                  .catch(() => onChange?.());
              }}
            >
              Discard
            </Button>
          </div>
        </Fragment>
      ))}
    </>
  );
}
