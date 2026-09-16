import { useCallback } from "react";
import { useLocalSearchParams, useRouter } from "expo-router";

import { ExtensionDetailScreen } from "../../../../features/settings";

/**
 * `/h/:serverId/extensions/:name` — one extension's static detail
 * screen (ANDROID-EXT-1, plan.md §11.7). Same shape as this app's other
 * feature routes not under `(tabs)/` (`../devices.tsx`,
 * `../diagnostics.tsx`): the route supplies only the params and a
 * router, and `features/settings/ExtensionDetailScreen.tsx` owns every
 * other decision, including looking `name` up in
 * `features/settings/settings-extension-coverage.ts`'s
 * `DRAWING_EXTENSIONS`.
 *
 * **Reachable from the Settings tab (ANDROID-EXT-1).** Each row in
 * `SettingsScreen.tsx`'s "Extensions that draw" list navigates here via
 * `features/settings/settings-navigation-model.ts`'s
 * `pressOpenExtension`, mounted from `app/h/[serverId]/(tabs)/
 * settings.tsx`'s real `useRouter()` — the same seam T301 built for
 * `/devices` and `/diagnostics`, applied to a per-row `name` rather than
 * a single fixed path.
 *
 * `serverId` is read but otherwise unused, matching `../diagnostics.tsx`
 * and `../devices.tsx`: this screen's content is the same regardless of
 * which host it was reached from — it is static documentation, not
 * per-host state.
 */
export default function ExtensionDetailRoute() {
  const { name } = useLocalSearchParams<{ serverId: string; name: string }>();
  const router = useRouter();

  const canBack = router.canGoBack();
  const handleBack = useCallback(() => {
    router.back();
  }, [router]);

  return (
    <ExtensionDetailScreen
      name={name}
      onBack={canBack ? handleBack : undefined}
      testId="extension-detail-screen"
    />
  );
}
