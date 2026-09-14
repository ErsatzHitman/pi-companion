import type { ReactElement, SVGProps } from "react";

/**
 * Minimal inline glyph set for `IconButton` (plan.md §10.3). Kept as
 * hand-drawn `<path>` data (not copied from any icon library) so the
 * primitive layer has no extra runtime dependency; product code should
 * still prefer `IconButton`'s `accessibleName` over the glyph to convey
 * meaning (icons alone are decorative, `aria-hidden`).
 */
export type IconName =
  | "close"
  | "refresh"
  | "settings"
  | "copy"
  | "panel-left"
  | "panel-right"
  | "folder"
  | "terminal"
  | "add";

const paths: Record<IconName, ReactElement> = {
  close: <path d="M3 3l10 10M13 3L3 13" />,
  refresh: <path d="M13 8A5 5 0 1 1 11.5 4.5M13 3v3h-3" />,
  settings: (
    <path d="M8 5a3 3 0 1 0 0 6 3 3 0 0 0 0-6ZM8 1v2M8 13v2M1 8h2M13 8h2M3 3l1.4 1.4M11.6 11.6 13 13M13 3l-1.4 1.4M4.4 11.6 3 13" />
  ),
  copy: <path d="M5 5h7v8H5V5ZM3 3h7v2H4v7H3V3Z" />,
  // Sidebar-collapse toggles (T27S1's `Shell`): an outer app frame with a
  // single divider standing in for the rail being toggled, near the left
  // or right edge respectively.
  "panel-left": (
    <g>
      <rect x="1.5" y="3" width="13" height="10" rx="1.5" />
      <path d="M6 3v10" />
    </g>
  ),
  "panel-right": (
    <g>
      <rect x="1.5" y="3" width="13" height="10" rx="1.5" />
      <path d="M10 3v10" />
    </g>
  ),
  folder: <path d="M2 4.5h4l1.3 1.5H14v7.5H2v-9Z" />,
  terminal: <path d="M3 4.5l3.5 3.5L3 11.5M8 11.5h5" />,
  // Terminal switcher's "New terminal" chip (UI-W8): a plain plus glyph,
  // paired with the visible "New terminal" label the chip renders next
  // to it -- the icon alone stays decorative/`aria-hidden`.
  add: <path d="M8 2.5v11M2.5 8h11" />,
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
