/**
 * Thin native view over `./recovered-turn-model.ts`'s
 * `AwaitingConfirmationTurn` selection (T95). One `Banner`
 * (`../../ui/primitives`, tone `"warning"`) per recovered, unconfirmed
 * turn — never a bare text label, matching every other transcript-level
 * announcement (see `../../platform/offline/stale-announcement.ts`'s "a
 * full sentence, never colour alone" rule, already followed by the
 * staleness banner this mounts alongside in
 * `../../app/h/[serverId]/session/[agentId]/index.tsx`).
 *
 * Renders `null` — not an empty wrapping element — when `turns` is
 * empty: "the empty case renders nothing rather than an empty shell"
 * (T95's own acceptance criterion).
 *
 * **T106**: the optional `outbox` prop adds the two actions T95
 * disclosed as missing — "Resend" (`confirmRecoveredTurn`) and
 * "Discard" (`discardRecoveredTurn`, both `./recovered-turn-model.ts`,
 * both proven against a counting fake AND the real `OutboxController`
 * there) — as separate, individually focusable `Button`s below each
 * `Banner`. Deliberately NOT folded into `Banner`'s own single built-in
 * `actionLabel`/`onAction` slot: a `Banner` supports exactly one action,
 * and this row needs two. Matches `Composer.tsx`'s own
 * `ComposerEntryRow` convention of a separate, individually focusable
 * `Button` next to (not merged into) a status row, for the identical
 * TalkBack reason that file's own doc comment gives — collapsing both
 * buttons under the `Banner`'s `accessible` wrapper would make them
 * unreachable as their own nodes.
 *
 * `outbox` is optional and defaults to `undefined`: omitting it renders
 * exactly as T95 shipped this file (display-only, no actions).
 *
 * **T121**: the one production mount
 * (`../../app/h/[serverId]/session/[agentId]/index.tsx`'s
 * `SessionTranscript`) now passes `core.turnOutbox.getOutbox() ??
 * undefined` — the ONE `TurnOutboxOwner`-owned `OutboxController`
 * instance, not a private one. `Composer`'s own `outbox` prop
 * (`../composer/Composer.tsx`) is fed the identical expression at that
 * same mount site, closing the "different instance, separate storage"
 * split this comment used to disclose (T106's report named it; no task
 * owned it until T121). See T121's report for the counting-fake proof
 * that a composer-style `enqueue`/`markFailed` and this component's
 * `confirmResend` call now land on the same instance.
 *
 * Since T390 `AppCore.turnOutbox` opens a real `expo-sqlite` database
 * file on a device with the native `ExpoSQLite` module present, so this
 * instance supplies real recovered rows there; on a build with no native
 * module it stays `null` (`AppCore.turnOutbox` `"degraded"`,
 * `getOutbox()` `null`) and this component renders display-only. T121
 * wired the prop through anyway, rather than leaving that gap invisible.
 */
import { Fragment } from "react";
import { StyleSheet, View } from "react-native";

import { Banner, Button } from "../../ui/primitives";
import {
  confirmRecoveredTurn,
  describeRecoveredTurn,
  discardRecoveredTurn,
  type AwaitingConfirmationTurn,
  type RecoveredTurnOutbox,
} from "./recovered-turn-model";

export interface RecoveredTurnBannerProps {
  turns: readonly AwaitingConfirmationTurn[];
  /**
   * T106: when supplied, each turn's `Banner` gains "Resend"/"Discard"
   * `Button`s that call `confirmRecoveredTurn`/`discardRecoveredTurn`
   * against it. Omitted (the default) keeps this file exactly
   * display-only.
   */
  outbox?: RecoveredTurnOutbox;
}

export function RecoveredTurnBanner({ turns, outbox }: RecoveredTurnBannerProps) {
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
            testId={`recovered-turn-banner-${turn.id}`}
          />
          {outbox ? (
            <View style={styles.actions} testID={`recovered-turn-banner-${turn.id}-actions`}>
              <Button
                kind="secondary"
                label="Resend"
                onPress={() => void confirmRecoveredTurn(outbox, turn).catch(() => undefined)}
                testId={`recovered-turn-banner-${turn.id}-confirm`}
              />
              <Button
                kind="danger"
                label="Discard"
                onPress={() => void discardRecoveredTurn(outbox, turn).catch(() => undefined)}
                testId={`recovered-turn-banner-${turn.id}-discard`}
              />
            </View>
          ) : null}
        </Fragment>
      ))}
    </>
  );
}

const styles = StyleSheet.create({
  actions: { flexDirection: "row", gap: 8, marginBottom: 8 },
});
