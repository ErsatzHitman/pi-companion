import { useState } from "react";
import { testing } from "@picompanion/frontend-core";

import {
  Banner,
  Button,
  Card,
  Chip,
  ChipGroup,
  CodeBlock,
  Dialog,
  Divider,
  EmptyState,
  ErrorState,
  IconButton,
  Link,
  LoadingState,
  Popover,
  Progress,
  RecordList,
  SearchField,
  Section,
  Select,
  Sheet,
  StatusIndicator,
  TextArea,
  TextField,
  Toast,
  ToastRegion,
  Toggle,
} from "../ui/primitives/index.js";

const {
  bannerLabCases,
  buttonLabCases,
  chipLabCases,
  codeBlockLabCases,
  dialogLabCase,
  emptyStateLabCase,
  errorStateLabCase,
  iconButtonLabCases,
  linkLabCases,
  loadingStateLabCase,
  popoverLabCase,
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
} = testing;

/**
 * T25A dev-only component lab (plan.md §10.3): renders every primitive
 * from the shared `@picompanion/frontend-core/testing` fixtures — one
 * `<Section title="...">` per entry in `testing.primitiveLabManifest`, so
 * `apps/web` and `apps/android` (T26A) exercise identical cases. Never
 * imported outside `dev/component-lab-route.tsx`'s dev-only branch — see
 * that file for why this never reaches a production bundle.
 */
