import { extensions, type Clock, type TimerHandle } from "@picompanion/frontend-core";
import type { telemetry as coreTelemetry } from "@picompanion/frontend-core";
import type {
  PiUiElement,
  PiUiProgressPayload,
  PiUiRosterRow,
} from "@picompanion/protocol/pi-ui-bridge/schema";
import type { ReactNode } from "react";

import { readStartedAt, useElapsedSince } from "../extensions/renderers/elapsed-time.js";
import { RailElementCard } from "./rail-element-card.js";
import {
  RAIL_STATUS_GLYPH,
  RAIL_STATUS_LABEL,
  progressPayloadStatus,
  progressStepCounter,
  railProgressFraction,
  railTrackModifier,
  rosterRowStatus,
  type RailStatus,
} from "./rail-status.js";
import { selectRailElements } from "./select-rail-elements.js";
import "./pi-extension-rail.css";

const { piUiElementKeyOf } = extensions;

/** Real wall-clock `Clock` (plan.md §7.3) for the Subagents card's live elapsed-time labels. */
const wallClock: Clock = {
  now: () => Date.now(),
  setTimeout: (callback, delayMs) =>
    globalThis.setTimeout(callback, delayMs) as unknown as TimerHandle,
  clearTimeout: (handle) => globalThis.clearTimeout(handle as unknown as number),
  setInterval: (callback, intervalMs) =>
    globalThis.setInterval(callback, intervalMs) as unknown as TimerHandle,
  clearInterval: (handle) => globalThis.clearInterval(handle as unknown as number),
};

export interface PiExtensionRailProps {
  /**
   * One agent's live Pi UI elements, in any placement. This component does
   * its own §11.5 placement filtering (`selectRailElements`), so callers can
   * pass an agent's full element set straight from `PiUiElementStore` without
   * pre-filtering.
   */
  elements: readonly PiUiElement[];
  /** The agent these elements belong to (plan.md §12.3 action identity). */
  agentId: string;
  /** Dispatches and tracks Pi UI actions for this agent (T21C `ExtensionActionController`). */
  actionController: extensions.ExtensionActionController;
  /** This agent's current known Pi UI Bridge revision, for the dev-mode stale-state badge. */
  revision?: number;
  /**
   * Accepted for source compatibility with callers built against the
   * earlier design, where this component itself mounted `ContextMeter`
   * behind this prop. Deliberately unused now: the reference Live pane
   * (`docs/ui-reference/pi-companion-web.html` `.live` region) holds only
   * the Subagents and Workflow cards — no Context/Cache/Cost block — that
   * telemetry now belongs to the composer's context ring
   * (`features/composer/ContextRing.tsx` opens it; `Composer.tsx` renders
   * the same `ContextMeter` inside that ring's own session-controls
   * sheet), neither owned by this component.
   */
  telemetry?: coreTelemetry.ContextWindowTelemetry;
  /** Shimmer placeholder rows instead of content, while the first Pi UI snapshot has not arrived yet. */
  loading?: boolean;
}

/** One `section`+heading card shell, matching the mockup's `.card`/`.card-h` (plan.md §8.3, §11.5). */
function RailCard({
  title,
  count,
  headingId,
  children,
}: {
  title: string;
  count?: string;
  headingId: string;
  children: ReactNode;
}) {
  return (
    <section className="pi-extension-rail__card" aria-labelledby={headingId}>
      <div className="pi-extension-rail__card-header">
        <h2 className="pi-extension-rail__card-title" id={headingId}>
          {title}
        </h2>
        {count ? <span className="pi-extension-rail__card-count">{count}</span> : null}
      </div>
      {children}
    </section>
  );
}

/** A status glyph, distinguished by shape first (never colour alone) with a visually-hidden text label. */
function StatusGlyph({ status, testId }: { status: RailStatus; testId?: string }) {
  return (
    <span
      className={`pi-extension-rail__glyph pi-extension-rail__glyph--${status}`}
      data-testid={testId}
    >
      <span aria-hidden="true">{RAIL_STATUS_GLYPH[status]}</span>
      <span className="pc-visually-hidden">{RAIL_STATUS_LABEL[status]}</span>
    </span>
  );
}

