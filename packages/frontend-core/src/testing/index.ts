/**
 * Testing domain — plan.md §6, T24 ("Add navigation intents, fixtures,
 * recorded-session test").
 *
 * Owns the shared fixtures and contract builders `apps/web` and
 * `apps/android` test suites consume: the recorded-session fixture that
 * drives this package's own plain-Node Phase 2 exit test
 * (`recorded-session.test.ts`), synthetic `HostProfile` builders for
 * connect/pairing/onboarding suites, and (T98) the §11.7 extension
 * fixtures under `./fixtures/extensions/`. See `fixtures/README.md` and
 * `fixtures/extensions/README.md` for the full rationale and layout.
 *
 * Repository invariant: this module must never import React, React
 * Native, Expo, DOM types, or browser globals. Test fixtures must stay
 * usable from plain Node, without any UI framework.
 *
 * T98: `frontend-core`'s `package.json` `exports` map has a single "."
 * entry (no `./testing/fixtures/extensions` subpath), so this file — not
 * a subpath export — is the only route a consuming workspace has to these
 * fixtures. `extensions/index.ts` already re-exports `FixtureFrame` /
 * `FixtureFrameDirection` (re-exported again, unchanged, from
 * `./fixtures/types.js`, the same module this file's own flat exports
 * below already expose under those names), so the extensions module is
 * re-exported as a namespace (`testing.extensions.*`) rather than
 * flattened, to avoid a duplicate-export collision on those two names.
 *
 * T104: also re-exports `./plan-table.js` — a small, pure plan.md
 * markdown-table parser used to drive §11.7 fixture-coverage assertions
 * from the real spec table instead of a hand-copied list. This is the
 * only route `apps/web`'s test suite has to it (same subpath-export
 * constraint as above), and it is what makes
 * `testing.parseSection117BridgeElementsTable` callable from
 * `apps/web/src/features/extensions/extension-fixture-renderers.test.tsx`.
 * Reading plan.md off disk is each caller's own job (see `plan-table.js`'s
 * doc comment for why: this module must stay `node:fs`-free to satisfy
 * this package's strict, ambient-type-free `tsc` build).
 */
export * as extensions from "./fixtures/extensions/index.js";
export type { MarkdownTableRow, Section117BridgeElementRow } from "./plan-table.js";
export {
  extractMarkdownTableAfterHeading,
  parseSection117BridgeElementsTable,
} from "./plan-table.js";
export type {
  FixtureFrame,
  FixtureFrameDirection,
  RecordedSessionChapter,
} from "./fixtures/types.js";
export {
  listRecordedSessionChapters,
  loadRecordedSessionChapter,
  loadRecordedSessionFixture,
} from "./fixtures/recorded-session.js";
export {
  buildDirectHostProfileFixture,
  buildDualConnectionHostProfileFixture,
  buildRelayHostProfileFixture,
} from "./fixtures/host-profiles.js";
export type {
  BannerLabCase,
  ButtonLabCase,
  ChipLabCase,
  CodeBlockLabCase,
  DialogLabCase,
  EmptyLikeStateLabCase,
  IconButtonLabCase,
  LabTone,
  LinkLabCase,
  PopoverLabCase,
  ProgressLabCase,
  RecordListColumn,
  RecordListLabCase,
  RecordListRow,
  SearchFieldLabCase,
  SelectLabCase,
  SelectLabOption,
  SheetLabCase,
  StatusIndicatorLabCase,
  TextFieldLabCase,
  ToastLabCase,
  ToggleLabCase,
} from "./fixtures/primitive-lab.js";
export {
  bannerLabCases,
  buttonLabCases,
  chipLabCases,
  codeBlockLabCases,
  dialogLabCase,
  emptyStateLabCase,
  errorStateLabCase,
  iconButtonLabCases,
  labTones,
  linkLabCases,
  loadingStateLabCase,
  popoverLabCase,
  primitiveLabManifest,
  progressLabCases,
  recordListLabCase,
  searchFieldLabCases,
  selectLabCases,
  sheetLabCase,
  statusIndicatorLabCases,
  textAreaLabCase,
  textFieldLabCases,
  toastLabCases,
  toggleLabCases,
} from "./fixtures/primitive-lab.js";
export type {
  ApprovalFormLabCase,
  CodeListingLabCase,
  CommandSearchItemLabCase,
  CommandSearchLabCase,
  DiffSummaryLabCase,
  PromptBarLabCase,
  SelectionActionLabCase,
  StreamingMessageLabCase,
  TaskRowLabCase,
  ThinkingSectionLabCase,
  ToolChipLabCase,
  WorkflowStepLabCase,
} from "./fixtures/recipe-lab.js";
export {
  approvalFormDangerousLabCase,
  approvalFormLabCase,
  codeListingLabCase,
  commandSearchLabCase,
  diffSummaryLabCases,
  promptBarLabCase,
  promptBarQueuedLabCase,
  recipeLabManifest,
  selectionActionsLabCase,
  streamingMessageLabCases,
  taskRowLabCases,
  thinkingSectionLabCases,
  toolChipLabCases,
  workflowStepsLabCases,
} from "./fixtures/recipe-lab.js";
