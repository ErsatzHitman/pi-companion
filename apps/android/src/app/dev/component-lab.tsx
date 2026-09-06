import { lazy, Suspense } from "react";
import { Redirect } from "expo-router";
import { Text, View } from "react-native";

/**
 * `/dev/component-lab` — the T26A component lab (plan.md §10.3), moved
 * here from `apps/android/app/dev/component-lab.tsx` by T32S1C (see
 * `../_layout.tsx`'s doc comment for why the whole `apps/android/app/`
 * directory folded into `apps/android/src/app/`).
 *
 * "The component lab is development-only and must not ship in a
 * production bundle": Metro/`babel-preset-expo` replace the global
 * `__DEV__` with a literal boolean and the production Terser pass dead-
 * code-eliminates the branch that's never taken, so the production
 * branch's `Redirect` is all that remains — the `React.lazy(() =>
 * import("../../dev/component-lab"))` call below (and everything it
 * pulls in: every primitive, the shared lab fixtures) is never reached
 * and never bundled into a release build. This file always exists as an
 * Expo Router route (file-based routing needs it on disk), but its
 * content collapses to a 404-style redirect outside `__DEV__`.
 */
const LazyComponentLab = lazy(() => import("../../dev/component-lab"));

export default function DevComponentLabRoute() {
  if (!__DEV__) {
    return <Redirect href="/" />;
  }

  return (
    <Suspense
      fallback={
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <Text>Loading component lab…</Text>
        </View>
      }
    >
      <LazyComponentLab />
    </Suspense>
  );
}