export function ComponentLab() {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [toggles, setToggles] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(toggleLabCases.map((toggleCase) => [toggleCase.id, toggleCase.checked])),
  );

  return (
    <div className="component-lab">
      <h2>Component lab</h2>
      <p>Dev-only: renders every §10.3 primitive from shared fixtures.</p>

      <Section title="Button" id="lab-button">
        <div className="component-lab__row">
          {buttonLabCases.map((buttonCase) => (
            <Button key={buttonCase.id} kind={buttonCase.kind} disabled={buttonCase.disabled}>
              {buttonCase.label}
            </Button>
          ))}
        </div>
      </Section>

      <Section title="IconButton" id="lab-icon-button">
        <div className="component-lab__row">
          {iconButtonLabCases.map((iconButtonCase) => (
            <IconButton
              key={iconButtonCase.id}
              icon={iconButtonCase.icon}
              accessibleName={iconButtonCase.accessibleName}
            />
          ))}
        </div>
      </Section>

      <Section title="Link" id="lab-link">
        <div className="component-lab__row">
          {linkLabCases.map((linkCase) => (
            <Link key={linkCase.id} href={linkCase.href} external={linkCase.external}>
              {linkCase.label}
            </Link>
          ))}
        </div>
      </Section>

      <Section title="TextField" id="lab-text-field">
        <div className="component-lab__column">
          {textFieldLabCases.map((fieldCase) => (
            <TextField
              key={fieldCase.id}
              label={fieldCase.label}
              placeholder={fieldCase.placeholder}
              defaultValue={fieldCase.value}
              error={fieldCase.error}
              required={fieldCase.required}
              testId={`text-field-${fieldCase.id}`}
            />
          ))}
        </div>
      </Section>

      <Section title="TextArea" id="lab-text-area">
        <TextArea
          label={textAreaLabCase.label}
          placeholder={textAreaLabCase.placeholder}
          testId="text-area-prompt"
        />
      </Section>

      <Section title="Select" id="lab-select">
        <div className="component-lab__column">
          {selectLabCases.map((selectCase) => (
            <Select
              key={selectCase.id}
              label={selectCase.label}
              options={selectCase.options}
              defaultValue={selectCase.value}
              testId={`select-${selectCase.id}`}
            />
          ))}
        </div>
      </Section>

      <Section title="Toggle" id="lab-toggle">
        <div className="component-lab__column">
          {toggleLabCases.map((toggleCase) => (
            <Toggle
              key={toggleCase.id}
              label={toggleCase.label}
              checked={toggles[toggleCase.id] ?? toggleCase.checked}
              disabled={toggleCase.disabled}
              testId={`toggle-${toggleCase.id}`}
              onCheckedChange={(checked) =>
                setToggles((current) => ({ ...current, [toggleCase.id]: checked }))
              }
            />
          ))}
        </div>
      </Section>

      <Section title="Card" id="lab-card">
        <Card>
          <p>A card is a raised surface container.</p>
        </Card>
      </Section>

      <Section title="Section" id="lab-section">
        <Section title="Nested example" id="lab-section-nested">
          <p>Section groups related controls behind a labelled heading.</p>
        </Section>
      </Section>

      <Section title="Divider" id="lab-divider">
        <p>Above the divider.</p>
        <Divider />
        <p>Below the divider.</p>
      </Section>

      <Section title="Chip" id="lab-chip">
        <div className="component-lab__row">
          {chipLabCases.map((chipCase) => (
            <Chip
              key={chipCase.id}
              label={chipCase.label}
              tone={chipCase.tone}
              onRemove={chipCase.removable ? () => {} : undefined}
              testId={`chip-${chipCase.id}`}
            />
          ))}
        </div>
      </Section>

      <Section title="ChipGroup" id="lab-chip-group">
        <ChipGroup ariaLabel="Permissions">
          {chipLabCases.map((chipCase) => (
            <Chip key={chipCase.id} label={chipCase.label} tone={chipCase.tone} />
          ))}
        </ChipGroup>
      </Section>

      <Section title="StatusIndicator" id="lab-status-indicator">
        <div className="component-lab__column">
          {statusIndicatorLabCases.map((statusCase) => (
            <StatusIndicator
              key={statusCase.id}
              label={statusCase.label}
              tone={statusCase.tone}
              statusText={statusCase.statusText}
              testId={`status-${statusCase.id}`}
            />
          ))}
        </div>
      </Section>

      <Section title="Progress" id="lab-progress">
        <div className="component-lab__column">
          {progressLabCases.map((progressCase) => (
            <Progress
              key={progressCase.id}
              label={progressCase.label}
              value={progressCase.value}
              testId={`progress-${progressCase.id}`}
            />
          ))}
        </div>
      </Section>

      <Section title="SearchField" id="lab-search-field">
        <div className="component-lab__column">
          {searchFieldLabCases.map((searchCase) => (
            <SearchField
              key={searchCase.id}
              label={searchCase.label}
              placeholder={searchCase.placeholder}
              defaultValue={searchCase.value}
              testId={`search-field-${searchCase.id}`}
            />
          ))}
        </div>
      </Section>

      <Section title="RecordList" id="lab-record-list">
        <RecordList
          ariaLabel="Sessions"
          columns={recordListLabCase.columns}
          rows={recordListLabCase.rows}
          testId="record-list-sessions"
        />
      </Section>

      <Section title="CodeBlock" id="lab-code-block">
        <div className="component-lab__column">
          {codeBlockLabCases.map((codeCase) => (
            <CodeBlock key={codeCase.id} code={codeCase.code} language={codeCase.language} />
          ))}
        </div>
      </Section>

      <Section title="EmptyState" id="lab-empty-state">
        <EmptyState title={emptyStateLabCase.title} description={emptyStateLabCase.description} />
      </Section>

      <Section title="ErrorState" id="lab-error-state">
        <ErrorState title={errorStateLabCase.title} description={errorStateLabCase.description} />
      </Section>

      <Section title="LoadingState" id="lab-loading-state">
        <LoadingState
          title={loadingStateLabCase.title}
          description={loadingStateLabCase.description}
        />
      </Section>

      <Section title="Sheet" id="lab-sheet">
        <Button onClick={() => setSheetOpen(true)}>Open sheet</Button>
        <Sheet
          open={sheetOpen}
          title={sheetLabCase.title}
          description={sheetLabCase.description}
          onClose={() => setSheetOpen(false)}
          testId="sheet-session-actions"
        />
      </Section>

      <Section title="Dialog" id="lab-dialog">
        <Button onClick={() => setDialogOpen(true)}>Open dialog</Button>
        <Dialog
          open={dialogOpen}
          title={dialogLabCase.title}
          description={dialogLabCase.description}
          confirmLabel={dialogLabCase.confirmLabel}
          cancelLabel={dialogLabCase.cancelLabel}
          dangerous={dialogLabCase.dangerous}
          onConfirm={() => setDialogOpen(false)}
          onClose={() => setDialogOpen(false)}
          testId="dialog-delete-session"
        />
      </Section>

      <Section title="Popover" id="lab-popover">
        <Popover triggerLabel={popoverLabCase.triggerLabel} testId="popover-model-info">
          {popoverLabCase.content}
        </Popover>
      </Section>

      <Section title="Toast" id="lab-toast">
        <ToastRegion>
          {toastLabCases.map((toastCase) => (
            <Toast
              key={toastCase.id}
              tone={toastCase.tone}
              message={toastCase.message}
              testId={`toast-${toastCase.id}`}
            />
          ))}
        </ToastRegion>
      </Section>

      <Section title="Banner" id="lab-banner">
        <div className="component-lab__column">
          {bannerLabCases.map((bannerCase) => (
            <Banner
              key={bannerCase.id}
              tone={bannerCase.tone}
              message={bannerCase.message}
              actionLabel={bannerCase.actionLabel}
              testId={`banner-${bannerCase.id}`}
            />
          ))}
        </div>
      </Section>
    </div>
  );
}

export default ComponentLab;
