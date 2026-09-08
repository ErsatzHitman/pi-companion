import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { AppCoreProvider } from "./core-context";
import { AppErrorBoundary } from "../app-shell/error-boundary";
import { NavigationShell } from "../app-shell/navigation-shell";
import { useAppFonts } from "../ui/theme/fonts";
import { ThemeProvider } from "../ui/theme/theme-context";

/**
 * Root Expo Router layout — plan.md §6, T32S1 ("Build the Android
 * navigation shell"), moved here by T32S1C.
 *
 * plan.md §6's structure diagram proposed a split between
 * `apps/android/app/` ("Expo Router routes only") and `apps/android/src/app/`
 * ("providers, bootstrap, error boundaries"), mirroring web's
 * `routes/`/`app/` split. That split does not survive contact with the
 * actual tool: Expo Router selects whichever of `src/app` or `app` exists
 * as its router root, preferring `src/app` (`@expo/cli`'s `router.js`,
 * its router-root resolution logic),
 * so once `src/app` existed (T32S1) every file that used to live in
 * `apps/android/app/` was never bundled and silently did nothing —
 * surfaced by T58C's measurement probe. T32S1C folds the two directories
 * into one (`apps/android/src/app/`, this file's new home) rather than
 * keep a split the tooling does not honour.
 *
 * Gates the first paint on `useAppFonts()` (T13C): Inter/Geist Mono must be
 * the fonts on screen from the first frame, not a system face that swaps
 * out once loading finishes, so nothing renders until `fontsLoaded` (or a
 * load `fontError`, which falls through to the token layer's system
 * fallbacks rather than blocking the app forever — bundling is the primary
 * path, not the only one).
 *
 * The provider order — error boundary, then theme, then app core, then
 * safe-area, then the themed `<NavigationShell>` (T32S1) — matches
 * `apps/web/src/app/App.tsx`'s "outermost boundary first, router last"
 * shape on the other platform: every provider a screen can read from must
 * already be mounted by the time `NavigationShell`'s `<Stack>` renders
 * the first route.
 */
export default function RootLayout() {
  const { fontsLoaded, fontError } = useAppFonts();
  if (!fontsLoaded && !fontError) {
    return null;
  }

  return (
    <AppErrorBoundary>
      <ThemeProvider>
        <AppCoreProvider>
          <SafeAreaProvider>
            <StatusBar style="auto" />
            <NavigationShell />
          </SafeAreaProvider>
        </AppCoreProvider>
      </ThemeProvider>
    </AppErrorBoundary>
  );
}
