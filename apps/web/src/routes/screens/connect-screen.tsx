import { ConnectFormContainer } from "../../features/connect/index.js";

/**
 * `/connect` screen body. Kept as a thin, lazily-loaded wrapper (T27S2)
 * around the connect feature (`apps/web/src/features/connect/`, T27A1+)
 * so this file never needs to change again as that feature grows behind
 * the same import boundary; `connect.tsx` only owns the route
 * definition.
 */
export function ConnectScreen() {
  return <ConnectFormContainer />;
}
