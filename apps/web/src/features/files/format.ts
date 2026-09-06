/**
 * Pure display formatting for file browser rows (T30B1). Kept separate
 * from rendering so it is trivial to unit test without a DOM.
 */

const SIZE_UNITS = ["KB", "MB", "GB", "TB"] as const;

/** Formats a byte count as e.g. `"340 B"`, `"12.4 KB"`, `"3 MB"`. */
export function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "—";
  if (bytes < 1024) return `${bytes} B`;

  let value = bytes / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < SIZE_UNITS.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  const decimals = value < 10 ? 1 : 0;
  return `${value.toFixed(decimals)} ${SIZE_UNITS[unitIndex]}`;
}

/**
 * Formats an ISO `modifiedAt` timestamp for display. Uses a fixed `"UTC"`
 * time zone so output (and tests of it) do not depend on the host
 * machine's local time zone; falls back to the raw string for an
 * unparseable value rather than throwing.
 */
export function formatModifiedAt(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(date);
}
