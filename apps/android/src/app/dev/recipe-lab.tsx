import { lazy, Suspense } from "react";
import { Redirect } from "expo-router";
import { Text, View } from "react-native";

/**
 * `/dev/recipe-lab` — the T26B product-recipe lab (plan.md §10.4), moved
 * here from `apps/android/app/dev/recipe-lab.tsx` by T32S1C (see
 * `../_layout.tsx`'s doc comment for why the whole `apps/android/app/`
 * directory folded into `apps/android/src/app/`).
 *
 * "The component lab is development-only and must not ship in a
 * production bundle" applies equally to the recipe lab: see
 * `component-lab.tsx` in this directory for the full explanation of how
 * `__DEV__` dead-code elimination keeps the `React.lazy(() =>
 * import("../../dev/recipe-lab"))` branch (and everything it pulls in —
 * every recipe, the shared lab fixtures) out of a release build.
 */
const LazyRecipeLab = lazy(() => import("../../dev/recipe-lab"));

export default function DevRecipeLabRoute() {
  if (!__DEV__) {
    return <Redirect href="/" />;
  }

  return (
    <Suspense
      fallback={
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <Text>Loading recipe lab…</Text>
        </View>
      }
    >
      <LazyRecipeLab />
    </Suspense>
  );
}