function AgentRow({ elementId, row }: { elementId: string; row: PiUiRosterRow }) {
  const status = rosterRowStatus(row.state);
  const startedAt = readStartedAt(row);
  const elapsed = useElapsedSince(startedAt, wallClock);
  const fraction = row.progress ? railProgressFraction(row.progress) : undefined;
  const trackModifier = railTrackModifier(status);
  const testId = `pi-rail-agent-${elementId}-${row.id}`;

  return (
    <div className="pi-extension-rail__agent" data-testid={testId}>
      <div className="pi-extension-rail__agent-row">
        <StatusGlyph status={status} testId={`${testId}-glyph`} />
        <span className="pi-extension-rail__agent-name">{row.label}</span>
        {elapsed ? <span className="pi-extension-rail__elapsed">{elapsed}</span> : null}
      </div>
      {row.detail ? <div className="pi-extension-rail__agent-detail">{row.detail}</div> : null}
      {fraction !== undefined ? (
        <div
          className={`pi-extension-rail__track${trackModifier ? ` pi-extension-rail__track--${trackModifier}` : ""}`}
          role="progressbar"
          aria-label={`${row.label} progress`}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(fraction * 100)}
        >
          <i style={{ width: `${fraction * 100}%` }} />
        </div>
      ) : null}
    </div>
  );
}

/** The "Subagents" card: one `.agent` row per roster row across every `ns:"subagents"` `roster` element (plan.md §11.7 `subagents`). */
function SubagentsCard({ elements }: { elements: readonly PiUiElement[] }) {
  const rows = elements.flatMap((element) =>
    element.payload?.kind === "roster"
      ? element.payload.rows.map((row) => ({ elementId: element.id, row }))
      : [],
  );
  if (rows.length === 0) return null;

  const running = rows.filter(({ row }) => rosterRowStatus(row.state) === "running").length;

  return (
    <RailCard
      title="Subagents"
      count={`${running} running · ${rows.length} total`}
      headingId="pi-extension-rail-subagents-heading"
    >
      {rows.map(({ elementId, row }) => (
        <AgentRow key={`${elementId}:${row.id}`} elementId={elementId} row={row} />
      ))}
    </RailCard>
  );
}

function PhaseRow({ element, payload }: { element: PiUiElement; payload: PiUiProgressPayload }) {
  const status = progressPayloadStatus(payload);
  const name = payload.label ?? element.title ?? element.id;
  const testId = `pi-rail-phase-${element.ns}-${element.id}`;

  return (
    <div
      className={`pi-extension-rail__phase pi-extension-rail__phase--${status}`}
      data-testid={testId}
    >
      <span className="pi-extension-rail__phase-glyph" aria-hidden="true">
        {RAIL_STATUS_GLYPH[status]}
      </span>
      <span className="pc-visually-hidden">{RAIL_STATUS_LABEL[status]}</span>
      <span className="pi-extension-rail__phase-name">{name}</span>
      <span className="pi-extension-rail__phase-detail">{progressStepCounter(payload)}</span>
    </div>
  );
}

/** The "Workflow" card: one `.phase` row per `ns:"workflow"` element (plan.md §11.7 `workflows`, `workflow:progress`). */
function WorkflowCard({ elements }: { elements: readonly PiUiElement[] }) {
  const phases = elements.flatMap((element) =>
    element.payload?.kind === "progress" ? [{ element, payload: element.payload }] : [],
  );
  if (phases.length === 0) return null;

  const done = phases.filter(({ payload }) => progressPayloadStatus(payload) === "done").length;

  return (
    <RailCard
      title="Workflow"
      count={`${done} of ${phases.length}`}
      headingId="pi-extension-rail-workflow-heading"
    >
      <div className="pi-extension-rail__flow">
        {phases.map(({ element, payload }) => (
          <PhaseRow key={piUiElementKeyOf(element)} element={element} payload={payload} />
        ))}
      </div>
    </RailCard>
  );
}

function ShimmerCard({ rows, testId }: { rows: number; testId: string }) {
  return (
    <section className="pi-extension-rail__card" aria-hidden="true" data-testid={testId}>
      <div className="pi-extension-rail__shimmer-row pi-extension-rail__shimmer-row--title" />
      {Array.from({ length: rows }, (_, index) => (
        <div className="pi-extension-rail__shimmer-row" key={index} />
      ))}
    </section>
  );
}

