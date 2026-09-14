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
  | "edit"
  | "rewind"
  | "add"
  | "stop"
  // UI-W7 (files toolbar/row actions): appended, existing entries above
  // are untouched.
  | "search"
  | "upload"
  | "download"
  | "folder-plus"
  | "file-plus"
  | "file"
  | "trash"
  // UI-W13 (session row-actions trigger): appended, existing entries
  // above are untouched.
  | "more";

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
  // Pencil (UI-W2's "Edit from here" — `message-row.tsx`): a single
  // closed outline from the barrel down to a tapered tip, the same
  // one-path, straight-line construction as every glyph above (no arcs,
  // no fill).
  edit: <path d="M13 4 6.3 10.3 1.3 13.7 4.7 8.7 11 2Z" />,
  // Anticlockwise history arrow (UI-W2's "Rewind to here" —
  // `message-row.tsx`): an exact horizontal mirror of `refresh`'s own
  // circle-plus-hook construction, so the gap and arrowhead sit at the
  // top-left instead of the top-right and the arc sweeps the opposite
  // (anticlockwise) way — reads as "undo/rewind" rather than "reload",
  // never identical to `refresh` at a glance.
  rewind: <path d="M3 8A5 5 0 1 0 4.5 4.5M3 3v3h3" />,
  // Terminal switcher's "New terminal" chip (UI-W8): a plain plus glyph,
  // paired with the visible "New terminal" label the chip renders next
  // to it -- the icon alone stays decorative/`aria-hidden`.
  add: <path d="M8 2.5v11M2.5 8h11" />,
  // Stop control (UI-W4's composer metadata row): a plain square glyph,
  // the universal "halt" shape — distinct from Send's arrow so the two
  // never read as the same action.
  stop: <rect x="4" y="4" width="8" height="8" rx="1" />,
  // Magnifying glass (files toolbar's search toggle): circle plus a
  // short diagonal handle, the same single-path-family construction as
  // every glyph above.
  search: (
    <g>
      <circle cx="6.8" cy="6.8" r="4.3" />
      <path d="M10.1 10.1 14 14" />
    </g>
  ),
  // Arrow rising out of a tray (files toolbar's Upload trigger): mirrors
  // `download` below vertically so the two never read as the same glyph.
  upload: <path d="M8 11V3M4.5 6.5 8 3l3.5 3.5M2.5 13h11" />,
  // Arrow settling into a tray (per-row Download action): the vertical
  // mirror of `upload` above.
  download: <path d="M8 3v8M4.5 8.5 8 12l3.5-3.5M2.5 13h11" />,
  // Folder outline (`folder` above) plus a small plus mark (files
  // toolbar's New folder trigger).
  "folder-plus": (
    <g>
      <path d="M2 5.5h3.6l1.1 1.3H14v6.7H2v-8Z" />
      <path d="M8.5 8.2v3M7 9.7h3" />
    </g>
  ),
  // Plain file outline (dog-eared rectangle) plus a small plus mark
  // (files toolbar's New file trigger).
  "file-plus": (
    <g>
      <path d="M4 1.5h5l3 3v10H4v-13Z" />
      <path d="M9 1.5v3h3" />
      <path d="M6.8 9v3M5.3 10.5h3" />
    </g>
  ),
  // Plain file outline with no plus mark (listing rows' file kind glyph,
  // paired with `folder` above for directory rows).
  file: (
    <g>
      <path d="M4 1.5h5l3 3v10H4v-13Z" />
      <path d="M9 1.5v3h3" />
    </g>
  ),
  // Waste bin (per-row Delete action): a lid line plus a tapered body,
  // the same straight-line construction as every glyph above.
  trash: <path d="M3 4.5h10M6 4.5V3h4v1.5M4.5 4.5 5 13.5h6l.5-9" />,
  // Three-dot "more" trigger (row-actions popovers, e.g. `SessionRow`):
  // three zero-length horizontal segments, which the shared round
  // line-cap renders as dots — the same path-only, stroke-based
  // construction as every glyph above, no fill introduced.
  more: <path d="M3.5 8h0M8 8h0M12.5 8h0" />,
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
