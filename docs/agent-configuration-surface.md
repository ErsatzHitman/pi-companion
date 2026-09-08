# Agent configuration surface — decision (T50)

`depends-on: T10` · Owns: this file only. No application code, no edits to
`docs/issues-from-plan.md` or `docs/pi-extension-compatibility.md`.

## The question

Whether, and how, the frontend shows what the agent currently has loaded: models,
skills, MCP servers, extensions, and subagent definitions. Three options were on the
table: **nothing**, a **read-only "what is loaded" diagnostics view**, or **editors**.

## Method

Every claim below was checked against one of three sources, named inline:

- `packages/server/src/server/agent/providers/pi/rpc-types.ts` — our hand-written
  mirror of Pi's RPC surface.
- The installed Pi CLI's own type declarations,
  `C:\Users\aksha\AppData\Local\pi-node\current\node_modules\@earendil-works\pi-coding-agent\dist\modes\rpc\rpc-types.d.ts`
  (`@earendil-works/pi-coding-agent@0.84.1`, read directly for this task — the same
  authority `docs/pi-extension-compatibility.md` §9.1 cites, not re-derived from that
  document's prose).
- `docs/pi-extension-compatibility.md` §9.1/§9.2, the T51A verdict table over all 32
  Pi RPC request types.

Nothing below reports what a live daemon actually returns at runtime — this
repository's agents never open a socket to port `6767` or `6768` (production or dev
daemon). Every claim is a static read of type declarations and call sites; §5 below
records exactly where that limit bites.

## 1. What the daemon can already report, arm by arm

### Models — reportable today, already surfaced as an editor

Pi's `get_available_models` request (installed Pi's `rpc-types.d.ts`) returns
`{ models: Model<any>[] }` — the full catalog, not just the active one. Our mirror
carries this arm (`rpc-types.ts`; §9.2 marks it "Mirrored — Pre-existing") and it is
wired end-to-end: T28B5 ("Add model and thinking-level selection", in
`docs/issues-from-plan.md`) built a real selection control in
`apps/web/src/features/composer/`, proven by `use-model-thinking.test.ts`. `get_state`
also returns the session's _current_ model (`RpcSessionState.model`, mirrored in
`PiSessionState`). So both "what models exist" and "which one is active" already
round-trip to the client — this is the one item on the list that is a full editor
already, not a gap.

### Skills — partially reportable, and only indirectly

Pi's RPC surface has no `list_skills`/`get_skills` request anywhere in
`rpc-types.d.ts` (confirmed by grepping the entire file for `skill`: the only
hit is the `source: "extension" | "prompt" | "skill"` field on `RpcSlashCommand`).
The one signal that exists is `get_commands`, which Pi already mirrors as
`get_commands`/`PiRpcSlashCommand` (§9.2: "Mirrored (added by this task)", T51A) and
which our daemon already forwards to the client as `list_commands_request` /
`list_commands_response` (`AgentSlashCommandSchema` in
`packages/protocol/src/messages.ts`). `packages/server/src/server/agent/providers/pi/agent.ts`'s
`mapPiCommandKind` function maps Pi's `source: "skill"` to our wire's
`kind: "skill"` — so **a skill that exposes a slash command is visible today**, tagged,
with name/description/argument hint, through the exact same channel that already
powers the composer's `/`-completion (`apps/web/src/features/composer/
use-slash-commands.ts`, T28B4).

That is a real but narrow signal, not a skill catalog:

- `mapPiCommandKind` collapses Pi's three-way `source` into two wire values —
  `"extension"` and `"prompt"` both become our `kind: "command"` (its fallback
  branch: `return "command";`), proven directly by `agent.test.ts`'s `"maps extension, prompt, and
skill commands to Paseo slash commands"` test: a `source: "extension"` command and
  a `source: "prompt"` command both come back `kind: "command"` in the same
  assertion that shows `source: "skill"` alone becoming `kind: "skill"`. A slash
  command sourced from an extension is **indistinguishable from a built-in command**
  on the wire today.
- A skill with no slash command is invisible. Pi's skill mechanism (system-prompt
  injection, tool grants, etc.) is not enumerated anywhere in `rpc-types.d.ts`; only
  the commands a skill happens to register are visible, and only by name.
