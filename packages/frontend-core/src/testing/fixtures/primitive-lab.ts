/**
 * Shared component-lab fixtures — plan.md §10.3, T25A/T26A.
 *
 * Framework-neutral case data for the web (`apps/web`) and Android
 * (`apps/android`) dev-only component labs. Both platforms render the
 * exact same cases from this module so the two primitive layers stay in
 * semantic lock-step even though each platform owns its own visual
 * implementation (plan.md §10.1, §10.3).
 *
 * This module holds plain data only: strings, numbers, and status tones.
 * No JSX, no React, no React Native, no DOM types — keeping it importable
 * from a plain Node test as well as both UI bundles.
 */

/** Shared status/tone vocabulary used across StatusIndicator, Chip, Banner, Toast. */
export type LabTone = "success" | "warning" | "danger" | "info" | "neutral";

export const labTones: readonly LabTone[] = ["success", "warning", "danger", "info", "neutral"];

export interface ButtonLabCase {
  id: string;
  label: string;
  kind: "primary" | "secondary" | "danger";
  disabled?: boolean;
}

export const buttonLabCases: readonly ButtonLabCase[] = [
  { id: "primary", label: "Connect", kind: "primary" },
  { id: "secondary", label: "Cancel", kind: "secondary" },
  { id: "danger", label: "Delete session", kind: "danger" },
  { id: "disabled", label: "Reconnecting…", kind: "primary", disabled: true },
];

export interface IconButtonLabCase {
  id: string;
  accessibleName: string;
  icon: "close" | "refresh" | "settings" | "copy";
}

export const iconButtonLabCases: readonly IconButtonLabCase[] = [
  { id: "close", accessibleName: "Close", icon: "close" },
  { id: "refresh", accessibleName: "Refresh session list", icon: "refresh" },
  { id: "settings", accessibleName: "Open host settings", icon: "settings" },
  { id: "copy", accessibleName: "Copy pairing code", icon: "copy" },
];

export interface LinkLabCase {
  id: string;
  label: string;
  href: string;
  external?: boolean;
}

export const linkLabCases: readonly LinkLabCase[] = [
  { id: "internal", label: "View session", href: "/host/session_1" },
  {
    id: "external",
    label: "Pi documentation",
    href: "https://example.invalid/docs",
    external: true,
  },
];

export interface TextFieldLabCase {
  id: string;
  label: string;
  placeholder?: string;
  value?: string;
  error?: string;
  required?: boolean;
}

export const textFieldLabCases: readonly TextFieldLabCase[] = [
  { id: "empty", label: "Host label", placeholder: "e.g. Laptop" },
  { id: "filled", label: "Host label", value: "Dev daemon" },
  {
    id: "error",
    label: "Pairing code",
    value: "wrong-code",
    error: "This pairing code is not valid.",
    required: true,
  },
];

export const textAreaLabCase: TextFieldLabCase = {
  id: "prompt",
  label: "Prompt",
  placeholder: "Ask Pi to do something…",
};

export interface SelectLabOption {
  value: string;
  label: string;
}

export interface SelectLabCase {
  id: string;
  label: string;
  options: readonly SelectLabOption[];
  value: string;
}

export const selectLabCases: readonly SelectLabCase[] = [
  {
    id: "model",
    label: "Model",
    value: "sonnet",
    options: [
      { value: "opus", label: "Opus" },
      { value: "sonnet", label: "Sonnet" },
      { value: "haiku", label: "Haiku" },
    ],
  },
];

export interface ToggleLabCase {
  id: string;
  label: string;
  checked: boolean;
  disabled?: boolean;
}

export const toggleLabCases: readonly ToggleLabCase[] = [
  { id: "notifications", label: "Push notifications", checked: true },
  { id: "thinking", label: "Show thinking", checked: false },
  { id: "locked", label: "Relay required (managed by host)", checked: true, disabled: true },
];

export interface ChipLabCase {
  id: string;
  label: string;
  tone: LabTone;
  removable?: boolean;
}

export const chipLabCases: readonly ChipLabCase[] = [
  { id: "read", label: "Read", tone: "info" },
  { id: "write", label: "Write", tone: "warning", removable: true },
  { id: "bash", label: "Bash", tone: "neutral" },
  { id: "denied", label: "Denied", tone: "danger" },
];

export interface StatusIndicatorLabCase {
  id: string;
  label: string;
  tone: LabTone;
  statusText: string;
}

export const statusIndicatorLabCases: readonly StatusIndicatorLabCase[] = [
  { id: "connected", label: "Connection", tone: "success", statusText: "Connected" },
  { id: "connecting", label: "Connection", tone: "info", statusText: "Connecting…" },
  { id: "degraded", label: "Connection", tone: "warning", statusText: "Reconnecting" },
  { id: "offline", label: "Connection", tone: "danger", statusText: "Offline" },
  { id: "idle", label: "Session", tone: "neutral", statusText: "Idle" },
];

export interface ProgressLabCase {
  id: string;
  label: string;
  value: number | null;
}

export const progressLabCases: readonly ProgressLabCase[] = [
  { id: "determinate", label: "Uploading attachment", value: 0.62 },
  { id: "indeterminate", label: "Compacting transcript", value: null },
  { id: "complete", label: "Applying patch", value: 1 },
];

