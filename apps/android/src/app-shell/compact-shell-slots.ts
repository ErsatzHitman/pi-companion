import type { ReactNode } from "react";

/**
 * Lives in `apps/android/src/app-shell/`, a sibling of the Expo Router
 * root (`apps/android/src/app/`), not inside it — T32S2. Every `.ts`/
 * `.tsx` file directly under the router root is scanned by Expo
 * Router's `require.context` (and, independently, its typed-routes file
 * watcher) and registered as a route node even with no default export;
 * this module has none, so it was moved out rather than left to become
 * a silent broken route (see T32S2's own task notes, and
 * `../app/router-root.test.ts`'s `KNOWN_NON_ROUTE_EXCEPTIONS` for the
 * remaining files that could *not* move the same way — `app/core-
 * context.tsx`/`app/route-placeholder.tsx` as of T32S3, still imported
 * directly by `features/connect`, `features/sessions`, `features/files`,
 * and `features/terminal`; `app/core.ts`/`app/resume-signals.ts` did
 * move here, to `./core.ts`/`./resume-signals.ts`, once T32S3 found
 * their only importers were inside `apps/android/src/app/` after all).
 *
 * The plan.md §9.2 compact session layout's named-slot vocabulary —
 * T32S1. Split out from `compact-shell.tsx` itself (which additionally
 * imports `react-native`) purely so this type and the slot order it
 * governs stay importable — and therefore genuinely unit-testable, not
 * just source-contract-testable — from this workspace's plain `vitest`
 * setup, which cannot load a `react-native`-importing module (see
 * `../app/dev/component-lab.test.ts`'s doc comment).
 */
export interface CompactShellSlots {
  header?: ReactNode | null;
  statusStrip?: ReactNode | null;
  liveExtension?: ReactNode | null;
  transcript?: ReactNode | null;
  composer?: ReactNode | null;
}

/**
 * Stable slot identifiers, in the §9.2 top-to-bottom render order:
 * host/session header; compact status strip; virtualized transcript (the
 * one flexible region); pinned live extension area above the composer;
 * bottom composer.
 */
export const COMPACT_SHELL_SLOT_ORDER = [
  "header",
  "statusStrip",
  "transcript",
  "liveExtension",
  "composer",
] as const satisfies readonly (keyof CompactShellSlots)[];
