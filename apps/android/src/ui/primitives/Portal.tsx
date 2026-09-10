import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { StyleSheet, View } from "react-native";

/**
 * Same-window portal for `Sheet`/T33B5's approvals sheet/T34B2's form
 * sheet (plan.md §9.1 "Gorhom Bottom Sheet and Portal", §9.3 "the
 * composer must retain keyboard ownership when an extension sheet
 * opens; use Portal rather than a detached Modal where required").
 *
 * `@gorhom/portal` (the library plan.md §9.1 names) is not installed in
 * this workspace — `apps/android/package.json` has no `@gorhom/*`
 * dependency and this task's rules forbid `npm install` — so this is a
 * minimal replacement built from plain React context, not adapted from
 * any library. It has exactly the property the plan needs: registered
 * content renders as ordinary React Native views inside whichever
 * screen's tree the nearest `PortalHost` sits in, so it never opens a
 * second native Android `Window` the way `<Modal>` does. A second native
 * window is what actually competes for IME focus with the composer's
 * `TextInput` on Android — a same-window overlay does not, which is the
 * whole reason plan.md asks for a Portal instead of a Modal here.
 *
 * **Who mounts `<PortalHost>`:** it needs to sit once, near the top of
 * the screen tree, above whatever renders a `Sheet` — not this file:
 * `ui/primitives` has no app-root component to mount it from. **T32S6
 * mounted it** (commit `fe6d221`), wrapping `<Stack>` in
 * `apps/android/src/app-shell/navigation-shell.tsx`, so every route that
 * `<Stack>` renders is already inside a host. (This paragraph previously
 * named T32S4/T33B5/T34B2 as candidates and said no host existed yet;
 * the P5-W10 merge gate corrected it, since T32S6 made it false and
 * T32S6 did not own this file.) Where no host is mounted —
 * a `Sheet` rendered outside that `<Stack>`, or a unit test —
 * `usePortalOutlet` reports that and `Sheet` falls back
 * to rendering its panel inline (see `Sheet.tsx`) — still never a
 * `Modal`, just not yet escaping an ancestor's clipping/z-order the way
 * a root-mounted host would. That fallback is a deliberate continuity
 * choice, not a bug: a `Sheet` must keep working before any shell task
 * mounts a host.
 *
 * **T340: `bottomInset`.** The overlay each registered node renders into
 * is `StyleSheet.absoluteFill` — the whole display, so a sheet's scrim
 * covers everything — and a `Sheet` bottom-aligns its panel inside it
 * (`justifyContent: "flex-end"`). Because a portal keeps the composer's
 * `TextInput` focused (the whole point of it over a `Modal`), the
 * keyboard stays up when a sheet opens, and on edge-to-edge Android the
 * IME is drawn over the bottom of that overlay: Maestro run
 * 34477213142's `notification-approval` screenshot shows the dimmed
 * scrim and no panel, the approvals sheet laid out under the keyboard
 * and pruned from the accessibility tree. The host therefore pads the
 * overlay's bottom by `bottomInset`; `app-shell/navigation-shell.tsx`
 * passes it the live keyboard inset (`useKeyboardInset`, the same
 * measurement `compact-shell.tsx` pads the shell by), so a bottom-aligned
 * panel sits just above the keyboard while the scrim still covers the
 * display behind it. Zero (the default) is the pre-T340 layout.
 */
interface PortalRegistry {
  register: (key: string, node: ReactNode) => void;
  unregister: (key: string) => void;
}

const PortalContext = createContext<PortalRegistry | null>(null);

export interface PortalHostProps {
  children?: ReactNode;
  /** Bottom padding applied to every portaled overlay — the keyboard inset, from the shell (T340). */
  bottomInset?: number;
}

/** Mount once near the root of a screen (or the app shell) so `usePortalOutlet` below it has somewhere to render into. */
export function PortalHost({ children, bottomInset = 0 }: PortalHostProps) {
  const [nodes, setNodes] = useState<Record<string, ReactNode>>({});

  const registry = useMemo<PortalRegistry>(
    () => ({
      register: (key, node) => setNodes((prev) => ({ ...prev, [key]: node })),
      unregister: (key) =>
        setNodes((prev) => {
          if (!(key in prev)) return prev;
          const next = { ...prev };
          delete next[key];
          return next;
        }),
    }),
    [],
  );

  return (
    <PortalContext.Provider value={registry}>
      {children}
      {Object.entries(nodes).map(([key, node]) => (
        <View
          key={key}
          style={[StyleSheet.absoluteFill, { paddingBottom: bottomInset }]}
          pointerEvents="box-none"
        >
          {node}
        </View>
      ))}
    </PortalContext.Provider>
  );
}

/**
 * Registers `node` under `key` into the nearest `PortalHost` for as long
 * as `active` stays true, and returns whether a host was actually found.
 * A caller with no host above it (return value `false`) should render
 * `node` itself, in place, rather than lose it — see `Sheet.tsx`.
 */
export function usePortalOutlet(key: string, node: ReactNode, active: boolean): boolean {
  const registry = useContext(PortalContext);

  useEffect(() => {
    if (!registry || !active) return;
    registry.register(key, node);
    return () => registry.unregister(key);
  }, [registry, key, node, active]);

  return registry !== null;
}
