/**
 * T37E9 — single source of the testIds, literal copy, and deep-link
 * path shape `../../maestro/files-and-terminal.yaml` restates inline
 * (plan.md §14.4 "open files and terminal"). RN-free by construction (a
 * plain object of strings/functions), matching `pairing-contract.ts`'s
 * and `composer-inputs-contract.ts`'s precedent exactly: Maestro's
 * `.yaml` has no module system, so the flow cannot literally `import`
 * this file — `files-and-terminal.contract.test.ts` is what actually
 * keeps every restatement honest against real source, not this file by
 * itself.
 *
 * ## Why this flow reaches both routes with `openLink`, not a tap
 *
 * `composer-inputs.yaml` (T37E3) already established the pattern this
 * flow reuses: `session/[agentId]/index.tsx` renders no control that
 * pushes `sessionFiles`/`sessionTerminal` at all — `deep-link-routing.ts`
 * defines the match, `app-shell/top-level-destinations.ts`'s own doc
 * comment *says* these routes are "pushed from a row in the session
 * list", but no such row or button exists anywhere in
 * `apps/android/src` (verified with
 * `grep -rn "router\.push\|router\.replace\|destinationHref" apps/android/src/features/transcript apps/android/src/features/sessions apps/android/src/app-shell/compact-shell*.tsx`
 * — zero hits outside test/model files). This flow's own report names
 * this gap precisely; it is not this task's `Owns` grant to fix
 * (`apps/android/maestro/files-and-terminal.yaml` plus this directory's
 * `files-and-terminal*` files only).
 *
 * Both routes' params are free-form path segments neither screen
 * validates against a real paired host or a real created session — see
 * `files-and-terminal.contract.test.ts`'s pin on `[...path].tsx`/
 * `[terminalId].tsx` for proof neither does anything with `serverId`/
 * `agentId` beyond passing them through as display labels — so any
 * non-empty literal reaches the same code a real navigation would. This
 * flow still pairs with the isolated daemon first (unlike
 * `composer-inputs.yaml`, which needs no daemon at all): `AppCore`
 * (`app-shell/core.ts`) is one process-lifetime singleton independent of
 * the route tree, so `core.fileBrowserClient`/`core.createTerminalTransport`
 * reflect this run's real connection regardless of what literal
 * `serverId` the deep link names — pairing first is what makes "All
 * access goes through daemon RPC" (T35A1's own criterion) actually true
 * of this run, not a fixed `serverId` matching the one used to pair.
 */
export const FILES_TERMINAL_FLOW = {
  /** Free-form path segments — see this module's doc comment for why neither route validates them. */
  serverId: "e2e-host",
  filesAgentId: "e2e-files-agent",
  terminalAgentId: "e2e-terminal-agent",
  terminalId: "e2e-terminal-1",

  /** `matchDeepLinkPath`'s `"sessionFiles"` branch: `h/<serverId>/session/<agentId>/files`. */
  filesDeepLink: (serverId: string, agentId: string): string =>
    `picompanion://h/${serverId}/session/${agentId}/files`,
  /** `matchDeepLinkPath`'s `"sessionTerminal"` branch: `h/<serverId>/session/<agentId>/terminal/<terminalId>`. */
  terminalDeepLink: (serverId: string, agentId: string, terminalId: string): string =>
    `picompanion://h/${serverId}/session/${agentId}/terminal/${terminalId}`,

  /** `files-screen.tsx`'s `FilesScreen` root testId template. */
  filesTestId: (serverId: string, agentId: string): string => `files-screen-${serverId}-${agentId}`,
  /** `${testId}-breadcrumbs` — `FilesBreadcrumbRow`'s own testId. */
  filesBreadcrumbsTestId: (testId: string): string => `${testId}-breadcrumbs`,
  /** `${testId}-not-connected` — only rendered when `!client || workspaceRoot === undefined`. */
  filesNotConnectedTestId: (testId: string): string => `${testId}-not-connected`,
  /** `${testId}-upload` — only rendered when `uploadController` is non-null (`client && filePicker`). */
  filesUploadTestId: (testId: string): string => `${testId}-upload`,

  connectFormSection: "connect-form",
  connectFormAddressField: "connect-form-address-field",
  connectFormSubmitButton: "connect-form-submit-button",
  /** `describeConnectionStatus("connected", "direct")` in `connection-shell.tsx`, same literal `extension-sheets.yaml`/`pairing-contract.ts` already pin. */
  connectedDirectStatusText: "Connected via direct connection",

  /** `terminal-screen.tsx`'s outer container testID — present in both the "unavailable" and live branches. */
  terminalScreenTestId: "terminal-screen",
  /** `terminal-screen.tsx`'s early-return `EmptyState` when `!resolvedWebview.isAvailable` — always true today, no `react-native-webview` installed (see this module's doc comment). */
  terminalUnavailableTestId: "terminal-unavailable",
  terminalUnavailableTitle: "Terminal unavailable",
  terminalUnavailableDescription:
    "This build has no embedded terminal renderer installed yet. Your session and its output are unaffected.",
} as const;
