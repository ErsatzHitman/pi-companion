import { useCallback, useEffect, useState } from "react";
import { useLocalSearchParams, useRouter } from "expo-router";

import { listHostProfiles } from "../../../../features/connect/credential-store";
import { useConnectionStatus } from "../../../../features/connect";
import {
  SettingsScreen,
  pressOpenDevices,
  pressOpenDiagnostics,
  type SettingsHostProfileView,
} from "../../../../features/settings";
import { useAppCore } from "../../../core-context";

/**
 * `/h/:serverId/settings` — the "settings" Phase 5 feature family's route
 * — T32S1C stubbed it against `RoutePlaceholder`; T32S11 (P5-W16) mounts
 * the real screen T32C1 built.
 *
 * Matches `navigationIntentToPath({ type: "settings", serverId })`
 * exactly (`host-tabs.ts`'s `TAB_ROUTE_NAME.settings` is this file's own
 * name, `"settings"`).
 *
 * `features/settings/index.ts`'s doc comment used to say "no route entry
 * exists" and name this exact file as the one that needed to change —
 * that gap is closed here. `SettingsScreen` needs only
 * `AppCore.keyValueStorage` (`../../../../app-shell/core.ts`), the same real adapter
 * `sessions.tsx` already threads through for its own persisted reads —
 * no fake, no second storage module.
 *
 * `serverId` is read for two things now (T301): proving this route
 * resolved, and building the real `/h/:serverId/devices` /
 * `/h/:serverId/diagnostics` hrefs `onOpenDevices`/`onOpenDiagnostics`
 * navigate to below — there is exactly one settings surface per app
 * install today, but devices/diagnostics are still per-host, so this
 * route is where the two meet.
 *
 * `onOpenDevices`/`onOpenDiagnostics` go through `features/settings/
 * settings-navigation-model.ts`'s `pressOpenDevices`/
 * `pressOpenDiagnostics` rather than a hand-built template string here,
 * so the real `useRouter()` this route holds is the only router either
 * function ever sees — `SettingsScreen` itself never imports `expo-
 * router` (T301, closing the gap `../../../../features/devices/
 * DevicesScreen.tsx`'s own doc comment named).
 *
 * **T366**: this route also feeds A3's host row. It reads the saved
 * profile matching `serverId` from the credential store and passes on
 * only the four non-secret fields `settings-host-model.ts` declares,
 * plus the live connection phase behind the row's pill. Neither the
 * screen nor that model ever sees a `HostProfileRecord`, let alone a
 * secret — which is the same reason the navigation seam above exists:
 * the route owns every dependency the screen should not.
 */
export default function SettingsRoute() {
  const { serverId } = useLocalSearchParams<{ serverId: string }>();
  const core = useAppCore();
  const router = useRouter();
  const { phase } = useConnectionStatus(core.connection);

  // T366: the host row's four non-secret fields, read once per mount
  // from the same credential store `app/core-context.tsx` and
  // `connection-shell.tsx` already read. `null` until the read lands,
  // and on failure — `settings-host-model.ts` renders that honestly as
  // "No host saved" rather than a half-filled row. Only these four
  // fields are passed on: a password or relay key has no business
  // crossing into a component that draws.
  const [hostProfile, setHostProfile] = useState<SettingsHostProfileView | null>(null);
  useEffect(() => {
    let cancelled = false;
    void listHostProfiles({
      plainStorage: core.keyValueStorage,
      secureStorage: core.secureStorage,
    })
      .then((profiles) => {
        if (cancelled) return;
        const match = profiles.find((profile) => profile.id === serverId);
        setHostProfile(
          match
            ? {
                label: match.label,
                endpoint: match.endpoint,
                kind: match.kind,
                useTls: match.useTls,
              }
            : null,
        );
      })
      .catch(() => {
        // Nothing to show is the honest state; see the note above.
      });
    return () => {
      cancelled = true;
    };
  }, [core.keyValueStorage, core.secureStorage, serverId]);

  // T366: as a tab there is nothing to close back to; reached from A1's
  // gear there is. Same rule as `(tabs)/sessions.tsx`'s own close.
  const canClose = router.canGoBack();
  const handleClose = useCallback(() => {
    router.back();
  }, [router]);

  return (
    <SettingsScreen
      storage={core.keyValueStorage}
      onOpenDevices={() => pressOpenDevices(router, serverId)}
      onOpenDiagnostics={() => pressOpenDiagnostics(router, serverId)}
      hostProfile={hostProfile}
      connectionPhase={phase}
      onClose={canClose ? handleClose : undefined}
      testId="settings-screen"
    />
  );
}