- The state is ephemeral per-composer-mount (`use-slash-commands.ts`'s `commands`
  starts empty and is fetched on mount) — nothing persists or exposes it outside the
  composer today. A diagnostics view would issue its own `listCommands` call through
  the same `AgentTurnClient`/`DaemonClient` path, not read a store that already holds
  it.

### MCP servers — not reportable via Pi's own RPC surface, but the daemon already holds the data

`rpc-types.d.ts` contains **zero** mentions of `mcp` in any form, request or
response. Pi's RPC protocol gives no way to ask a running Pi process what MCP
servers it has.

But the daemon does not need to ask Pi, because **the daemon itself constructs the
MCP config Pi launches with**. `packages/server/src/server/agent/providers/pi/agent.ts`:

- `readPiGlobalMcpConfig` reads Pi's own global
  `~/.pi/agent/mcp.json` (via `resolvePiAgentDir`) directly off disk before every
  launch.
- `createPiMcpConfigFile` merges that global file's `mcpServers` (or
  legacy `mcp-servers`) with the per-session `AgentSessionConfig.mcpServers`
  (`McpServerConfig`, declared in `agent-sdk-types.ts` — stdio/http/sse variants, each
  optionally carrying `env`/`headers`), including the internally-injected `paseo`
  server (`runtime-mcp-config.ts`'s `withRuntimePaseoMcpServer`), and writes the
  merged result to a temp file Pi actually reads.

So the full, merged, real server list — names, transport type, command/URL — is
computed by the daemon on every session launch and currently thrown away once the
temp file is written. Nothing reads it back out for a client. This is real daemon
work, but it is **file-read plus reporting**, not a new Pi RPC — Pi was never going
to expose this itself. `McpServerConfig.env`/`.headers` can carry secrets, so any
report of this data must redact those fields, the same rule T41B2's diagnostics
export already exists to enforce for a different data source.

`listFeatures()` (`agent.ts`'s `PiRpcAgentClient.listFeatures` method) is a plausible-looking existing seam for
this — it returns `Promise<AgentFeature[]>` per `AgentSessionConfig` — but it is a
stub that unconditionally returns `[]`; it reports nothing today and would need to
be filled in, not merely called.

### Extensions — least visible of the five; no daemon-side read of any kind exists

`rpc-types.d.ts`'s only extension-shaped members are `RpcExtensionUIRequest`/
`RpcExtensionUIResponse` — a live, bidirectional protocol for an
_already-running_ extension to ask the connected client for input (`select`,
`confirm`, `input`, etc.) and receive an answer. Both are mirrored functionally in
`PiRuntimeEvent`'s `extension_ui_request`/`respondToExtensionUiRequest` (§9.2's
extension-UI table: "Functionally wired end-to-end in production"). Neither is a
catalog: there is no request that asks "what extensions are loaded," only a channel
an extension uses once it is already active.

Unlike MCP, the daemon does not even read a config file for this: grepping
`agent.ts` for `extensionPaths`/`extensionsDir`/`extensions.json` finds exactly one
use, `extensionPaths: input.paseoExtension ? [input.paseoExtension.path] : undefined`
(`buildResumeStartInput`, and the equivalent literal in `PiRpcAgentClient.createSession`)
— the single internal bridge extension this project injects, never
a read of whatever extensions directory a real Pi installation might have. The only
passive signal is reactive and negative: `extension_error` events name a failing
extension's path only when it throws (`handleSessionEvent`'s `"extension_error"` case,
which reads the notice's `source` from `event.extensionPath`) — nothing is reported
about the extensions that are loaded and working.

So extensions sit strictly behind MCP servers on the "can be reported" ladder: MCP
needs new daemon _reporting_ code over data the daemon already computes; extensions
would need new daemon _reading_ code first (locate and parse whatever Pi's real
extension registry is, which no file in this repository currently touches), before
there is anything to report.

### Subagent definitions — not reportable, and not the same thing as what already ships

`rpc-types.d.ts` has zero mentions of `subagent` in any form. This project already
has substantial subagent-shaped code, but it answers a different question and
should not be mistaken for this one:

- `packages/server/src/server/agent/provider-subagents/store.ts`'s
  `ProviderSubagentDescriptor` and the `subagents:fleet` published channel
  (`plan.md` §11.7's published-channels sentence, "Published channels remain `subagents:fleet`,
  ...") track **running or completed subagent instances** a
  session has spawned — status, title, parent turn — as live telemetry. This is a
  roster of _invocations_, already fully live per `plan.md`'s architecture (§11.7's
  "First-class UI through bridge elements" table, `subagents` row:
  "prominent roster with running, blocked, done, usage, and cancel/open actions").
  (CORRECTED at the P9-L merge gate. Both citations here said §11.4 and described it as
  a "renderer registry table". §11.4 _is_ titled "Renderer registry", but it is a bullet
  list with no table and contains neither quoted string; T272 dropped these two sites'
  rotted line numbers without checking the section label they were attached to, and
  authored the table descriptor in the same edit.)
- What T50 is asked about is a **catalog of configured subagent types/roles** the
  agent could invoke before any of them runs (the way some agent tools let a user
  browse named subagent personas). No such catalog concept appears anywhere in Pi's
  RPC surface, in `plan.md`, or in this repository's code. It is not a gap in an
  existing mirror; there is nothing here to mirror. `plan.md`'s every other use of
  "subagent" (§2.1's primary goal statement, §2.2's first-release capability list,
  §8.3's wide-layout description, §9.2's compact-layout description, §11.6's tool
  renderer registry, and the Phase 4 exit criteria) is the same runtime-fleet sense as
  `provider-subagents/store.ts`, not a definitions catalog.

### Summary table

| Surface              | Daemon can report today?                                                                                               | Evidence checked                                                                                                 | New work needed                                                                                      |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Models               | Yes, fully (catalog + active)                                                                                          | `rpc-types.d.ts`; `rpc-types.ts` (`get_available_models`); T28B5                                                 | None — already an editor                                                                             |
| Skills               | Partially (only skills with a slash command, name/description only, indistinguishable from extension-sourced commands) | `rpc-types.d.ts`'s `RpcSlashCommand`; `messages.ts`'s `AgentSlashCommandSchema`; `agent.ts`'s `mapPiCommandKind` | A diagnostics fetch reusing `AgentTurnClient.listCommands` (no daemon change)                        |
| MCP servers          | No via Pi RPC; yes via a daemon-side file the daemon already parses                                                    | `rpc-types.d.ts` (zero `mcp` hits); `agent.ts`'s `readPiGlobalMcpConfig`/`createPiMcpConfigFile`                 | New daemon report path with redaction of `env`/`headers`; `listFeatures()` is a stub, not a shortcut |
| Extensions           | No                                                                                                                     | `rpc-types.d.ts` (only live UI protocol); `agent.ts` (`extensionPaths` never reads a real registry)              | New daemon-side extension-registry read, then a report path — two steps, not one                     |
| Subagent definitions | No — and no such concept exists in Pi's surface, `plan.md`, or this repo                                               | `rpc-types.d.ts` (zero `subagent` hits); `provider-subagents/store.ts` is a different (runtime-fleet) concept    | Not scoped anywhere; would need product definition before daemon work                                |

## 2. What the frontend already surfaces

`apps/web/src/features/diagnostics/` (T41B1, built) shows three sections built by
`diagnostics-model.ts`'s `buildDiagnosticsSnapshot`: **Connection** (status, path,
profile, endpoint, client id), **Versions** (app protocol version, daemon version,
server id, hostname, desktop-managed), and **Capabilities** (every truthy/falsy
`server_info.features` flag, plus voice dictation/capture). None of the five surfaces
this task is about are in it — it has no models/skills/MCP/extensions/subagents
section today.

