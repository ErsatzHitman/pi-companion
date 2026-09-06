/**
 * Logging interface (plan.md §7.3).
 *
 * Core code logs through this interface, never through `console`
 * directly, so web and Android can route logs to their own sinks
 * (devtools console, Expo/native log pipes) and so telemetry that must
 * exclude prompt/source content stays enforceable at the adapter edge.
 */
export type LogFields = Record<string, string | number | boolean | null | undefined>;

export interface Logger {
  debug(message: string, fields?: LogFields): void;
  info(message: string, fields?: LogFields): void;
  warn(message: string, fields?: LogFields): void;
  error(message: string, fields?: LogFields): void;
  /** Returns a logger that merges `fields` into every subsequent call. */
  child(fields: LogFields): Logger;
}
