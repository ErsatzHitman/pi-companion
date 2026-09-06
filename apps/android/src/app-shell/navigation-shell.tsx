import { Stack } from "expo-router";
import { useMemo } from "react";

import { PortalHost } from "../ui/primitives";
import { useTheme } from "../ui/theme/theme-context";

/**
 * Lives in `app-shell/`, not the Expo Router root — see
 * `./compact-shell-slots.ts`'s doc comment (T32S2).
 *
 * Root Expo Router navigation shell — plan.md §6/§9, T32S1 ("Build the
 * Android navigation shell").
 *
 * `../app/_layout.tsx` (Expo Router's real route-discovery root — `src/app/`,
 * not the separate `apps/android/app/` plan.md §6 originally proposed;
 * see that file's doc comment for why T32S1C folded the two together)
 * mounts this instead of an inline `<Stack>`, so the themed screen
 * defaults every route needs live once, here, alongside this task's
 * other layout ownership rather than duplicated per screen. This
 * introduces no route file of its own: `<Stack>` from `expo-router`
 * renders whatever child routes the filesystem already declares (today,
 * `index.tsx`, `connect.tsx`, the `dev/` lab screens, and T32S1C's
 * `h/[serverId]/` tree of Phase 5 destination stubs) with these options
 * applied.
 *
 * `contentStyle`'s themed page background replaces the platform default
 * (a flash of the OS's own light/dark background) between one screen's
 * content unmounting and the next mounting during a push/pop — otherwise
 * invisible in a light-themed emulator screenshot but a visible flash in
 * dark theme. `headerShown: false` matches every existing screen: this
 * product supplies its own header content through `CompactSessionShell`'s
 * `header` slot rather than the native stack header.
 *
 * **T32S6: `<PortalHost>` wraps `<Stack>` here.** `../ui/primitives/
 * Portal.tsx`'s own doc comment names `apps/android/src/app-shell/` as
 * the right mount site — "near the top of the screen tree, above
 * whatever renders a `Sheet`" — and until now nothing mounted one at
 * all, so every `Sheet` (T32S5) silently took the inline fallback
 * (`usePortalOutlet` returning `false`), unable to escape an ancestor's
 * clipping/z-order. Wrapping here rather than in `../app/_layout.tsx`
 * keeps this file the one place that owns "what sits above every
 * screen's content"; `<Stack>` is a child of `<PortalHost>`, so a sheet
 * registered from any route renders above that route's own content, not
 * beside it. T33B5 (approvals) and T34B2 (extension form sheets) both
 * depend on this landing before their own sheets can prove anything past
 * the inline fallback — see this task's own report for why this shipped
 * first.
 */
export function NavigationShell() {
  const { theme } = useTheme();
  const screenOptions = useMemo(
    () => ({
      headerShown: false,
      contentStyle: { backgroundColor: theme.colors.page },
    }),
    [theme],
  );

  return (
    <PortalHost>
      <Stack screenOptions={screenOptions} />
    </PortalHost>
  );
}