T41B2 ("Add the redacted diagnostics export," same wave as this task, P6-W14 per the
issues table) is adding a redacted export to this same directory concurrently. This
document does not touch `apps/web/src/features/diagnostics/` and does not depend on
what T41B2 ships; it only notes that any follow-up work below would extend the same
screen T41B1 built and T41B2 is exporting from, and inherits its established
redaction discipline (T41B2's own criteria: "no passwords, keys, prompts or file
content," "a redaction test asserts each forbidden category").

Model selection (§1) already exists as a real editor in
`apps/web/src/features/composer/`, outside `features/diagnostics/` entirely — it is
a composer control, not a diagnostics section, and this document does not propose
moving it.

## 3. Decision: a read-only "what is loaded" diagnostics view — for the two surfaces that are actually reportable

Not "nothing," and not "editors."

**Not nothing**, because two of the five surfaces (models, partially skills) already
have real data reaching the client, and a third (MCP servers) has the daemon already
holding the data one file-read away from reportable — leaving that on the floor when
`docs/issues-from-plan.md`'s own framing of the underlying need ("why isn't my skill
firing") is exactly a diagnostic question would be declining a cheap, real answer to
a real support cost.

**Not editors.** `docs/issues-from-plan.md`'s own leaning is directly on point: "the
real need behind a settings surface is usually diagnostic... but none of Pi's 32 RPC
commands expose skills, MCP servers or plugins" — and this task's own audit confirms
that for all four of skills/MCP/extensions/subagents, no RPC exists to _write_ any of
these into Pi even if we wanted an editor; Pi's configuration for skills and
extensions lives in files/directories on the host running Pi, not behind any request
in `rpc-types.d.ts`. An editor would mean the daemon writing directly into Pi's
config files out from under a process it does not own the lifecycle of (no `reload`
RPC exists either), which is a materially riskier and larger daemon feature than
this task's brief ("a decision, not a build") is scoped to justify. Models are the
one exception — they already have a real, Pi-RPC-backed editor (`set_model`) because
Pi itself exposes a request for it. That is a reason to leave the existing model
editor alone, not a reason to build editors for the other four.

**The reason, stated plainly:** build a read-only diagnostics section for exactly the
surfaces where the daemon can produce a truthful, non-fabricated value without new
Pi capability — models (already done, no new work) and MCP servers (new but narrow
daemon work: read the same merged config it already computes, redact secrets,
report it). Do not add rows for skills beyond what the composer's existing signal
already gives for free, and do not add rows for extensions or subagent definitions
at all, because there is nothing true to show yet — a diagnostics screen that shows
an empty or fake extensions/subagents section is worse than one that omits the
section, per this repository's own "a silent no-op is worse than a visible failure"
rule (`CLAUDE.md`). A reader who disagrees with drawing the line at "can produce a
value without new Pi capability" — for example, preferring to also read Pi's
extension directory directly regardless of Pi RPC support — should say so against
§1's per-surface table above, which is where that disagreement has to be argued, not
against this section's conclusion in the abstract.

## 4. Follow-up tasks, if this decision is accepted

Listed at the granularity of `docs/issues-from-plan.md`, ready to paste in. Not
pasted in by this task, per the brief ("Do NOT edit `docs/issues-from-plan.md`").

---

#### T50A1 — Report the merged MCP server list on the diagnostics screen

`labels: phase-7, area: daemon` · `depends-on: T50`

Give the diagnostics screen a truthful, redacted view of the MCP servers a Pi
session actually launches with — the same merged config
`createPiMcpConfigFile` already computes, reported instead of only written to a
launch-time temp file.

Owns: a new daemon-side report path in `packages/server/src/server/agent/providers/pi/agent.ts`
(or a sibling module) plus the wire message it needs in `packages/protocol/src/messages.ts`.
No other task in this wave touches those files.

- [ ] The reported list matches what `createPiMcpConfigFile` actually merges for
      that session (global `~/.pi/agent/mcp.json` plus per-session config), not a
      recomputation that can drift from it
- [ ] Server name, transport type, and command/URL are shown; `env` and `headers`
      values are never included, only which keys are set
- [ ] The screen states plainly when no MCP servers are configured, rather than
      showing an empty table with no explanation
- [ ] A fixture test proves a server with `env`/`headers` values round-trips with
      those values redacted, not merely absent from a fixture that never had them
      (this repository's own "a redaction test whose input contains no secret
      proves nothing" rule)

#### T50A2 — Add an MCP servers section to the web diagnostics screen

`labels: phase-7, area: web` · `depends-on: T50A1`

Render T50A1's data as a new section of the existing diagnostics screen.

Owns: `apps/web/src/features/diagnostics/`. No other task in this wave touches
those files.

- [ ] A new section lists the reported servers alongside the existing Connection/
      Versions/Capabilities sections, following T41B1's existing pattern (every
      field says so in words when a real source has nothing to report yet, never a
      fabricated default)
- [ ] The screen still works while disconnected (no servers, explained, not blank)
- [ ] Values are copyable, matching T41B1's existing criterion
- [ ] Composes with T41B2's redacted export: the same redaction applied for
      T50A1 also applies wherever this section's values reach the export

#### T50A3 — Surface skill-sourced slash commands as their own diagnostics section

`labels: phase-7, area: web` · `depends-on: T50`

Give the diagnostics screen its own `listCommands` fetch (the same
`AgentTurnClient`/`DaemonClient` call the composer already uses) and list the
commands tagged `kind: "skill"` separately from the rest, disclosing that this is
"skills with slash commands," not the full skill catalog.

Owns: `apps/web/src/features/diagnostics/`. No other task in this wave touches
those files.

- [ ] The section lists each `kind: "skill"` command's name, description, and
      argument hint from a real `listCommands` response, not the composer's shared
      state
- [ ] The section's own label or a visible note states the scope limit (commands
      only, not a full skill catalog) so it cannot be mistaken for one
