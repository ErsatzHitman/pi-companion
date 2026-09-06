import type { ErrorComponentProps } from "@tanstack/react-router";
import { Link } from "@tanstack/react-router";

import { Button, ErrorState } from "../ui/primitives/index.js";

/**
 * `errorComponent` for the root route (T27S2). Catches any error thrown
 * while loading or rendering a matched route — including a failed lazy
 * chunk fetch — so a route failure shows a recoverable screen instead of
 * an unhandled exception and a blank page. Kept in the static bundle
 * (not lazy) for the same reason as `NotFoundScreen`.
 */
export function RouteErrorScreen({ error, reset }: ErrorComponentProps) {
  const message = error instanceof Error ? error.message : "An unknown error occurred.";
  return (
    <div className="route-error" data-testid="route-error">
      <ErrorState title="This screen failed to load" description={message} />
      <p>
        <Button kind="secondary" onClick={reset}>
          Try again
        </Button>{" "}
        <Link className="pc-link" to="/connect">
          Go to Connect
        </Link>
      </p>
    </div>
  );
}
