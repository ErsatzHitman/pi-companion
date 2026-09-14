/**
 * Root error boundary (plan.md §10.5; FIX-W3).
 *
 * Before this, the only error boundary anywhere in `apps/web/src` was
 * `ExtensionElementBoundary` (`features/extensions/registry-boundary.tsx`),
 * scoped to a single Pi UI element on purpose — a bug in one untrusted
 * extension-authored element must not take down the whole transcript/rail,
 * but it says nothing about the rest of the app. `router.tsx`'s
 * `createRouter` set no `defaultErrorComponent` either, so an uncaught
 * render error *anywhere else* (a route, a feature component, anything
 * outside that one narrow scope) unmounted the whole React tree and
 * blanked the app to a white screen, with no in-app way back. The only
 * recovery the user had was a hard reload — which is exactly the action
 * that (absent the FIX-W2 guard in `packages/frontend-core/src/composer/
 * drafts.ts`) could resend an already-queued draft, and which always
 * discards whatever in-memory state the crashed render was holding for no
 * reason beyond "the error boundary that would have contained it did not
 * exist yet".
 *
 * `AppErrorBoundary` wraps `RouterProvider` (see `App.tsx`) so a render
 * error anywhere in the routed app yields a recoverable, in-app error
 * state — built from the existing `Banner`/`Button` primitives and design
 * tokens, not a bespoke design — with a "Try again" action that resets the
 * boundary and gives the crashed subtree a fresh mount, the same
 * reset-on-demand shape `ExtensionElementBoundary` already uses (there,
 * automatically on `resetKey`/identity change; here, on an explicit user
 * action, since a whole-app crash has no equivalent implicit signal to key
 * off).
 */
import { Component, type ErrorInfo, type ReactNode } from "react";

import type { Logger } from "@picompanion/frontend-core";

import { Banner, Button } from "../ui/primitives/index.js";
import { useCore } from "./core-context.js";

export interface AppErrorBoundaryProps {
  children: ReactNode;
  testId?: string;
}

interface AppErrorBoundaryViewProps extends AppErrorBoundaryProps {
  logger: Logger;
}

interface AppErrorBoundaryState {
  error: Error | null;
}

/**
 * The class half (React error boundaries can only be class components,
 * same constraint `ExtensionElementBoundary` documents). Takes `logger` as
 * a plain prop rather than reading `useCore()` itself, exactly like
 * `ExtensionElementBoundary` takes its `logger` prop from its caller —
 * kept separate from `AppErrorBoundary` below so the logger lookup stays
 * in a function component that can use hooks.
 */
export class AppErrorBoundaryView extends Component<
  AppErrorBoundaryViewProps,
  AppErrorBoundaryState
> {
  override state: AppErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): AppErrorBoundaryState {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    this.props.logger.error("Unhandled render error reached the root error boundary", {
      message: error.message,
      componentStack: info.componentStack ?? undefined,
    });
  }

  private readonly reset = (): void => {
    this.setState({ error: null });
  };

  override render(): ReactNode {
    const { error } = this.state;
    if (!error) {
      return this.props.children;
    }
    return (
      <div className="pc-app-error-boundary" role="alert" data-testid={this.props.testId}>
        <Banner tone="danger" message={error.message || "Something went wrong."} />
        <Button kind="primary" onClick={this.reset}>
          Try again
        </Button>
      </div>
    );
  }
}

/** Reads the live platform `Logger` off `CoreProvider` and feeds `AppErrorBoundaryView`. */
export function AppErrorBoundary({ children, testId }: AppErrorBoundaryProps) {
  const { platform } = useCore();
  return (
    <AppErrorBoundaryView logger={platform.logger} testId={testId}>
      {children}
    </AppErrorBoundaryView>
  );
}
