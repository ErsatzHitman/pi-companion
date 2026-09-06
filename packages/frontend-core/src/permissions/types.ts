/**
 * Permissions domain types — plan.md §7.1, §11.2, §12.3.
 *
 * `AgentPermissionRequest` is the single wire shape the daemon uses for
 * both "real" permission requests (Pi tool/plan/mode approval) and the
 * Tier-1 extension dialog requests described in plan.md §11.2 ("select,
 * confirm, input, and editor requests"). The ported Pi provider
 * (`packages/server/src/server/agent/providers/pi/agent.ts`,
 * `mapExtensionUiRequestToPermission`) maps every `extension_ui_request`
 * with method `select`/`input`/`editor`/`confirm` into an
 * `AgentPermissionRequest` with `kind: "question"` and
 * `metadata.extensionUiMethod` set to the original method name. This
 * module normalizes both flavors into one platform-neutral view model
 * so `apps/web` and `apps/android` never branch on daemon-internal
 * plumbing.
 */

import type {
  AgentPermissionAction,
  AgentPermissionRequest,
  AgentPermissionRequestKind,
  AgentPermissionResponse,
} from "@picompanion/protocol/agent-types";

export type {
  AgentPermissionAction,
  AgentPermissionRequest,
  AgentPermissionRequestKind,
  AgentPermissionResponse,
};

/**
 * The four extension dialog kinds from plan.md §11.2 tier 1. These are
 * carried over the wire as `AgentPermissionRequest.kind === "question"`
 * with `metadata.extensionUiMethod` set to one of these values.
 */
export type ExtensionDialogMethod = "select" | "input" | "editor" | "confirm";

const EXTENSION_DIALOG_METHODS: ReadonlySet<string> = new Set<ExtensionDialogMethod>([
  "select",
  "input",
  "editor",
  "confirm",
]);

export function isExtensionDialogMethod(value: unknown): value is ExtensionDialogMethod {
  return typeof value === "string" && EXTENSION_DIALOG_METHODS.has(value);
}

/**
 * How a dialog should be presented, derived from `kind` and
 * `metadata.extensionUiMethod`. Platform renderers switch on this
 * instead of re-deriving it from raw daemon metadata.
 */
export type PermissionDialogPresentation =
  | "tool-actions"
  | "select"
  | "input"
  | "editor"
  | "confirm"
  | "question";

/** One answerable question inside a request's `input.questions` array. */
export interface PermissionDialogQuestionOption {
  readonly label: string;
  readonly description?: string;
}

export interface PermissionDialogQuestion {
  readonly question: string;
  readonly header: string;
  readonly options: PermissionDialogQuestionOption[];
  readonly multiSelect: boolean;
  readonly placeholder?: string;
  readonly allowEmpty?: boolean;
  readonly allowOther?: boolean;
  readonly dismissLabel?: string;
}

/** Platform-neutral, renderer-ready projection of an `AgentPermissionRequest`. */
export interface PermissionDialogViewModel {
  readonly requestId: string;
  readonly agentId: string;
  readonly provider: AgentPermissionRequest["provider"];
  readonly name: string;
  readonly kind: AgentPermissionRequestKind;
  readonly presentation: PermissionDialogPresentation;
  readonly extensionUiMethod: ExtensionDialogMethod | null;
  readonly title?: string;
  readonly description?: string;
  readonly actions: AgentPermissionAction[];
  readonly questions: PermissionDialogQuestion[];
  readonly metadata: Record<string, unknown>;
  /** The unmodified daemon payload, for renderers that need raw detail/suggestions. */
  readonly raw: AgentPermissionRequest;
}

export type PermissionDialogStatus = "pending" | "answered" | "timeout";

/** Full lifecycle record kept by `PermissionsController` for one request. */
export interface PermissionDialogEntry {
  readonly view: PermissionDialogViewModel;
  readonly status: PermissionDialogStatus;
  /** `clock.now()` when the request was first observed. */
  readonly requestedAt: number;
  /** `clock.now()` when a local answer was dispatched, if any. */
  readonly respondedAt?: number;
  /** `clock.now()` when a daemon resolution was applied, if any. */
  readonly resolvedAt?: number;
  /** The response this client dispatched, before daemon confirmation. */
  readonly localResponse?: AgentPermissionResponse;
  /** The daemon-confirmed final resolution (`agent_permission_resolved`). */
  readonly resolution?: AgentPermissionResponse;
}

/** The exact outbound wire message shape for `agent_permission_response`. */
export interface AgentPermissionResponseWireMessage {
  readonly type: "agent_permission_response";
  readonly agentId: string;
  readonly requestId: string;
  readonly response: AgentPermissionResponse;
}
