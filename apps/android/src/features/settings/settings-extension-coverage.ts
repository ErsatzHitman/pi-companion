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

/** One `<dl class="kv">`-shaped fact about an extension's own wire contract — a term and its value, e.g. `{ term: "channel", value: "todo" }`. */
export interface ExtensionCoverageContractTerm {
  term: string;
  value: string;
}

export interface ExtensionCoverageRow {
  /** The extension's own namespace/name, plan.md §11.7's "Extension" column. */
  name: string;
  /** A short paraphrase of plan.md §11.7's "Required UI" column for this row. */
  description: string;
  /**
   * One paragraph naming the surface this extension actually draws on —
   * a transcript block, a pinned widget, a secondary screen, a popup —
   * and why it takes that shape rather than an ordinary reply. Feeds
   * `ExtensionDetailScreen.tsx`'s "Where it draws" card. Hand-written
   * from plan.md §11.7's "Required UI" column and §12.3's action/single-
   * answer rules, not copied from any mockup's own sample copy — this
   * module's twelve rows are plan.md §11.7's, not a five-item sample's,
   * per this file's own module doc above.
   */
  whereItDraws: string;
  /**
   * The extension's own wire-level facts as term/value pairs — its
   * published channel name, the shape of what it blocks or emits.
   * Feeds `ExtensionDetailScreen.tsx`'s "Contract" card. Grounded in
   * plan.md §11.7's "Published channels" sentence (`subagents:fleet`,
   * `workflow:progress`, `pi-goal:status`) and §12.3's action-identity
   * and single-answer-semantics rules where a row's behavior depends on
   * them; every other row states only what plan.md §11.7's own
   * "Required UI" column already establishes, in fewer words.
   */
  contract: readonly ExtensionCoverageContractTerm[];
}

/**
 * plan.md §11.7's "First-class UI through bridge elements" table — every
 * extension this app draws a dedicated Pi UI Bridge element for, in that
 * table's own row order.
 */
export const DRAWING_EXTENSIONS: readonly ExtensionCoverageRow[] = [
  {
    name: "loop",
    description: "Status, markdown, roster, progress, and log panel",
    whereItDraws:
      "A panel in the transcript combining status, markdown notes, a roster, a progress indicator, and a log — one composite surface rather than a single block, because a loop run has all five kinds of thing to report at once.",
    contract: [
      { term: "channel", value: "loop" },
      { term: "elements", value: "status, markdown, roster, progress, log" },
      { term: "actions", value: "stop, view details" },
    ],
  },
  {
    name: "btw",
    description: "Secondary conversation screen with markdown and composer",
    whereItDraws:
      "A secondary conversation screen that opens alongside the main transcript, with its own markdown output and its own composer, so a side conversation never interleaves with the primary one.",
    contract: [
      { term: "channel", value: "btw" },
      { term: "surface", value: "secondary screen, not a transcript block" },
      { term: "composer", value: "independent from the parent session's" },
    ],
  },
  {
    name: "subagents",
    description: "Roster of running, blocked, and done work",
    whereItDraws:
      "A prominent roster surfacing every subagent's state — running, blocked, or done — with usage figures and cancel/open actions per row, so the fleet is legible at a glance rather than scattered through the transcript.",
    contract: [
      { term: "channel", value: "subagents:fleet" },
      { term: "states", value: "running, blocked, done" },
      { term: "actions", value: "cancel, open" },
    ],
  },
  {
    name: "todo",
    description: "Pinned task widget above the composer",
    whereItDraws:
      "A widget pinned above the prompt bar rather than a transcript block, so the current task list stays readable at any scroll position while the transcript itself scrolls freely.",
    contract: [
      { term: "channel", value: "todo" },
      { term: "payload", value: "task list with a wait/now/done state per item" },
      { term: "collapse", value: "collapses to a summary count when not in focus" },
    ],
  },
  {
    name: "advisor",
    description: "Status, markdown, tool activity, and logs",
    whereItDraws:
      "A widget/panel combining status, markdown commentary, tool activity, and logs — a policy voice kept visually distinct from the model's own reply.",
    contract: [
      { term: "channel", value: "advisor" },
      { term: "elements", value: "status, markdown, tool activity, logs" },
    ],
  },
  {
    name: "switchboard",
    description: "Key-health roster and cooldown state",
    whereItDraws:
      "A roster of configured keys with health and cooldown state per row, plus a management form for adding or retiring one, kept apart from the ordinary transcript.",
    contract: [
      { term: "channel", value: "switchboard" },
      { term: "elements", value: "key roster, cooldown state, management form" },
    ],
  },
  {
    name: "workflows",
    description: "Approval form, progress, roster, and logs",
    whereItDraws:
      "An approval form together with progress, a roster of phase participants, and logs — the multi-agent workflow's own status surface, distinct from any one participant's transcript.",
    contract: [
      { term: "channel", value: "workflow:progress" },
      { term: "elements", value: "approval form, progress, roster, logs" },
    ],
  },
  {
    name: "minimal-status",
    description: "Native status information",
    whereItDraws:
      "Native status information rendered with this app's own components, not a copied terminal footer — plan.md §11.7 calls this out by name as the shape to avoid.",
    contract: [
      { term: "channel", value: "minimal-status" },
      { term: "surface", value: "native status region, not a terminal-footer copy" },
    ],
  },
  {
    name: "plan-mode",
    description: "Mode status with a toggle action",
    whereItDraws:
      "A mode-status indicator with a toggle action, showing whether the session is in plan mode or build mode and letting you switch it without typing a command.",
    contract: [
      { term: "channel", value: "plan-mode" },
      { term: "action", value: "toggle plan/build mode" },
    ],
  },
  {
    name: "pi-goal",
    description: "Goal status, rounds, budget, and blocked/waiting state",
    whereItDraws:
      "A status surface tracking the goal's rounds, budget, and blocked/waiting state as the agent works toward it, published on its own channel rather than folded into the ordinary transcript.",
    contract: [
      { term: "channel", value: "pi-goal:status" },
      { term: "elements", value: "rounds, budget, blocked/waiting state" },
    ],
  },
  {
    name: "prompt-arbitrage",
    description: "Status plus a composer replacement with undo",
    whereItDraws:
      "A status indicator paired with a composer replacement that carries its own undo, standing in for the ordinary prompt bar while it is active.",
    contract: [
      { term: "channel", value: "prompt-arbitrage" },
      { term: "elements", value: "status, composer replacement, undo" },
    ],
  },
  {
    name: "ask-user",
    description: "Rich form with search, descriptions, and multi-select",
    whereItDraws:
      "A form docked to the prompt bar that blocks the turn — per plan.md §12.3, an approval or dialog like this one is answerable exactly once across every connected client, and a second answer resolves as superseded rather than silently vanishing — offering search, descriptions, multi-select, and an optional free-text comment as the escape.",
    contract: [
      { term: "channel", value: "ask-user" },
      { term: "blocks turn", value: "yes, until answered" },
      { term: "second answer", value: "resolves as superseded, never silent" },
      { term: "escape", value: "optional free-text comment" },
    ],
  },
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
