import {
  getNativeMotion,
  getNativeTheme,
  type NativeMotion,
  type NativeTheme,
} from "@picompanion/design-tokens";
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { AccessibilityInfo, useColorScheme } from "react-native";

/**
 * Android theme runtime (plan.md §10.2, §10.5).
 *
 * Resolves the typed `NativeTheme`/`NativeMotion` objects from
 * `@picompanion/design-tokens` against the two accessibility signals the
 * platform actually exposes to React Native: `useColorScheme()` for
 * dark/light, and `AccessibilityInfo.isReduceMotionEnabled` for
 * `prefers-reduced-motion` parity (plan.md §10.5 "reduced-motion
 * behavior"). High contrast has no equivalent RN/Android bridge today, so
 * it defaults to `false`; the hook shape (`getNativeTheme(scheme,
 * highContrast)`) is already the accessibility hook a future signal plugs
 * into without changing any component.
 */
export interface ThemeContextValue {
  theme: NativeTheme;
  motion: NativeMotion;
  reduceMotion: boolean;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const scheme = useColorScheme() === "dark" ? "dark" : "light";
  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => {
    let mounted = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((value) => {
        if (mounted) setReduceMotion(value);
      })
      .catch(() => undefined);
    const subscription = AccessibilityInfo.addEventListener("reduceMotionChanged", (value) => {
      setReduceMotion(value);
    });
    return () => {
      mounted = false;
      subscription.remove();
    };
  }, []);

  const value = useMemo<ThemeContextValue>(() => {
    const theme = getNativeTheme(scheme, false);
    const motion = getNativeMotion(reduceMotion);
    return { theme, motion, reduceMotion };
  }, [scheme, reduceMotion]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const value = useContext(ThemeContext);
  if (!value) {
    throw new Error("useTheme() called outside of <ThemeProvider>");
  }
  return value;
}
