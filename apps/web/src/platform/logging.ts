import type { LogFields, Logger } from "@picompanion/frontend-core";

/** `Logger` backed by `console`, with fields merged into each call (plan.md §7.3). */
export function createConsoleLogger(baseFields: LogFields = {}): Logger {
  const emit = (
    level: "debug" | "info" | "warn" | "error",
    message: string,
    fields?: LogFields,
  ) => {
    const merged = { ...baseFields, ...fields };
    const hasFields = Object.keys(merged).length > 0;
    // eslint-disable-next-line no-console
    console[level](message, ...(hasFields ? [merged] : []));
  };

  return {
    debug: (message, fields) => emit("debug", message, fields),
    info: (message, fields) => emit("info", message, fields),
    warn: (message, fields) => emit("warn", message, fields),
    error: (message, fields) => emit("error", message, fields),
    child: (fields) => createConsoleLogger({ ...baseFields, ...fields }),
  };
}
