/**
 * Diagnostics screen body (T41B1, plan.md §13 Phase 7: "Diagnostics
 * screen with versions, capabilities, connection path, and exportable
 * redacted logs"). T41B2 added `DiagnosticsExportControl`, the
 * exportable-redacted-log half named in that same plan.md line; this
 * screen shows the on-screen version/capability/connection-path view
 * AND offers the same data as one downloadable, redacted bundle.
 *
 * Renders unconditionally — there is no loading/error branch that hides
 * the screen, because `useDiagnosticsSnapshot` never has "no data" to
 * wait on: disconnected is itself a fully-formed, truthful snapshot (see
 * `diagnostics-model.ts`), not a state this screen needs to special-case.
 */
import { Button, Section, StatusIndicator } from "../../ui/primitives/index.js";

import { CopyableField } from "./CopyableField.js";
import type { DiagnosticsSection } from "./diagnostics-model.js";
import { useDiagnosticsExport } from "./use-diagnostics-export.js";
import { useDiagnosticsSnapshot } from "./use-diagnostics-snapshot.js";
import "./diagnostics.css";

export interface DiagnosticsScreenProps {
  appVersion: string;
  clientId: string;
  testId?: string;
}

function DiagnosticsSectionView({
  section,
  testId,
}: {
  section: DiagnosticsSection;
  testId?: string;
}) {
  return (
    <Section title={section.title} id={testId ? `${testId}-${section.id}` : undefined}>
      <div className="pc-diagnostics-section__fields">
        {section.fields.map((fieldItem) => (
          <CopyableField
            key={fieldItem.id}
            label={fieldItem.label}
            value={fieldItem.value}
            testId={testId ? `${testId}-${section.id}-${fieldItem.id}` : undefined}
          />
        ))}
      </div>
    </Section>
  );
}

/**
 * The exportable-redacted-log half (T41B2) of this screen. Builds the
 * SAME `sections` already rendered above into one downloadable, redacted
 * JSON bundle (`diagnostics-export.ts`) — never a second, separately
 * maintained list of fields. A redaction refusal
 * (`DiagnosticsExportRedactionError`, surfaced by `useDiagnosticsExport`
 * as `state.status === "error"`) is shown as a visible failure, not a
 * silent no-op or a console warning.
 */
function DiagnosticsExportControl({
  sections,
  appVersion,
  clientId,
  testId,
}: {
  sections: DiagnosticsSection[];
  appVersion: string;
  clientId: string;
  testId?: string;
}) {
  const { state, exportNow } = useDiagnosticsExport({
    sections,
    meta: { appVersion, clientId },
  });
  const statusTestId = testId ? `${testId}-status` : undefined;

  return (
    <div className="pc-diagnostics-export" data-testid={testId}>
      <Button
        kind="secondary"
        onClick={exportNow}
        data-testid={testId ? `${testId}-button` : undefined}
      >
        Export diagnostics (.json)
      </Button>
      <p className="pc-diagnostics-export__hint">
        A redacted bundle of everything below — passwords, keys, and tokens in the connection
        endpoint are stripped before the file is saved.
      </p>
      {state.status === "success" ? (
        <StatusIndicator
          label="Export"
          tone="success"
          statusText="Downloaded"
          testId={statusTestId}
        />
      ) : null}
      {state.status === "error" ? (
        <StatusIndicator
          label="Export"
          tone="danger"
          statusText={`Export failed — ${state.error}`}
          testId={statusTestId}
        />
      ) : null}
    </div>
  );
}

export function DiagnosticsScreen({ appVersion, clientId, testId }: DiagnosticsScreenProps) {
  const sections = useDiagnosticsSnapshot(appVersion, clientId);
  const exportTestId = testId ? `${testId}-export` : undefined;

  return (
    <div className="pc-diagnostics" data-testid={testId}>
      <h2>Diagnostics</h2>
      <p className="pc-diagnostics__intro">
        Versions, capabilities, and connection path — every field below reflects this connection's
        real state, including while no daemon is reachable.
      </p>
      <DiagnosticsExportControl
        sections={sections}
        appVersion={appVersion}
        clientId={clientId}
        testId={exportTestId}
      />
      {sections.map((section) => (
        <DiagnosticsSectionView key={section.id} section={section} testId={testId} />
      ))}
    </div>
  );
}

export default DiagnosticsScreen;