/**
 * The web right extension rail's content — the reference Live pane
 * (`docs/ui-reference/pi-companion-web.html` `.live` region; plan.md §8.3,
 * §11.5).
 *
 * Mounts into `Shell`'s `extensionRail` slot (`ui/shell.tsx`, owned by
 * T27S1 and not edited here). Every pinned element (`selectRailElements`)
 * is bucketed by namespace/kind into three destinations, matching the
 * reference's own two named cards plus a generic fallback:
 *
 * - only `pinned`-placement elements ever appear here (`selectRailElements`);
 * - `ns:"subagents"` `roster` elements' rows become the "Subagents" card's
 *   `.agent` rows (plan.md §11.7 `subagents`);
 * - `ns:"workflow"` `progress` elements each become the "Workflow" card's
 *   one `.phase` row (plan.md §11.7 `workflows`, the `workflow:progress`
 *   channel's daemon-synthesized pinned element);
 * - every other pinned element (loop, goal, todo, advisor, and anything
 *   else) renders through the existing per-kind renderer registry
 *   (`RailElementCard` → `PiUiElementView`), each in its own generic
 *   `.card` shell — full per-kind fidelity, never a collapsed summary.
 *   plan.md §8.3: "A running subagent fleet, workflow, loop, or goal
 *   remains visible in the right rail. It does not disappear into a
 *   collapsed status chip." Every live element keeps a real row or card of
 *   its own here for as long as it is live and the pane is on screen — the
 *   two bespoke cards above are a faithful rendering of those elements, not
 *   a summary standing in for them. That is a separate axis from `Shell`'s
 *   own manual rail collapse (`ui/shell.tsx`, `ui/use-rail-collapse.ts`):
 *   a user can hide the whole pane as an explicit, reversible choice, which
 *   is a full show/hide — never a degraded status chip substituted for this
 *   content while the pane is shown;
 * - live updates flow straight through: this component owns no element
 *   state of its own, so a caller subscribed to a live `PiUiElementStore`
 *   (`usePiUiRailElements`, T29R1) re-renders this list on every published
 *   delta — fleet/workflow/loop/goal content is exactly as live as the
 *   store it is read from, never a one-time snapshot.
 *
 * Live updates flow straight through: this component owns no element state
 * of its own, so a caller subscribed to a live `PiUiElementStore`
 * (`usePiUiRailElements`, T29R1) re-renders this list on every published
 * delta.
 */
export function PiExtensionRail({
  elements,
  agentId,
  actionController,
  revision,
  loading = false,
}: PiExtensionRailProps) {
  if (loading) {
    return (
      <div className="pi-extension-rail" data-testid="pi-extension-rail-loading">
        <ShimmerCard rows={3} testId="pi-extension-rail-shimmer-subagents" />
        <ShimmerCard rows={4} testId="pi-extension-rail-shimmer-workflow" />
      </div>
    );
  }

  const pinned = selectRailElements(elements);
  const subagentElements = pinned.filter(
    (element) => element.ns === "subagents" && element.payload?.kind === "roster",
  );
  const workflowElements = pinned.filter(
    (element) => element.ns === "workflow" && element.payload?.kind === "progress",
  );
  const bucketed = new Set([...subagentElements, ...workflowElements]);
  const otherElements = pinned.filter((element) => !bucketed.has(element));

  const hasSubagents = subagentElements.some(
    (element) => element.payload?.kind === "roster" && element.payload.rows.length > 0,
  );
  const hasWorkflow = workflowElements.length > 0;
  const isEmpty = !hasSubagents && !hasWorkflow && otherElements.length === 0;

  if (isEmpty) {
    return (
      <div className="pi-extension-rail" data-testid="pi-extension-rail">
        <RailCard title="No live extensions" headingId="pi-extension-rail-empty-heading">
          <p className="pi-extension-rail__empty-description" data-testid="pi-extension-rail-empty">
            Fleet, workflow, loop, and goal activity appear here while a session runs.
          </p>
        </RailCard>
      </div>
    );
  }

  return (
    <div className="pi-extension-rail" data-testid="pi-extension-rail">
      {hasSubagents ? <SubagentsCard elements={subagentElements} /> : null}
      {hasWorkflow ? <WorkflowCard elements={workflowElements} /> : null}
      {otherElements.map((element) => (
        <RailElementCard
          key={piUiElementKeyOf(element)}
          element={element}
          agentId={agentId}
          actionController={actionController}
          revision={revision}
        />
      ))}
    </div>
  );
}
