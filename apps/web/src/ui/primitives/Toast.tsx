import type { ReactNode } from "react";

import "./primitives.css";

export type StatusTone = "success" | "warning" | "danger" | "info" | "neutral";

export interface ToastProps {
  tone: StatusTone;
  message: string;
  testId?: string;
}

/**
 * Toast primitive (plan.md §10.3): a transient, non-modal notification.
 * `role="status"` (`aria-live="polite"`) for info/success/neutral so it
 * doesn't interrupt; `danger`/`warning` toasts use `role="alert"`
 * (assertive) since those need to interrupt (plan.md §10.5 non-colour
 * status — the tone label below is also always paired with the message).
 */
export function Toast({ tone, message, testId }: ToastProps) {
  const assertive = tone === "danger" || tone === "warning";
  return (
    <div
      className={`pc-toast pc-toast--${tone}`}
      role={assertive ? "alert" : "status"}
      aria-live={assertive ? "assertive" : "polite"}
      data-testid={testId}
    >
      <span className="pc-visually-hidden">{toneLabel(tone)}:</span>
      {message}
    </div>
  );
}

/** Toast region: mount once per app, renders active toasts stacked bottom-right. */
export function ToastRegion({ children }: { children: ReactNode }) {
  return (
    <div className="pc-toast-region" aria-label="Notifications">
      {children}
    </div>
  );
}

function toneLabel(tone: StatusTone): string {
  switch (tone) {
    case "success":
      return "Success";
    case "warning":
      return "Warning";
    case "danger":
      return "Error";
    case "info":
      return "Info";
    default:
      return "Notice";
  }
}
