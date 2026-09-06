/**
 * T106 — single source of the testIds/strings
 * `recovered-turn-banner.yaml` asserts on. Same rationale as
 * `composer-inputs-contract.ts` (T37E3): Maestro's `.yaml` flows cannot
 * `import` this file (Maestro has no module system), so the yaml
 * restates each value inline, and
 * `recovered-turn-banner.contract.test.ts` is what actually keeps that
 * restatement honest against real source, not this file by itself.
 */
export const RECOVERED_TURN_BANNER_FLOW = {
  /**
   * Deep link straight to the T106 dev-only lab route
   * (`../../src/app/dev/recovered-turn-lab.tsx`), using the
   * `picompanion://` scheme (`../../app.config.ts`'s
   * `scheme: "picompanion"`). Expo Router resolves this URL against the
   * registered route file directly, the same technique
   * `composer-inputs-contract.ts`'s `sessionDeepLink` already
   * documents for `session/[agentId]/index.tsx` — here pointed at
   * `app/dev/recovered-turn-lab.tsx` instead. See that route file's and
   * `recovered-turn-banner.yaml`'s own header comments for why a
   * dev-only lab, not the real session screen, is what this flow can
   * reach today.
   */
  labDeepLink: "picompanion://dev/recovered-turn-lab",

  /** `recovered-turn-lab.tsx`'s `ScrollView` root testID. */
  labRoot: "recovered-turn-lab",
  /** `recovered-turn-lab.tsx`'s status `Text` testID — content is `` `Last action: ${lastAction}` ``. */
  labStatus: "recovered-turn-lab-status",

  /** `recovered-turn-lab.tsx`'s `FIXTURE_TURNS` ids. */
  turnOneId: "lab-turn-1",
  turnTwoId: "lab-turn-2",

  /** `RecoveredTurnBanner`'s per-turn testId pattern (`recovered-turn-banner.tsx`: `` `recovered-turn-banner-${turn.id}` ``). */
  bannerIdFor(turnId: string): string {
    return `recovered-turn-banner-${turnId}`;
  },
  /** The actions `View`'s testID when `outbox` is supplied (`` `recovered-turn-banner-${turn.id}-actions` ``). */
  actionsIdFor(turnId: string): string {
    return `recovered-turn-banner-${turnId}-actions`;
  },
  /** The Resend `Button`'s testId (`` `recovered-turn-banner-${turn.id}-confirm` ``). */
  confirmIdFor(turnId: string): string {
    return `recovered-turn-banner-${turnId}-confirm`;
  },
  /** The Discard `Button`'s testId (`` `recovered-turn-banner-${turn.id}-discard` ``). */
  discardIdFor(turnId: string): string {
    return `recovered-turn-banner-${turnId}-discard`;
  },
} as const;
