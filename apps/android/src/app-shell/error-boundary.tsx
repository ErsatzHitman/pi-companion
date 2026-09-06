import { Component, type ReactNode } from "react";
import { StyleSheet, Text, View } from "react-native";

interface Props {
  children: ReactNode;
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
 */
export class AppErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  render() {
    if (this.state.error) {
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

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
    gap: 8,
  },
  title: {
    fontSize: 18,
    fontWeight: "600",
  },
  message: {
    fontSize: 14,
    textAlign: "center",
  },
});
