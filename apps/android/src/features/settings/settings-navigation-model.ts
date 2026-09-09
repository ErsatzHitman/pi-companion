/**
 * T301 (plan.md §9.3, `docs/issues-from-plan.md`'s T301 acceptance boxes):
 * the settings-screen navigation seam T42A1 sketched but could not build
 * (`features/devices/**` plus one route file was its whole `Owns` grant).
 * Kept RN-free (no React/React Native/Expo import) so it stays directly
 * `vitest`-testable — the "RN-free `*-model.ts` with real behavioural
 * tests plus a thin `.tsx` view" split this repository's `CLAUDE.md`
 * documents, mirroring `../../app-shell/session-nav-actions-model.ts`'s
 * `SessionNavRouter` shape for the identical reason: a test can pass a
 * plain fake `{ push: vi.fn() }` while the real route mount
 * (`../../app/h/[serverId]/(tabs)/settings.tsx`) passes the genuine
 * `useRouter()` unmodified.
 *
 * `/h/:serverId/devices` and `/h/:serverId/diagnostics` are plain path
 * routes reached directly, never through `../../app-shell/
 * top-level-destinations.ts`'s `destinationHref` —
 * `app/h/[serverId]/diagnostics.tsx`'s own doc comment already
 * establishes this ("There is no `{ type: "diagnostics" }` navigation
 * intent in `app-shell/host-tabs.ts`'s model ... this is a plain path
 * route reached directly rather than through `destinationHref()`"), and
 * the same is true of `/devices` — neither is a
 * `NavigationDestinationIntent` `frontend-core`'s `navigation` module
 * knows about. `encodeSegment` below matches that module's own
 * `encodeURIComponent` treatment of a `serverId` path segment
 * (`packages/frontend-core/src/navigation/intents.ts`), so a `serverId`
 * containing a character Expo Router's dynamic segment would otherwise
 * mis-split on still resolves correctly.
 */
export interface SettingsNavRouter {
  push: (href: string) => void;
}

function encodeSegment(segment: string): string {
  return encodeURIComponent(segment);
}

/** The path `app/h/[serverId]/devices.tsx` is mounted at. */
export function buildDevicesHref(serverId: string): string {
  return `/h/${encodeSegment(serverId)}/devices`;
}

/** The path `app/h/[serverId]/diagnostics.tsx` is mounted at. */
export function buildDiagnosticsHref(serverId: string): string {
  return `/h/${encodeSegment(serverId)}/diagnostics`;
}

/** Navigates to this host's trusted-devices screen. */
export function pressOpenDevices(router: SettingsNavRouter, serverId: string): void {
  router.push(buildDevicesHref(serverId));
}

/** Navigates to this host's diagnostics screen. */
export function pressOpenDiagnostics(router: SettingsNavRouter, serverId: string): void {
  router.push(buildDiagnosticsHref(serverId));
}
