import { Tabs } from "expo-router";
import { useMemo } from "react";

import { useTheme } from "../../../../ui/theme/theme-context";
import { TAB_ROUTE_NAME } from "../../../../app-shell/host-tabs";
import { TOP_LEVEL_DESTINATIONS } from "../../../../app-shell/top-level-destinations";

/**
 * The Android top-level tab bar for one connected host — T32S1C.
 *
 * Renders one `<Tabs.Screen>` per `TOP_LEVEL_DESTINATIONS` entry
 * (`../../../../app-shell/top-level-destinations.ts`, T32S1), in that array's declared
 * order, so the tab bar, `host-tabs.ts`'s route-name mapping, and
 * `host-tabs.test.ts`'s navigation proof all agree. This is the
 * production consumer `TOP_LEVEL_DESTINATIONS`/`destinationHref` had none
 * of before this task (T32S1's own open second acceptance criterion).
 *
 * A `(tabs)` route group, not a bare `h/[serverId]/_layout.tsx`: Expo
 * Router treats every route inside a directory a `<Tabs>` layout governs
 * as a tab by default, and `session/[agentId]/...` (this directory's
 * sibling) is a pushed detail route, not a third tab — matching
 * `compact-shell.tsx`'s own doc comment ("Files and terminal are
 * deliberately not slots here ... they are separate Expo Router
 * destinations"). The group segment name never appears in the rendered
 * path (`navigationIntentToPath`'s `/h/:serverId/sessions` and
 * `/h/:serverId/settings` stay exact).
 */
export default function HostTabsLayout() {
  const { theme } = useTheme();
  const screenOptions = useMemo(
    () => ({
      headerShown: false,
      tabBarActiveTintColor: theme.colors.accent,
      tabBarInactiveTintColor: theme.colors["ink-2"],
      tabBarStyle: { backgroundColor: theme.colors.surface },
    }),
    [theme],
  );

  return (
    <Tabs screenOptions={screenOptions}>
      {TOP_LEVEL_DESTINATIONS.map((destination) => (
        <Tabs.Screen
          key={destination.type}
          name={TAB_ROUTE_NAME[destination.type]}
          options={{ title: destination.label }}
        />
      ))}
    </Tabs>
  );
}
