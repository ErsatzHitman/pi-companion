/**
 * T77 — single source of the testIds, deep-link shape, and literal copy
 * `../../maestro/file-download.yaml` restates inline (plan.md §14.4's
 * files scenario, extended: T32S14 wired the route-level `fetchImpl` that
 * makes `DownloadPanel` and T66's named relay-download refusal
 * reachable, and no flow covered either until this task). RN-free by
 * construction (a plain object of strings/functions) — Maestro's `.yaml`
 * has no module system, so the flow cannot literally `import` this file;
 * `file-download.contract.test.ts` is what actually keeps every
 * restatement below honest against real source and against the yaml's
 * own bytes (T72's `../maestro-yaml.js` parser), not this file by
 * itself.
 *
 * Reuses `files-and-terminal-contract.ts`'s established shape
 * (`filesDeepLink`/`filesTestId`, the direct-pairing literals) rather
 * than re-deriving it — both flows open the same route through the same
 * deep link, for the same "no in-app control pushes `sessionFiles` yet"
 * reason that file's own doc comment already covers in full (T79's gap,
 * not this task's). This file adds only what is specific to the download
 * path: the honest "No workspace selected" state this flow's own steps
 * actually reach, and T66's named relay refusal, which this flow's steps
 * cannot reach on this harness (see the yaml's own header comment) and
 * which `file-download.contract.test.ts` instead proves directly against
 * the real `createFileDownloadController`.
 */
export const FILE_DOWNLOAD_FLOW = {
  /** Free-form path segments — neither route validates them (see `files-and-terminal-contract.ts`'s doc comment for proof). Distinct from that file's own ids so the two flows' isolated daemons/state never collide if ever run back to back. */
  serverId: "e2e-host",
  agentId: "e2e-download-agent",

  /** `matchDeepLinkPath`'s `"sessionFiles"` branch: `h/<serverId>/session/<agentId>/files`. */
  filesDeepLink: (serverId: string, agentId: string): string =>
    `picompanion://h/${serverId}/session/${agentId}/files`,
  /** `files-screen.tsx`'s `FilesScreen` root testId template. */
  filesTestId: (serverId: string, agentId: string): string => `files-screen-${serverId}-${agentId}`,
  /** `${testId}-not-connected` — only rendered when `!client || workspaceRoot === undefined`; never true on this route (see this flow's header comment), so this flow asserts it absent. */
  filesNotConnectedTestId: (testId: string): string => `${testId}-not-connected`,
  /** `${testId}-error` — `FilesScreen`'s listing-error `ErrorState`, the real state this flow's own round trip reaches every time (see header comment). */
  filesErrorTestId: (testId: string): string => `${testId}-error`,
  /** `${testId}-file` — `FileContentView`'s own testId, only rendered once a listed row has been pressed. Never reached by this flow — asserted absent as the honest, disclosed limit this flow's header comment names. */
  filesFileTestId: (testId: string): string => `${testId}-file`,

  connectFormSection: "connect-form",
  connectFormAddressField: "connect-form-address-field",
  connectFormSubmitButton: "connect-form-submit-button",
  /** `sessions-screen.tsx`'s root testId is `sessions-screen-${serverId}`, the serverId being the connected endpoint -- unknown until run time, hence the wildcard. The stable post-connect state every flow asserts since T332 (the "Connected via direct connection" status text is replaced by the navigation before Maestro can sample it). */
  sessionsScreenArrival: "sessions-screen-.*",

  /** `explainFileBrowserError("cwd is required")`'s exact title (`file-browser-client.ts`) — the real state a REAL round trip to a REAL (isolated, never production-port) daemon reaches from this route today, because `SessionFilesRoute` hardcodes `workspaceRoot=""` (see this flow's header comment for the full gap and its owner). */
  noWorkspaceSelectedTitle: "No workspace selected",
  noWorkspaceSelectedDescription: "This session does not have a workspace folder to browse yet.",

  /** `explainFileDownloadError(FILE_DOWNLOAD_NO_RELAY_ORIGIN)`'s exact title/description (`file-browser-client.ts`) — T66's named refusal. Not reachable by this flow's own device-observable steps (no real relay pairing is possible on this harness — see `pairing.yaml`'s header for exactly why); proven directly against the real `createFileDownloadController` in `file-download.contract.test.ts` instead. */
  relayRefusalTitle: "Downloads aren't available over a relay connection",
  relayRefusalDescription:
    "This session is connected through the relay, which only tunnels the encrypted session and can't proxy a file download. Connect directly to this daemon to download files.",
} as const;
