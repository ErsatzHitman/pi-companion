import { useState } from "react";
import { ScrollView, Text } from "react-native";

import {
  RecoveredTurnBanner,
  type AwaitingConfirmationTurn,
  type RecoveredTurnOutbox,
} from "../features/transcript";
import { useTheme } from "../ui/theme/theme-context";

/**
 * T106 dev-only recovered-turn-banner lab (`component-lab.tsx`/
 * `recipe-lab.tsx`'s own dev-lab convention, plan.md §10.3/§10.4). Only
 * ever reached through `../app/dev/recovered-turn-lab.tsx`'s `__DEV__`
 * branch — see that file for why this never ships in a production
 * bundle.
 *
 * Renders the REAL `RecoveredTurnBanner`
 * (`../features/transcript/recovered-turn-banner.tsx`, T95/T106) against
 * a hand-built `AwaitingConfirmationTurn` fixture and a plain
 * `RecoveredTurnOutbox`-shaped object. This exists to close the one
 * proof a plain `vitest` run cannot: `RecoveredTurnBanner` imports
 * `react-native` and cannot render under this workspace's vitest setup
 * (that file's own doc comment: the repo-wide limitation, proven 27
 * times) — `../../maestro/recovered-turn-banner.yaml` deep-links here
 * and asserts the banner's REAL rendered text, and that tapping Resend/
 * Discard reaches this lab's outbox and updates the screen.
 *
 * **What this does NOT prove** — the real crash-recovery pipeline
 * (`TurnOutboxOwner.getRecoveredTurns()`, `../platform/offline/
 * turn-outbox-owner.ts`) is real and mounted, but this lab seeds its
 * fixture directly rather than driving a real device through the
 * pipeline: producing an "awaiting-confirmation" row on-device would
 * need a real turn to be left mid-flight by a process kill. Since T390
 * the owner is backed by a real `expo-sqlite` file (and T121 shares one
 * `OutboxController` between `Composer` and this banner), so the lab's
 * fixture is a convenience, not a workaround for a missing driver; see
 * this task's (T106) report for the exact chain of gaps that stood
 * between this and an on-device proof of the full pipeline.
 */
const FIXTURE_TURNS: readonly AwaitingConfirmationTurn[] = [
  {
    id: "lab-turn-1",
    sessionId: "lab-session",
    kind: "prompt",
    outcome: "awaiting-confirmation",
    status: "awaiting-confirmation",
  },
  {
    id: "lab-turn-2",
    sessionId: "lab-session",
    kind: "prompt",
    outcome: "awaiting-confirmation",
    status: "awaiting-confirmation",
  },
];

export function RecoveredTurnLab() {
  const { theme } = useTheme();
  const [turns, setTurns] = useState<readonly AwaitingConfirmationTurn[]>(FIXTURE_TURNS);
  const [lastAction, setLastAction] = useState("none");

  // A plain object satisfying `RecoveredTurnOutbox` — never a real
  // `OutboxController` (there is no durable storage worth constructing
  // for a dev lab). Removes the acted-on turn from `turns` so a
  // Maestro tap is visibly confirmed both by `recovered-turn-lab-status`
  // and by the Banner/actions for that turn actually disappearing —
  // "registration is not receipt": a tap that did nothing observable
  // would not prove this lab's actions reach anything.
  const outbox: RecoveredTurnOutbox = {
    async confirmResend(id: string) {
      setLastAction(`confirmed ${id}`);
      setTurns((current) => current.filter((turn) => turn.id !== id));
      return {
        id,
        sessionId: "lab-session",
        kind: "prompt",
        payload: {},
        status: "pending",
        createdAt: 0,
        attempts: 1,
      };
    },
    async remove(id: string) {
      setLastAction(`discarded ${id}`);
      setTurns((current) => current.filter((turn) => turn.id !== id));
    },
  };

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: theme.colors.page }}
      contentContainerStyle={{ padding: theme.spacing[5], gap: theme.spacing[4] }}
      testID="recovered-turn-lab"
    >
      <Text
        style={{ color: theme.colors.ink, fontSize: theme.typography.variant.display.fontSize }}
      >
        Recovered turn lab
      </Text>
      <Text style={{ color: theme.colors["ink-2"] }} testID="recovered-turn-lab-status">
        {`Last action: ${lastAction}`}
      </Text>
      <RecoveredTurnBanner turns={turns} outbox={outbox} />
    </ScrollView>
  );
}

export default RecoveredTurnLab;
