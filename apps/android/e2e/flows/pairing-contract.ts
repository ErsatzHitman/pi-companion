/**
 * T37E1 — single source of the testIds and literal copy `pairing.yaml`
 * asserts on (plan.md §14.4 "pair direct and relay hosts").
 *
 * RN-free by construction (a plain object of strings), per this
 * workspace's rule that no `e2e/`/`maestro/` support module may reach
 * `react-native` — `pairing.contract.test.ts` is what actually proves
 * every value below still exists in the real feature source; this
 * module just gives the yaml's own comments and that test one place to
 * point at instead of two copies of each string that could drift apart.
 *
 * Maestro's `.yaml` flows cannot literally `import` this file (Maestro
 * has no module system), so `pairing.yaml` restates each value inline —
 * but every restatement is commented with the exact source line it
 * mirrors, and `pairing.contract.test.ts` is what actually keeps the
 * restatement honest, not this file by itself.
 */
export const PAIRING_FLOW = {
  /** `apps/android/src/app/connect.tsx`'s `OnboardingGate` root testId. */
  onboardingRoot: "connect-onboarding",
  onboardingWelcomeTitle: "Welcome to Pi Companion",
  onboardingWelcomeContinueButton: "connect-onboarding-welcome-continue",
  onboardingPermissionBanner: "connect-onboarding-permission-banner",
  onboardingPermissionContinueButton: "connect-onboarding-permission-continue",

  connectFormSection: "connect-form",
  connectFormAddressField: "connect-form-address-field",
  connectFormSubmitButton: "connect-form-submit-button",

  /** `describeConnectionStatus("connected", "direct")` in `connection-shell.tsx`. Kept as the one pinned copy of that copy string; since T332 no flow asserts it (the navigation replaces it too fast to sample). */
  connectedDirectStatusText: "Connected via direct connection",
  /** `sessions-screen.tsx`'s root testId is `sessions-screen-${serverId}`; the serverId is the connected endpoint, unknown until run time, so every flow matches the arrival with this wildcard (T332). */
  sessionsScreenArrival: "sessions-screen-.*",
  /** `describeConnectionStatus("idle", null)` — the pre-attempt status text. */
  notConnectedStatusText: "Not connected",

  showScannerButton: "connection-shell-show-scanner-button",
  hideScannerButton: "connection-shell-hide-scanner-button",
  qrPairingSection: "connection-shell-qr-pairing",
  qrPairingRetryButton: "connection-shell-qr-pairing-retry-button",
} as const;
