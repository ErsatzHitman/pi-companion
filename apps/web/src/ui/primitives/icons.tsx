import type { ReactElement, SVGProps } from "react";

/**
 * Minimal inline glyph set for `IconButton` (plan.md §10.3). Kept as
 * hand-drawn `<path>` data (not copied from any icon library) so the
 * primitive layer has no extra runtime dependency; product code should
 * still prefer `IconButton`'s `accessibleName` over the glyph to convey
 * meaning (icons alone are decorative, `aria-hidden`).
 */
export type IconName = "close" | "refresh" | "settings" | "copy";

const paths: Record<IconName, ReactElement> = {
  close: <path d="M3 3l10 10M13 3L3 13" />,
  refresh: <path d="M13 8A5 5 0 1 1 11.5 4.5M13 3v3h-3" />,
  settings: (
    <path d="M8 5a3 3 0 1 0 0 6 3 3 0 0 0 0-6ZM8 1v2M8 13v2M1 8h2M13 8h2M3 3l1.4 1.4M11.6 11.6 13 13M13 3l-1.4 1.4M4.4 11.6 3 13" />
  ),
  copy: <path d="M5 5h7v8H5V5ZM3 3h7v2H4v7H3V3Z" />,
};

export function Icon({ name, ...rest }: { name: IconName } & SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 16 16"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      {paths[name]}
    </svg>
  );
}
