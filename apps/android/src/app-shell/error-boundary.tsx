import { getNativeTheme, type NativeTheme } from "@picompanion/design-tokens";
import { Component, type ReactNode } from "react";
import { StyleSheet, Text, useColorScheme, View } from "react-native";

import { asFontWeight } from "../ui/theme/native-style-helpers";

interface Props {
  children: ReactNode;
  theme: NativeTheme;
}

interface State {
  error: Error | null;
}

/**
 * Lives in `app-shell/`, not the Expo Router root — see
 * `./compact-shell-slots.ts`'s doc comment (T32S2).
 *
 * Minimal root error boundary — plan.md §6 (`src/app/` owns providers,
 * bootstrap, and error boundaries). Isolates renderer failures per
 * plan.md §16 rather than crashing the whole shell; later tasks may add
 * reporting/redaction on top of this.
 *
 * A class component cannot call a hook itself, so `AppErrorBoundary` below
 * wraps this one and passes `theme` down as a prop. It resolves that theme
 * with `useColorScheme()` + `getNativeTheme()` directly rather than
 * `useTheme()` (`../ui/theme/theme-context`): `RootLayout`
 * (`../app/_layout.tsx`) deliberately mounts this boundary OUTSIDE
 * `ThemeProvider` — "outermost boundary first" in that file's own doc
 * comment — specifically so it can catch a crash in `ThemeProvider` itself.
 * `useTheme()` throws when called with no `ThemeProvider` ancestor, which
 * would make this boundary crash before it could render anything; reading
 * the color scheme and building the theme object directly needs no
 * ancestor and works no matter what failed.
 */
class AppErrorBoundaryClass extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  render() {
    if (this.state.error) {
      const styles = createStyles(this.props.theme);
      return (
        <View style={styles.container}>
          <Text style={styles.title}>Something went wrong</Text>
          <Text style={styles.message}>{this.state.error.message}</Text>
        </View>
      );
    }
    return this.props.children;
  }
}

export function AppErrorBoundary({ children }: Omit<Props, "theme">) {
  const scheme = useColorScheme() === "dark" ? "dark" : "light";
  const theme = getNativeTheme(scheme, false);
  return <AppErrorBoundaryClass theme={theme}>{children}</AppErrorBoundaryClass>;
}

function createStyles(theme: NativeTheme) {
  return StyleSheet.create({
    container: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: theme.colors.page,
      padding: theme.spacing[6],
      gap: theme.spacing[2],
    },
    title: {
      color: theme.colors.ink,
      fontSize: theme.typography.variant.heading.fontSize,
      fontWeight: asFontWeight(theme.typography.variant.heading.fontWeight),
    },
    message: {
      color: theme.colors["ink-2"],
      fontSize: theme.typography.variant.body.fontSize,
      textAlign: "center",
    },
  });
}
