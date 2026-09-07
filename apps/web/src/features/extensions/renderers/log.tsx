/**
 * `log` kind renderer (plan.md §11.3; T29A3) — "Streaming lines", presented
 * as a bounded, scrollable log region.
 *
 * "Bounded" here means capping how many of the payload's `lines` are ever
 * mounted, to the payload's own `tail` hint (or `DEFAULT_LOG_TAIL` when
 * absent) — not full list virtualization, which is the transcript's own
 * concern (T28A6), applied to a different, much larger list. A `log`
 * element's payload already arrives pre-bounded on the wire in practice
 * (plan.md §11.4 payload size limits), so a simple slice-and-scroll region
 * is sufficient here.
 *
 * `DEFAULT_LOG_TAIL` is **200**, matching
 * `apps/android/src/features/extensions/renderers/log-model.ts`'s constant
 * of the same name. Until T226, this file capped at 500 while Android
 * capped at 200 — two thresholds and, per plan.md §11.3's `log` row's own
 * wording, two named mechanisms ("virtualized log" for web) answering the
 * same plan.md §14.5 budget bullet. T226 resolved both: the mechanism on
 * *both* platforms is this payload/mount cap, not a scrolling render
 * window (real windowed virtualization, the kind the transcript uses, has
 * nothing to recycle here because the payload is already small — see
 * below), and the threshold is 200, because that is the number plan.md
 * §14.5 itself states and the number real extensions already emit: the
 * `loop` extension's own log section already tail-caps at 200 lines on the
 * wire — plan.md §14.5 states that too, calling it "a bound already met on
 * the wire, not a target to grow toward". Raising the web cap to 500 bought nothing observable — no
 * shipped extension sends a log payload anywhere near that long — while
 * costing more mounted DOM nodes than necessary for the one platform with
 * the most headroom to spare. See plan.md §14.5 for the recorded decision.
 */
import { CodeBlock } from "../../../ui/primitives/index.js";
import type { PiUiElementRendererProps } from "../registry.js";
import { ElementActionsRow } from "./element-actions.js";
import "./renderers.css";

/** Cap applied when the payload does not specify its own `tail` hint. */
export const DEFAULT_LOG_TAIL = 200;

export function LogRenderer({
  element,
  payload,
  dispatchAction,
  getActionState,
}: PiUiElementRendererProps<"log">) {
  const title = element.title ?? "Log";
  const tail = payload.tail && payload.tail > 0 ? payload.tail : DEFAULT_LOG_TAIL;
  const totalLines = payload.lines.length;
  const visibleLines = totalLines > tail ? payload.lines.slice(totalLines - tail) : payload.lines;
  const hiddenCount = totalLines - visibleLines.length;

  return (
    <div className="pc-pi-log" data-testid={`pi-log-${element.ns}-${element.id}`}>
      <h3 className="pc-pi-log__title">{title}</h3>
      {hiddenCount > 0 ? (
        <p className="pc-pi-log__truncated">
          Showing last {visibleLines.length} of {totalLines} lines ({hiddenCount} earlier{" "}
          {hiddenCount === 1 ? "line" : "lines"} hidden).
        </p>
      ) : null}
      <div
        className="pc-pi-log__scroll"
        role="log"
        aria-label={`${title} output`}
        data-testid={`pi-log-${element.ns}-${element.id}-scroll`}
      >
        {visibleLines.length > 0 ? (
          payload.mono === false ? (
            <ul className="pc-pi-log__lines">
              {visibleLines.map((line, index) => (
                // Log lines have no stable identity on the wire; index is the
                // best available key within one render of one payload.
                <li key={index}>{line}</li>
              ))}
            </ul>
          ) : (
            <CodeBlock code={visibleLines.join("\n")} />
          )
        ) : (
          <p className="pc-pi-log__empty">No output yet.</p>
        )}
      </div>
      <ElementActionsRow
        actions={element.actions}
        dispatchAction={dispatchAction}
        getActionState={getActionState}
        ariaLabel={`${title} actions`}
      />
    </div>
  );
}
