import { Link } from "@tanstack/react-router";

import { EmptyState } from "../ui/primitives/index.js";

/**
 * `notFoundComponent` for the root route (T27S2). Unknown paths — and any
 * matched route that calls `notFound()` — render this instead of TanStack
 * Router's generic `<p>Not Found</p>` default, so a bad deep link never
 * shows a blank page. Kept in the static bundle (not lazy) so it is
 * always available even when the failure was itself a lazy-chunk load
 * error.
 */
export function NotFoundScreen() {
  return (
    <div className="route-not-found" data-testid="route-not-found">
      <EmptyState
        title="Page not found"
        description="There is no screen at this address. Check the link, or start again from the connect screen."
      />
      <p>
        <Link className="pc-link" to="/connect">
          Go to Connect
        </Link>
      </p>
    </div>
  );
}
