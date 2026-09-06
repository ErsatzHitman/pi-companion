/**
 * Pure reset-decision for `ExtensionElementBoundary` (plan.md §11.4; T34A1).
 *
 * A caught error must not stay shown forever once the element it belongs to
 * is a different element (identity changed) or has moved on (its revision —
 * passed as `resetKey` — changed): the same "does this boundary get a fresh
 * chance to render?" comparison web's `registry-boundary.tsx` makes inside
 * `componentDidUpdate`. Kept here as a standalone function (rather than only
 * inline in the RN class component's lifecycle method) so it is directly
 * unit-testable in this workspace — `registry-boundary.tsx` imports
 * `react-native` transitively (via the `ErrorState` primitive it renders on
 * error) and so cannot itself be imported from a test file here; see
 * `registry.test.ts`'s doc comment.
 */

export interface ExtensionElementBoundaryIdentity {
  ns: string;
  elementId: string;
  /**
   * Changing this (e.g. to the element's revision) after a caught error
   * gives the element a fresh chance to render, instead of staying stuck
   * on a stale error forever once its upstream payload changes.
   */
  resetKey?: string | number;
}

/** True when `next` should clear a previously-caught error and re-render. */
export function shouldResetExtensionBoundary(
  prev: ExtensionElementBoundaryIdentity,
  next: ExtensionElementBoundaryIdentity,
): boolean {
  const identityChanged = prev.ns !== next.ns || prev.elementId !== next.elementId;
  const resetKeyChanged = prev.resetKey !== next.resetKey;
  return identityChanged || resetKeyChanged;
}
