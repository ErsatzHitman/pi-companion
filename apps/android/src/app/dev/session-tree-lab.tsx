import { lazy, Suspense } from "react";
import { Redirect } from "expo-router";
import { Text, View } from "react-native";

/**
 * `/dev/session-tree-lab` — T39A's device-level proof surface for
 * `SessionTreeSheet` (see `../../dev/session-tree-lab.tsx` for the full
 * rationale). Follows `component-lab.tsx`'s exact convention in this
 * directory: `__DEV__` dead-code elimination keeps the
 * `React.lazy(() => import("../../dev/session-tree-lab"))` branch (and
 * everything it pulls in) out of a release build, same as every other
 * file in this directory.
 */
const LazySessionTreeLab = lazy(() => import("../../dev/session-tree-lab"));

export default function DevSessionTreeLabRoute() {
  if (!__DEV__) {
    return <Redirect href="/" />;
  }

  return (
    <Suspense
      fallback={
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <Text>Loading session tree lab…</Text>
        </View>
      }
    >
      <LazySessionTreeLab />
    </Suspense>
  );
}
