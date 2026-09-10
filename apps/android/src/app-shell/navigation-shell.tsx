import { Stack } from "expo-router";
import { useMemo } from "react";
import { StyleSheet } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { PortalHost } from "../ui/primitives";
import { useTheme } from "../ui/theme/theme-context";
import { useKeyboardInset } from "./keyboard-inset";

const SAFE_AREA_EDGES = ["top", "bottom"] as const;

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
 *
 * **T327: `<SafeAreaView edges={["top", "bottom"]}>` wraps `<Stack>`,
 * inside `<PortalHost>`.** Expo SDK 54 / Android 15+ draws every app
 * edge-to-edge and nothing in this app applied the resulting insets, so
 * every screen's content started at y=0 — under the status bar — and ran
 * to the bottom of the display, under the navigation bar. Measured on
 * Maestro run 34439323899, the first dispatch to survive native module
 * registration (T325/T326): the onboarding heading painted entirely inside
 * the status bar window's `[0,0][1080,136]`, so the accessibility layer
 * pruned it as not visible to the user and every flow's first assertion,
 * `"Welcome to Pi Companion" is visible`, failed on a heading the
 * screenshot plainly shows. `headerShown: false` on every screen means no
 * native header was ever going to absorb that inset, so the shell applies
 * it once here rather than per screen. `<PortalHost>` stays outermost on
 * purpose: a sheet's backdrop should cover the whole display, insets
 * included. The `(tabs)` layout passes `safeAreaInsets={{ bottom: 0 }}`
 * to its navigator because the tab bar would otherwise add the bottom
 * inset a second time on top of this view's padding.
 *
 * T340: the host is also handed the live keyboard inset
 * (`./keyboard-inset.ts`'s `useKeyboardInset`, the measurement
 * `compact-shell.tsx` already pads the shell by). A portaled sheet keeps
 * the composer focused, so the keyboard stays up when one opens, and
 * without this its bottom-aligned panel was laid out under the IME
 * (Maestro run 34477213142's `notification-approval`: scrim visible,
 * `approvals-dialog` pruned) — see `PortalHost`'s own doc comment.
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
  const styles = useMemo(
    () => StyleSheet.create({ safeArea: { flex: 1, backgroundColor: theme.colors.page } }),
    [theme],
  );
  const keyboardInset = useKeyboardInset();

  return (
    <PortalHost bottomInset={keyboardInset}>
      <SafeAreaView edges={SAFE_AREA_EDGES} style={styles.safeArea}>
        <Stack screenOptions={screenOptions} />
      </SafeAreaView>
    </PortalHost>
  );
}