- [ ] The screen still works while disconnected or when `listCommands` is
      unsupported by the connected client, per T41B1's existing "works while
      disconnected" criterion

---

No follow-up task is filed for extensions or subagent definitions: §1 found no
existing daemon-side read of any kind for either, so the first step for either would
be scoping what Pi actually exposes on disk (an extensions/skills directory layout,
if one exists in a shape this daemon could safely read) before any task-sized unit
of work can be written with real acceptance criteria — that scoping is itself a
task, not something this document can respond for.

## 5. What this task could not determine

- **Whether Pi's global `mcp.json` schema is stable across installed versions, or
  whether other global config files exist for skills/extensions in the same
  `~/.pi/agent/` directory `resolvePiAgentDir` resolves.** This repository's agents
  must not open a socket to a daemon, and checking `~/.pi/agent/` on this machine
  for files beyond `mcp.json` would only describe one installed Pi version's layout,
  not something safe to assert as this product's contract. Settling this needs
  either Pi's own documentation of that directory's contents (beyond the RPC surface
  audited here) or a task explicitly scoped to read it, with the same
  install-version citation discipline `docs/pi-extension-compatibility.md` §9 used.
- **Whether a live Pi installation's real extensions and skills ever populate
  `get_commands` the way the fixtures above assume**, versus only Pi's test double
  (`fake-pi.ts`) being configured to. `agent.test.ts`'s
  `"maps extension, prompt, and skill commands to Paseo slash commands"` test
  proves our own mapping code (`mapPiCommandKind`) behaves as described _given_ a
  `source: "extension"`/`"skill"` value, but every occurrence of those values in
  this repository's tests is a hand-written fixture, not an observed response from
  a running Pi process. That a real extension or skill actually sends `source:
"extension"`/`"skill"` (rather than, say, always `"prompt"` in practice) is
  something only a live Pi session could confirm, and this task's agent cannot open
  that socket. This does not change §1's classification of the schema itself, only
  how confidently "skills with slash commands are visible today" should be read
  against real usage rather than against the type declaration and its fixtures.
- **Whether `listFeatures()`'s stub return of `[]` was ever intended to be this
  reporting seam.** Its name and signature (`Promise<AgentFeature[]>` per
  `AgentSessionConfig`) look purpose-built for exactly this kind of report, but
  nothing in `plan.md`, `docs/issues-from-plan.md`, or a commit message found by
  `git log -S'listFeatures'` states what it was meant to return. T50A1 is written
  against a new report path rather than filling in `listFeatures()`, on the
  principle that an unexplained stub should not be assumed to already be the right
  shape for a requirement it predates.
