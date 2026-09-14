/**
 * A3's two informational-only extension regions (UI-A5): the "extensions
 * that draw" list and the "Loaded but silent" card. See
 * `SettingsScreen.tsx`'s module doc for why these two are drawn while the
 * mockup's per-agent Model/Thinking-effort and Auto-compaction/"Ask
 * before every tool" regions stay out.
 *
 * Both lists are static, hand-derived from plan.md §11.7 ("Customized
 * extension coverage") — the repository's own authoritative record of
 * which extension namespaces this app draws a dedicated Pi UI Bridge
 * element for, and which load only to change agent behavior. This is
 * deliberately NOT read from `apps/android/src/features/extensions/
 * registry.ts` (T34A1): that registry maps a wire `PiUiKind` (`status`,
 * `widget`, `roster`, ...) to a React renderer component, never an
 * extension's own namespace/name, so there is no runtime table an
 * extension's identity could be resolved back out of — a `roster`
 * element renders identically whether `subagents` or `switchboard` sent
 * it. Nothing else in this app keeps a namespace -> extension-name
 * table either. So this module is honest, static copy describing what
 * this app supports today, not a live capability query, and it must be
 * kept in sync with plan.md §11.7 by hand if that table ever changes —
 * the mockup's own sample text (`docs/ui-reference/pi-companion-app.html`'s
 * A3 frame) is NOT copied here, since its five-item "draws" list and
 * eight-item "silent" list actually disagree with plan.md §11.7 on where
 * `plan-mode` and `prompt-arbitrage` belong.
 */

export interface ExtensionCoverageRow {
  /** The extension's own namespace/name, plan.md §11.7's "Extension" column. */
  name: string;
  /** A short paraphrase of plan.md §11.7's "Required UI" column for this row. */
  description: string;
}

/**
 * plan.md §11.7's "First-class UI through bridge elements" table — every
 * extension this app draws a dedicated Pi UI Bridge element for, in that
 * table's own row order.
 */
export const DRAWING_EXTENSIONS: readonly ExtensionCoverageRow[] = [
  { name: "loop", description: "Status, markdown, roster, progress, and log panel" },
  { name: "btw", description: "Secondary conversation screen with markdown and composer" },
  { name: "subagents", description: "Roster of running, blocked, and done work" },
  { name: "todo", description: "Pinned task widget above the composer" },
  { name: "advisor", description: "Status, markdown, tool activity, and logs" },
  { name: "switchboard", description: "Key-health roster and cooldown state" },
  { name: "workflows", description: "Approval form, progress, roster, and logs" },
  { name: "minimal-status", description: "Native status information" },
  { name: "plan-mode", description: "Mode status with a toggle action" },
  { name: "pi-goal", description: "Goal status, rounds, budget, and blocked/waiting state" },
  { name: "prompt-arbitrage", description: "Status plus a composer replacement with undo" },
  { name: "ask-user", description: "Rich form with search, descriptions, and multi-select" },
];

/**
 * plan.md §11.7's "Headless or ordinary-chat behavior" list, plus its two
 * "Backend behavior that needs transcript protection" entries
 * (`project-memory`, `clarity`) — every extension this app loads that
 * changes what the agent can do, or how its transcript renders, without
 * drawing any UI of its own. Alphabetical, since plan.md's own two source
 * lists carry no shared ordering worth preserving.
 */
export const SILENT_EXTENSION_NAMESPACES: readonly string[] = [
  "capabilities",
  "clarity",
  "handoff",
  "herdr-agent-state",
  "mcp",
  "opencode-live-catalog",
  "pi-cursor-provider",
  "pi-herdr-delegate",
  "pi-herdr-peer",
  "plain-english",
  "project-memory",
  "vision-proxy",
  "web-access",
];

/** One sentence naming every silent extension, for the "Loaded but silent" card's body copy. */
export function silentExtensionsSummary(): string {
  return `${SILENT_EXTENSION_NAMESPACES.join(", ")} change what the agent can do rather than what you see. Their evidence is the reply you read or the tool activity in the transcript.`;
}
