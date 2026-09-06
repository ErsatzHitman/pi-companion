/**
 * Per-element error boundary (plan.md §11.4; T34A1).
 *
 * A Pi UI Bridge element is untrusted, extension-authored content: one
 * malformed row in a `roster` payload, or one kind renderer with a bug,
 * must never take down the whole rail/pinned-widget stack. React error
 * boundaries can only be class components, so this one file stays a class
 * rather than following the rest of this app's function-component
 * convention — same as the web counterpart
 * (`apps/web/src/features/extensions/registry-boundary.tsx`).
 *
 * The identity/`resetKey`-changed decision this makes in
 * `componentDidUpdate` is factored out into `shouldResetExtensionBoundary`
 * (`registry-boundary-reset.ts`) so it is unit-tested directly; this file
 * itself pulls in `react-native` (via `ErrorState`) and so cannot be
 * imported from a test in this workspace — see `registry.test.ts`'s doc
 * comment for why.
 */
import { Component, type ErrorInfo, type ReactNode } from "react";

import type { Logger } from "@picompanion/frontend-core";

import { ErrorState } from "../../ui/primitives";
import { shouldResetExtensionBoundary } from "./registry-boundary-reset";

export interface ExtensionElementBoundaryProps {
  ns: string;
  elementId: string;
  kind: string;
  logger: Logger;
  children: ReactNode;
  /**
   * Changing this (e.g. to the element's revision) after a caught error
   * gives the element a fresh chance to render, instead of staying stuck
   * on a stale error forever once its upstream payload changes.
   */
  resetKey?: string | number;
  testId?: string;
}

interface ExtensionElementBoundaryState {
  error: Error | null;
}

/**
 * Contains a thrown error from one Pi UI element's renderer. Renders the
 * shared `ErrorState` primitive (`accessibilityLiveRegion="assertive"`,
 * plan.md §10.5) in place of just that element; every sibling element
 * (each wrapped in its own boundary instance) keeps rendering normally.
 */
export class ExtensionElementBoundary extends Component<
  ExtensionElementBoundaryProps,
  ExtensionElementBoundaryState
> {
  override state: ExtensionElementBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ExtensionElementBoundaryState {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    this.props.logger.error("Pi UI element renderer threw", {
      ns: this.props.ns,
      elementId: this.props.elementId,
      kind: this.props.kind,
      message: error.message,
      componentStack: info.componentStack ?? undefined,
    });
  }

  override componentDidUpdate(prevProps: ExtensionElementBoundaryProps): void {
    if (!this.state.error) return;
    if (
      shouldResetExtensionBoundary(
        { ns: prevProps.ns, elementId: prevProps.elementId, resetKey: prevProps.resetKey },
        { ns: this.props.ns, elementId: this.props.elementId, resetKey: this.props.resetKey },
      )
    ) {
      this.setState({ error: null });
    }
  }

  override render(): ReactNode {
    if (this.state.error) {
      return (
        <ErrorState
          title={`"${this.props.kind}" element failed to render`}
          description={this.state.error.message || "An unexpected error occurred."}
          testId={this.props.testId}
        />
      );
    }
    return this.props.children;
  }
}
