import { lazy, Suspense } from "react";
import { Redirect } from "expo-router";
import { Text, View } from "react-native";

/**
 * `/dev/recovered-turn-lab` — T106's device-level proof surface for
 * `RecoveredTurnBanner` (see `../../dev/recovered-turn-lab.tsx` for the
 * full rationale). Follows `component-lab.tsx`'s exact convention in
 * this directory: `__DEV__` dead-code elimination keeps the
 * `React.lazy(() => import("../../dev/recovered-turn-lab"))` branch (and
 * everything it pulls in) out of a release build, same as every other
 * file in this directory.
 */
const LazyRecoveredTurnLab = lazy(() => import("../../dev/recovered-turn-lab"));

export default function DevRecoveredTurnLabRoute() {
  if (!__DEV__) {
    return <Redirect href="/" />;
  }

  return (
    <Suspense
      fallback={
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <Text>Loading recovered turn lab…</Text>
        </View>
      }
    >
      <LazyRecoveredTurnLab />
    </Suspense>
  );
}
