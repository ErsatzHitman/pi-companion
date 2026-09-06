import type { TopLevelDestinationType } from "./top-level-destinations";

/**
 * Lives in `app-shell/`, not the Expo Router root — see
 * `./compact-shell-slots.ts`'s doc comment (T32S2).
 *
 * The Expo Router route `name` — matching a sibling file inside
 * `h/[serverId]/(tabs)/` — for each of Android's top-level tab
 * destinations (`TOP_LEVEL_DESTINATIONS`, `top-level-destinations.ts`,
 * T32S1) — T32S1C.
 *
 * The one place this mapping lives, so `h/[serverId]/(tabs)/_layout.tsx`
 * (which declares the actual `<Tabs.Screen name="...">` entries Expo
 * Router renders) and `host-tabs.test.ts` (which proves switching
 * between the two tabs is real, working navigation, not just something
 * the layout's source text claims) can never drift apart. Kept
 * react-native/expo-router-free, like `top-level-destinations.ts` itself,
 * so both stay testable in plain `vitest`.
 */
export const TAB_ROUTE_NAME: Record<TopLevelDestinationType, string> = {
  sessionList: "sessions",
  settings: "settings",
};
