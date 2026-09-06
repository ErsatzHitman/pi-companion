/**
 * T37E7 — single source of the testIds and literal copy
 * `network-switch.yaml` asserts on (plan.md §14.4 "switch network
 * path").
 *
 * RN-free by construction (a plain object of strings), per this
 * workspace's rule that no `e2e/`/`maestro/` support module may reach
 * `react-native` — `network-switch.contract.test.ts` is what actually
 * proves every value below still exists in the real feature source;
 * this module just gives the yaml's own comments and that test one
 * place to point at instead of two copies of each string that could
 * drift apart.
 *
 * Onboarding and the relay entry point's honest "unavailable" state
 * reuse `pairing.yaml`'s already-proven testIds/copy verbatim (see
 * `./pairing-contract.ts` — imported below, not restated as a second,
 * independently-typed copy). Everything below `RELAY_ENTRY` is new to
 * this flow: the direct-connect failure path (a genuine, on-device
 * "network loss" a Maestro flow *can* produce without any airplane-
 * mode/network-toggle primitive) and the session list's own
 * "connection path is visible" banner (T32B5/T32B6).
 *
 * Maestro's `.yaml` flows cannot literally `import` this file (Maestro
 * has no module system), so `network-switch.yaml` restates each value
 * inline — but every restatement is commented with the exact source
 * line it mirrors, and `network-switch.contract.test.ts` is what
 * actually keeps the restatement honest, not this file by itself.
 */
import { PAIRING_FLOW } from "./pairing-contract.js";

export const NETWORK_SWITCH_FLOW = {
  // --- Reused verbatim from pairing.yaml/pairing-contract.ts: onboarding
  // and the relay entry point's honest "unavailable" state. Not
  // restated as a second, independently-typed copy of the same
  // literal.
  onboardingRoot: PAIRING_FLOW.onboardingRoot,
  onboardingWelcomeContinueButton: PAIRING_FLOW.onboardingWelcomeContinueButton,
  onboardingPermissionContinueButton: PAIRING_FLOW.onboardingPermissionContinueButton,
  connectFormSection: PAIRING_FLOW.connectFormSection,
  connectFormAddressField: PAIRING_FLOW.connectFormAddressField,
  connectFormSubmitButton: PAIRING_FLOW.connectFormSubmitButton,
  notConnectedStatusText: PAIRING_FLOW.notConnectedStatusText,
  connectedDirectStatusText: PAIRING_FLOW.connectedDirectStatusText,
  showScannerButton: PAIRING_FLOW.showScannerButton,
  hideScannerButton: PAIRING_FLOW.hideScannerButton,
  qrPairingSection: PAIRING_FLOW.qrPairingSection,
  qrPairingRetryButton: PAIRING_FLOW.qrPairingRetryButton,

  // --- New to this flow: a direct-connect attempt at an address
  // nothing answers on this run's own emulator-host alias
  // (`${DAEMON_HOST}`, never a hardcoded address or the production
  // daemon's port) reliably classifies as "unreachable"
  // (`daemon-connection-error.ts`'s `UNREACHABLE_SUBSTRINGS` matches a
  // real OS-level "connection refused"/"econnrefused"), which is a
  // real, on-device-producible stand-in for "network loss" that needs
  // no Maestro network-toggle primitive this task found none of.
  errorBannerTestId: "connection-shell-error-banner",
  /** `daemon-connection-error.ts`'s `DIRECT_UNREACHABLE_MESSAGE`, restated so the yaml need not import TS. */
  unreachableErrorText: "Could not reach the daemon. Check the address and try again.",

  // --- New to this flow: the session list's own "the active
  // connection path is visible" banner (T32B5's third criterion,
  // T32B6 item 3) — reached here via the real, production
  // `router.replace(sessionListHref(profile.id))` navigation T32A8
  // wired onto a successful direct connect, not a synthetic deep link.
  /** `sessions-screen.tsx`'s `testId` is `sessions-screen-${serverId}` — `serverId` is the connected profile's id (`draft.parsed.endpoint`, e.g. `"10.0.2.2:54321"`), unknown until run time, so the flow matches it with a wildcard, exactly like `cold-start-restore.yaml`/`extension-sheets.yaml` already do for the same reason. */
  sessionsScreenIdPattern: "sessions-screen-.*",
  sessionsScreenConnectionPathIdPattern: "sessions-screen-.*-connection-path",
  /** `sessionListConnectionPathLabel(undefined)` — the honest default before any `NetworkStatus` with a distinguishable `kind` has been observed (this adapter can only ever report `"unknown"`/`"none"`, never `"wifi"`/`"cellular"` — see `platform/network-reachability.ts`'s "Disclosed limits"). */
  connectionPathBannerText: "Connection: Unknown",
} as const;