export interface SearchFieldLabCase {
  id: string;
  label: string;
  placeholder: string;
  value?: string;
}

export const searchFieldLabCases: readonly SearchFieldLabCase[] = [
  { id: "commands", label: "Search commands", placeholder: "Search slash commands…" },
  { id: "sessions", label: "Search sessions", placeholder: "Filter sessions…", value: "auth" },
];

export interface RecordListColumn {
  key: string;
  header: string;
}

export interface RecordListRow {
  id: string;
  cells: Record<string, string>;
  tone?: LabTone;
}

export interface RecordListLabCase {
  id: string;
  columns: readonly RecordListColumn[];
  rows: readonly RecordListRow[];
}

export const recordListLabCase: RecordListLabCase = {
  id: "sessions",
  columns: [
    { key: "name", header: "Session" },
    { key: "status", header: "Status" },
    { key: "updated", header: "Updated" },
  ],
  rows: [
    {
      id: "s1",
      cells: { name: "Fix login bug", status: "Running", updated: "2m ago" },
      tone: "info",
    },
    {
      id: "s2",
      cells: { name: "Refactor auth", status: "Waiting", updated: "10m ago" },
      tone: "warning",
    },
    { id: "s3", cells: { name: "Docs pass", status: "Done", updated: "1h ago" }, tone: "success" },
  ],
};

export interface CodeBlockLabCase {
  id: string;
  language: string;
  code: string;
}

export const codeBlockLabCases: readonly CodeBlockLabCase[] = [
  {
    id: "diff",
    language: "diff",
    code: "--- a/src/app.ts\n+++ b/src/app.ts\n@@ -1,2 +1,2 @@\n-const x = 1;\n+const x = 2;",
  },
  {
    id: "ts",
    language: "ts",
    code: "export function greet(name: string): string {\n  return `Hello, ${name}`;\n}",
  },
];

export interface EmptyLikeStateLabCase {
  id: string;
  title: string;
  description: string;
}

export const emptyStateLabCase: EmptyLikeStateLabCase = {
  id: "no-sessions",
  title: "No sessions yet",
  description: "Start a new Pi session from this host to see it here.",
};

export const errorStateLabCase: EmptyLikeStateLabCase = {
  id: "connection-failed",
  title: "Couldn't reach the daemon",
  description: "Check that the host is online and try reconnecting.",
};

export const loadingStateLabCase: EmptyLikeStateLabCase = {
  id: "loading-sessions",
  title: "Loading sessions…",
  description: "This should only take a moment.",
};

export interface SheetLabCase {
  id: string;
  title: string;
  description: string;
}

export const sheetLabCase: SheetLabCase = {
  id: "session-actions",
  title: "Session actions",
  description: "Archive, rename, or delete this session.",
};

export interface DialogLabCase {
  id: string;
  title: string;
  description: string;
  confirmLabel: string;
  cancelLabel: string;
  dangerous?: boolean;
}

export const dialogLabCase: DialogLabCase = {
  id: "delete-session",
  title: "Delete this session?",
  description: "This removes the session from this host. This cannot be undone.",
  confirmLabel: "Delete",
  cancelLabel: "Cancel",
  dangerous: true,
};

export interface PopoverLabCase {
  id: string;
  triggerLabel: string;
  content: string;
}

export const popoverLabCase: PopoverLabCase = {
  id: "model-info",
  triggerLabel: "Model info",
  content: "Sonnet balances speed and capability for most Pi tasks.",
};

export interface ToastLabCase {
  id: string;
  tone: LabTone;
  message: string;
}

export const toastLabCases: readonly ToastLabCase[] = [
  { id: "saved", tone: "success", message: "Host settings saved." },
  {
    id: "offline",
    tone: "warning",
    message: "You're offline. Changes will sync when reconnected.",
  },
  { id: "failed", tone: "danger", message: "Failed to send message. Tap to retry." },
];

export interface BannerLabCase {
  id: string;
  tone: LabTone;
  message: string;
  actionLabel?: string;
}

export const bannerLabCases: readonly BannerLabCase[] = [
  {
    id: "relay",
    tone: "info",
    message: "This host is connected through a relay.",
    actionLabel: "Learn more",
  },
  {
    id: "degraded",
    tone: "warning",
    message: "Connection is unstable. Some updates may be delayed.",
  },
  {
    id: "denied",
    tone: "danger",
    message: "Permission denied for file write.",
    actionLabel: "Review",
  },
];

/**
 * A single record describing every §10.3 primitive and the fixture(s) it
 * renders in the lab, so both platforms can assert "every primitive
 * renders" from one manifest instead of hand-maintained parallel lists.
 */
export const primitiveLabManifest: readonly string[] = [
  "Button",
  "IconButton",
  "Link",
  "TextField",
  "TextArea",
  "Select",
  "Toggle",
  "Card",
  "Section",
  "Divider",
  "Chip",
  "ChipGroup",
  "StatusIndicator",
  "Progress",
  "SearchField",
  "RecordList",
  "CodeBlock",
  "EmptyState",
  "ErrorState",
  "LoadingState",
  "Sheet",
  "Dialog",
  "Popover",
  "Toast",
  "Banner",
];
