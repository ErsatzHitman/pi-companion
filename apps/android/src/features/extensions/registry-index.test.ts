import { describe, expect, it, vi } from "vitest";

import type { PiUiKind } from "@picompanion/protocol/pi-ui-bridge/schema";

/**
 * T34A3 — proves the Android registration chain's import side effect
 * actually executes, closing the defect this task's brief names as "THE
 * THING THAT MATTERS MOST":
 *
 * `piUiRendererRegistry.register(...)` only runs when `./renderers/index.ts`
 * is imported (T34A2's doc comment on that file). `registry-index.ts`
 * imports `./renderers` for exactly that side effect, but — as of this
 * task — nothing in the app repo-wide imports `registry-index.ts` itself
 * (T34A4 shipped `PinnedLiveExtensionArea` but did not mount it, and
 * T34A5 added `createPiUiSession` without one either; mounting both is
 * T32S4's job, `P5-W9`). Every other test file in this
 * directory therefore deliberately avoids importing `registry-index.ts` (or
 * anything that reaches it), because doing so pulls in every per-kind
 * `.tsx` view, and those views import `react-native`/`react-native-
 * reanimated`, whose entry points carry a Flow type header this
 * workspace's plain `vitest` cannot parse (`RolldownError: Parse failed …
 * Flow is not supported`, reproduced repeatedly — see `registry.test.ts`'s
 * own note).
 *
 * That is a real gap: without ever importing `registry-index.ts` under
 * test, nothing proves the registration side effect actually fires — a
 * typo in one `piUiRendererRegistry.register(...)` call, or a forgotten
 * import in `renderers/index.ts`, would only surface on a real device via
 * `registry-view.tsx`'s "no renderer" diagnostic. This file closes that gap
 * the same way `apps/android/src/platform/lifecycle.test.ts` and
 * `apps/android/src/app/resume-wiring.test.ts` already closed it for
 * `AppState`: `vi.mock("react-native", ...)` / `vi.mock("react-native-
 * reanimated", ...)` intercept the two packages before Vitest ever tries to
 * parse their real source, so every `.tsx` view module along the import
 * chain loads successfully — its top-level `import { View, Text, ... }
 * from "react-native"` bindings resolve to inert stand-ins instead of
 * failing to parse.
 *
 * The stand-ins below are an enumerated, not generic, set: every named
 * export the current import chain actually uses (verified with `grep -rh
 * 'from "react-native"'`/`'from "react-native-reanimated"'` across
 * `features/extensions/`, `ui/primitives/`, and `ui/theme/` while building
 * this test — see the list each mock covers). A catch-all `Proxy` was tried
 * first and rejected: `vi.mock`'s own module-wrapping throws `TypeError:
 * Cannot create proxy with a non-object as target or handler` when the
 * factory returns a bare `Proxy` rather than a plain object, reproduced
 * directly against this workspace's Vitest before writing the version
 * below. None of these stand-ins are ever *called* by this test — no
 * `react-test-renderer`/RTL is wired into this workspace, so nothing here
 * is rendered — every module in the chain only touches these APIs from
 * inside a component function body or a hook (verified by reading each
 * file), never at module top level, so an inert, uncalled stand-in is
 * sufficient for an import-only test like this one.
 */
vi.mock("react-native", () => {
  function Stub(): null {
    return null;
  }
  return {
    StyleSheet: { create: (styles: unknown) => styles, hairlineWidth: 1 },
    Text: Stub,
    View: Stub,
    Pressable: Stub,
    ScrollView: Stub,
    Modal: Stub,
    TextInput: Stub,
    AccessibilityInfo: {
      isReduceMotionEnabled: async () => false,
      addEventListener: () => ({ remove: () => undefined }),
    },
    BackHandler: { addEventListener: () => ({ remove: () => undefined }) },
    findNodeHandle: () => null,
    useColorScheme: () => "light",
    Linking: { openURL: async () => true },
  };
});

vi.mock("react-native-reanimated", () => {
  function Stub(): null {
    return null;
  }
  const Animated = { View: Stub, Text: Stub, createAnimatedComponent: (c: unknown) => c };
  return {
    default: Animated,
    Easing: { ease: (v: number) => v, out: (fn: unknown) => fn, linear: (v: number) => v },
    useAnimatedStyle: () => ({}),
    useSharedValue: (value: unknown) => ({ value }),
    withTiming: (value: unknown) => value,
    withRepeat: (value: unknown) => value,
  };
});

// T349: `ui/primitives/index.ts` now also exports `VectorIcon`
// (`vector-icons.tsx`), whose `react-native-svg` import carries the same
// unparseable-by-plain-vitest source every `react-native` package in this
// file's chain does. Stood in for exactly like the two mocks above, and
// for the same reason: nothing here renders, so an inert stand-in is
// enough for an import-only test. Enumerated, not generic -- the members
// are the ones `vector-icons.tsx` actually imports today, so adding a new
// SVG element there is a deliberate two-file change, not a silent one.
vi.mock("react-native-svg", () => {
  function Stub(): null {
    return null;
  }
  return { default: Stub, Circle: Stub, Path: Stub, Rect: Stub };
});

const { piUiRendererRegistry } = await import("./registry-index");

describe("Android Pi UI Bridge registration chain (T34A3)", () => {
  it("registers a renderer for every kind implemented so far when registry-index.ts is imported", () => {
    // The exact set plan.md §11.3 defines as implemented through this task:
    // T34A2 shipped status/widget/progress, T34A3 added log/markdown/
    // composer, T34B1 (P5-W8) added roster, T34B2 (same wave) added form,
    // T34B3 (P5-W11) added diff, and T34B4 (P5-W13) added `panel` — the
    // last link in the T34 chain, closing the frozen ten.
    const implementedKinds = [
      "status",
      "widget",
      "progress",
      "log",
      "markdown",
      "composer",
      "roster",
      "form",
      "diff",
      "panel",
    ] as const;

    for (const kind of implementedKinds) {
      expect(piUiRendererRegistry.has(kind)).toBe(true);
      expect(piUiRendererRegistry.get(kind)).toBeTypeOf("function");
    }
  });

  it("does not register a kind outside the frozen ten", () => {
    // Every kind `PiUiKindSchema` (plan.md §11.3) actually defines is now
    // registered above — `panel` was the last one, landed by this task
    // (T34B4). This guard's job going forward is only to catch a kind
    // outside the frozen ten ever being registered by mistake (there is no
    // eleventh kind to add), not to pin a real, unimplemented one shut —
    // the defect two prior merge gates (P5-W7's `cda635b`, and the note
    // this replaces) had to repeatedly remove.
    for (const kind of ["bogus-kind", "screen", "sheet"] as const) {
      expect(piUiRendererRegistry.has(kind as unknown as PiUiKind)).toBe(false);
    }
  });

  it("registers exactly ten kinds — the frozen v1 vocabulary, in the order renderers/index.ts calls register()", () => {
    expect(piUiRendererRegistry.kinds()).toEqual([
      "status",
      "widget",
      "progress",
      "log",
      "markdown",
      "composer",
      "roster",
      "form",
      "diff",
      "panel",
    ]);
  });
});
