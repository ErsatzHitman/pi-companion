import { nativeFontFamilyNames } from "@picompanion/design-tokens";
import { useFonts } from "expo-font";

/**
 * Self-hosted Inter / JetBrains Mono loader (T13C, docs/issues-from-plan.md
 * "Bundle Inter/Geist Mono and complete light-theme values"; T345 swapped
 * the mono face from Geist Mono to JetBrains Mono, the one the S7 phone
 * design sets — see `nativeFontFamilyNames`' own note in
 * `@picompanion/design-tokens`).
 *
 * Registers every bundled TTF (vendored under `assets/fonts/`, SIL Open
 * Font License 1.1 — see `THIRD_PARTY_NOTICES.md` and the `OFL-*.txt` files
 * next to the assets) under the *exact* keys
 * `@picompanion/design-tokens`' `nativeFontFamilyNames` publishes, so a
 * theme's resolved `fontFamily` (see `native.ts`'s `nativeFontFamily()`)
 * always names a font this call actually registered. Getting that name
 * wrong is the Android-specific failure mode the gap analysis called out:
 * unlike the web (an unresolvable CSS font stack degrades to its next
 * fallback), a `fontFamily` string RN can't match against a registered
 * typeface just silently renders the platform default with no error.
 *
 * `apps/android/src/app/_layout.tsx` gates the app's first paint on this
 * hook's `fontsLoaded` flag so the interface never flashes an
 * un-bundled system face before swapping to Inter/JetBrains Mono.
 *
 * Metro's asset resolution needs a static, literal-string `require(...)`
 * call per font (it cannot follow a variable path), so each asset is
 * `require()`d individually here; only the *object key* each one is
 * registered under is computed from `nativeFontFamilyNames`.
 */
export function useAppFonts(): { fontsLoaded: boolean; fontError: Error | null } {
  const [fontsLoaded, fontError] = useFonts({
    [nativeFontFamilyNames.sans.regular]: require("../../../assets/fonts/Inter-400.ttf"),
    [nativeFontFamilyNames.sans.medium]: require("../../../assets/fonts/Inter-500.ttf"),
    [nativeFontFamilyNames.sans.semibold]: require("../../../assets/fonts/Inter-600.ttf"),
    [nativeFontFamilyNames.sans.bold]: require("../../../assets/fonts/Inter-700.ttf"),
    [nativeFontFamilyNames.mono.regular]: require("../../../assets/fonts/JetBrainsMono-400.ttf"),
    [nativeFontFamilyNames.mono.medium]: require("../../../assets/fonts/JetBrainsMono-500.ttf"),
    [nativeFontFamilyNames.mono.semibold]: require("../../../assets/fonts/JetBrainsMono-600.ttf"),
    [nativeFontFamilyNames.mono.bold]: require("../../../assets/fonts/JetBrainsMono-700.ttf"),
  });
  return { fontsLoaded, fontError: fontError ?? null };
}
