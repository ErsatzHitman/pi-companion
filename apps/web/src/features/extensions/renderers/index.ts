/**
 * Registers the `status`, `widget`, `progress` (T29A2), `log`,
 * `markdown`, `composer` (T29A3), `roster` (T29B1), `form` (T29B2),
 * `diff` (T29B3), and `panel` (T29B4) kind renderers into the shared web
 * renderer registry (`../registry.js`; T29A1).
 *
 * Importing this module (for its side effect) is how app wiring turns these
 * registrations on — individual renderer modules never register
 * themselves at their own definition site, so importing one of them
 * directly (e.g. in a test) never double-registers it.
 *
 * This module is itself imported statically from `../rail/rail-element-
 * card.js`, which `root-route.js` — the whole router's always-mounted
 * root component (plan.md §8.3) — reaches on every route, not just a
 * session. `diff.js`'s renderer alone statically imports `../files/
 * file-syntax-highlight.js`, which pulls in `@picompanion/highlight`'s
 * `@lezer/*`-backed parser bundle (measured 225.3 KiB+ gzip, plan.md
 * §14.5 budget) — the only one of these ten whose transitive dependency
 * is that large. T58 registers it as `React.lazy(() =>
 * import("./diff.js"))` instead of a static import so that chunk is
 * requested only the first time a live `diff`-kind element actually
 * renders, rather than on every route via the entry's `modulepreload`
 * graph; `registry-view.js`'s `<Suspense>` boundary around `<Renderer
 * ... />` covers exactly this one kind's async resolution; every other
 * kind here resolves synchronously (already-loaded modules never
 * suspend), so this changes nothing about how they render.
 */
import { createElement, lazy } from "react";

import { piUiRendererRegistry, type PiUiKindRenderer } from "../registry.js";
import { ComposerRenderer } from "./composer.js";
import { FormRenderer } from "./form.js";
import { LogRenderer } from "./log.js";
import { MarkdownRenderer } from "./markdown.js";
import { PanelRenderer } from "./panel.js";
import { ProgressRenderer } from "./progress.js";
import { RosterRenderer } from "./roster.js";
import { StatusRenderer } from "./status.js";
import { WidgetRenderer } from "./widget.js";

const LazyDiffRenderer = lazy(() =>
  import("./diff.js").then((module) => ({ default: module.DiffRenderer })),
);
/**
 * Plain function-component wrapper around `LazyDiffRenderer` (rather than
 * registering the `LazyExoticComponent` directly) purely so this stays a
 * `PiUiKindRenderer<"diff">` (`ComponentType`) like every other
 * registration here — `register`'s signature does not need to know
 * anything special about lazy components.
 */
const DiffRenderer: PiUiKindRenderer<"diff"> = (props) => createElement(LazyDiffRenderer, props);

piUiRendererRegistry.register("status", StatusRenderer);
piUiRendererRegistry.register("widget", WidgetRenderer);
piUiRendererRegistry.register("progress", ProgressRenderer);
piUiRendererRegistry.register("log", LogRenderer);
piUiRendererRegistry.register("markdown", MarkdownRenderer);
piUiRendererRegistry.register("composer", ComposerRenderer);
piUiRendererRegistry.register("roster", RosterRenderer);
piUiRendererRegistry.register("form", FormRenderer);
piUiRendererRegistry.register("diff", DiffRenderer);
piUiRendererRegistry.register("panel", PanelRenderer);

export {
  ComposerRenderer,
  DiffRenderer,
  FormRenderer,
  LogRenderer,
  MarkdownRenderer,
  PanelRenderer,
  ProgressRenderer,
  RosterRenderer,
  StatusRenderer,
  WidgetRenderer,
};
