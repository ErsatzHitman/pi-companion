/**
 * One copyable diagnostics row (T41B1 acceptance: "values are copyable").
 *
 * Copies through `useCore().platform.clipboard` — the same `Clipboard`
 * interface every other platform feature goes through
 * (`platform/clipboard.ts`'s `createBrowserClipboard`), never a raw
 * `navigator.clipboard` call. `writeText` there throws when the
 * Clipboard API is unavailable or denied rather than silently
 * succeeding, and this component surfaces that failure as visible,
 * non-color status text (`StatusIndicator` `tone="danger"`) — it never
 * shows "Copied" unless the write actually resolved.
 *
 * CORRECTED (P6-W12): this said `features/transcript/tool-call-row.tsx`'s
 * `useClipboardAction` "swallows every clipboard failure in a bare
 * `catch {}` and shows 'Copied' regardless of whether the write
 * succeeded", and named it the deliberate contrast this component was
 * written against. That was true when T41B1 wrote it and T139 fixed it:
 * `useClipboardAction` now distinguishes an absent Clipboard API from a
 * rejected write and surfaces both visibly. The two are convergent
 * shapes, not a contrast — see T139's commit for why they were left as
 * separate implementations rather than one shared hook.
 */
import { useEffect, useRef, useState } from "react";

import { useCore } from "../../app/core-context.js";
import { IconButton, StatusIndicator } from "../../ui/primitives/index.js";

type CopyState = { kind: "idle" } | { kind: "copied" } | { kind: "failed"; reason: string };

export interface CopyableFieldProps {
  label: string;
  value: string;
  testId?: string;
}

export function CopyableField({ label, value, testId }: CopyableFieldProps) {
  const { platform } = useCore();
  const [state, setState] = useState<CopyState>({ kind: "idle" });
  const clearTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => () => clearTimeout(clearTimerRef.current), []);

  async function handleCopy() {
    clearTimeout(clearTimerRef.current);
    try {
      await platform.clipboard.writeText(value);
    } catch (error: unknown) {
      // Visible, not swallowed: stays on screen until the next copy
      // attempt rather than auto-clearing like a success confirmation.
      setState({
        kind: "failed",
        reason: error instanceof Error ? error.message : "Clipboard copy failed",
      });
      return;
    }
    setState({ kind: "copied" });
    clearTimerRef.current = setTimeout(() => setState({ kind: "idle" }), 2000);
  }

  const statusTestId = testId ? `${testId}-status` : undefined;

  return (
    <div className="pc-diagnostics-field" data-testid={testId}>
      <span className="pc-diagnostics-field__label" id={testId ? `${testId}-label` : undefined}>
        {label}
      </span>
      <span
        className="pc-diagnostics-field__value"
        data-testid={testId ? `${testId}-value` : undefined}
      >
        {value}
      </span>
      <IconButton
        icon="copy"
        accessibleName={`Copy ${label}`}
        onClick={() => void handleCopy()}
        data-testid={testId ? `${testId}-copy` : undefined}
      />
      {state.kind === "copied" ? (
        <StatusIndicator label={label} tone="success" statusText="Copied" testId={statusTestId} />
      ) : null}
      {state.kind === "failed" ? (
        <StatusIndicator
          label={label}
          tone="danger"
          statusText={`Copy failed — ${state.reason}`}
          testId={statusTestId}
        />
      ) : null}
    </div>
  );
}

export default CopyableField;
