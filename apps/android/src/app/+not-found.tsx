import { Link, usePathname } from "expo-router";
import { useMemo } from "react";
import { StyleSheet, Text, View } from "react-native";

import { useTheme } from "../ui/theme/theme-context";
import { matchDeepLinkPath } from "../app-shell/deep-link-routing";

/**
 * Expo Router's reserved `+not-found` fallback — T32S2's answer to "an
 * invalid link lands on an explained fallback screen". `+not-found.tsx`
 * is a genuinely special filename to Expo Router's own route generator
 * (`getRoutesCore.js`'s filename parser explicitly exempts it from the
 * "route nodes cannot start with '+'" rule), not one of the ten stray
 * modules T32S2 moved out of this directory: it renders whenever a path
 * — a `picompanion://` deep link included — matches no other route in
 * this tree.
 *
 * `matchDeepLinkPath` (`../app-shell/deep-link-routing.ts`) is not
 * actually needed to decide *that* this screen should render — Expo
 * Router already made that call by routing here — but re-running it
 * against the current pathname lets this screen say *why* in the same
 * vocabulary the rest of the app uses (and gives
 * `deep-link-routing.test.ts` a second, redundant proof point that a
 * path Expo Router itself would 404 on is exactly the set this module
 * calls `not-found`).
 */
export default function NotFoundRoute() {
  const pathname = usePathname();
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const match = matchDeepLinkPath(pathname);

  return (
    <View style={styles.container} testID="not-found">
      <Text style={styles.title} accessibilityRole="header">
        This link doesn't lead anywhere
      </Text>
      <Text style={styles.detail}>
        {match.kind === "not-found"
          ? `"${match.path}" isn't a screen in Pi Companion.`
          : `"${pathname}" isn't a screen in Pi Companion.`}
      </Text>
      <Link href="/connect" style={styles.link}>
        Go to Connect
      </Link>
    </View>
  );
}

function createStyles(theme: ReturnType<typeof useTheme>["theme"]) {
  return StyleSheet.create({
    container: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
      gap: theme.spacing[2],
      backgroundColor: theme.colors.page,
      padding: theme.spacing[6],
    },
    title: {
      color: theme.colors.ink,
      fontSize: theme.typography.variant.title.fontSize,
    },
    detail: {
      color: theme.colors["ink-2"],
      fontSize: theme.typography.variant.label.fontSize,
      textAlign: "center",
    },
    link: {
      color: theme.colors.accent,
      fontSize: theme.typography.variant.label.fontSize,
      marginTop: theme.spacing[2],
    },
  });
}
