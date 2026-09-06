/**
 * Pi UI element identity (plan.md §4.2, §11.3, §12.3).
 *
 * `ns` is mandatory on the wire precisely because two extensions may both use
 * `id: "main"`. The client therefore keys state on the composite `ns:id` key
 * and never on a bare element id — mirroring the daemon's
 * `packages/server/.../pi/ui-bridge/identity.ts`, which this module is the
 * client-side counterpart of (frontend-core cannot depend on `@picompanion/server`,
 * so the identity rules are re-expressed here rather than imported).
 */

/** Separates `ns` from `id` in a composite element id. */
export const PIUI_NS_SEPARATOR = ":";

/** Builds the state-store key for an element. */
export function piUiElementKey(ns: string, id: string): string {
  return `${ns}${PIUI_NS_SEPARATOR}${id}`;
}

/** Convenience overload for an object carrying `ns`/`id` fields. */
export function piUiElementKeyOf(element: { ns: string; id: string }): string {
  return piUiElementKey(element.ns, element.id);
}
