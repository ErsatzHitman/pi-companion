/**
 * `features/terminal` barrel (plan.md §8.4, T30A2/T30A3). Owns the web
 * xterm terminal route: mounting xterm.js on the framework-neutral
 * `TerminalController` (`@picompanion/frontend-core`'s `terminal`
 * domain, T30A1) behind a lazily-loaded route, plus resize-ownership and
 * reconnect policy layered on top (T30A3).
 */
export { TerminalRoute } from "./terminal-route.js";
export type { TerminalRouteProps } from "./terminal-route.js";
export { NEW_TERMINAL_ROUTE_SEGMENT } from "./terminal-route-params.js";
export { useSessionTerminal, explainTerminalError } from "./use-session-terminal.js";
export type {
  CreateTerminalResult,
  ListTerminalsResult,
  SessionTerminalClient,
  SessionTerminalController,
  SessionTerminalState,
  SessionTerminalStatus,
  TerminalErrorExplanation,
  TerminalSummary,
  UseSessionTerminalOptions,
} from "./use-session-terminal.js";
export { TerminalResizeOwnership } from "./terminal-resize-ownership.js";
export type { TerminalResizeIntent } from "./terminal-resize-ownership.js";
export { TerminalView } from "./terminal-view.js";
export type {
  TerminalTransportStatus,
  TerminalTransportStatusSource,
  TerminalViewProps,
} from "./terminal-view.js";
export {
  prefersReducedMotion,
  readTerminalFontFamily,
  readTerminalFontSizePx,
  readTerminalTheme,
} from "./terminal-theme.js";
