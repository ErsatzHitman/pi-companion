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

/**
 * The path `app/h/[serverId]/extensions/[name].tsx` is mounted at
 * (ANDROID-EXT-1). Like `serverId`, `name` is percent-encoded before it
 * reaches the URL — an extension namespace such as `pi-herdr-delegate`
 * is already URL-safe, but nothing here should depend on that staying
 * true of every future entry in `settings-extension-coverage.ts`'s
 * `DRAWING_EXTENSIONS`.
 */
export function buildExtensionHref(serverId: string, name: string): string {
  return `/h/${encodeSegment(serverId)}/extensions/${encodeSegment(name)}`;
}

/** Navigates to this host's trusted-devices screen. */
export function pressOpenDevices(router: SettingsNavRouter, serverId: string): void {
  router.push(buildDevicesHref(serverId));
}

/** Navigates to this host's diagnostics screen. */
export function pressOpenDiagnostics(router: SettingsNavRouter, serverId: string): void {
  router.push(buildDiagnosticsHref(serverId));
}

/** Navigates to one extension's static detail screen (ANDROID-EXT-1). */
export function pressOpenExtension(
  router: SettingsNavRouter,
  serverId: string,
  name: string,
): void {
  router.push(buildExtensionHref(serverId, name));
}
