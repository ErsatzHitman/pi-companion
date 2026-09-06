import { useState } from "react";
import { testing } from "@picompanion/frontend-core";

import { Section } from "../ui/primitives/index.js";
import {
  ApprovalForm,
  CodeListing,
  CommandSearch,
  DiffSummary,
  PromptBar,
  SelectionActions,
  StreamingMessage,
  TaskRows,
  ThinkingSection,
  ToolChips,
  WorkflowSteps,
} from "../ui/recipes/index.js";

const {
  approvalFormDangerousLabCase,
  approvalFormLabCase,
  codeListingLabCase,
  commandSearchLabCase,
  diffSummaryLabCases,
  promptBarLabCase,
  selectionActionsLabCase,
  streamingMessageLabCases,
  taskRowLabCases,
  thinkingSectionLabCases,
  toolChipLabCases,
  workflowStepsLabCases,
} = testing;

/**
 * T25B dev-only recipe lab (plan.md §10.4): renders every §10.4 product
 * recipe from the shared `@picompanion/frontend-core/testing` fixtures —
 * mirrors `component-lab.tsx`'s "one `<Section>` per manifest entry"
 * shape, from `testing.recipeLabManifest`, so `apps/web` and
 * `apps/android` (T26B) exercise identical cases. Never imported outside
 * `dev/recipe-lab-route.tsx`'s dev-only branch, for the same
 * production-bundle-exclusion reason as the component lab.
 */
export function RecipeLab() {
  const [promptValue, setPromptValue] = useState(promptBarLabCase.value);

  return (
    <div className="component-lab">
      <h2>Recipe lab</h2>
      <p>Dev-only: renders every §10.4 product recipe from shared fixtures.</p>

      <Section title="ThinkingSection" id="lab-thinking-section">
        <div className="component-lab__column">
          {thinkingSectionLabCases.map((thinkingCase) => (
            <ThinkingSection
              key={thinkingCase.id}
              summary={thinkingCase.summary}
              body={thinkingCase.body}
              durationLabel={thinkingCase.durationLabel}
              defaultExpanded={thinkingCase.defaultExpanded}
              testId={`thinking-${thinkingCase.id}`}
            />
          ))}
        </div>
      </Section>

      <Section title="StreamingMessage" id="lab-streaming-message">
        <div className="component-lab__column">
          {streamingMessageLabCases.map((messageCase) => (
            <StreamingMessage
              key={messageCase.id}
              speaker={messageCase.speaker}
              text={messageCase.text}
              streaming={messageCase.streaming}
              testId={`message-${messageCase.id}`}
            />
          ))}
        </div>
      </Section>

      <Section title="ApprovalForm" id="lab-approval-form">
        <div className="component-lab__column">
          <ApprovalForm
            toolLabel={approvalFormLabCase.toolLabel}
            detail={approvalFormLabCase.detail}
            dangerous={approvalFormLabCase.dangerous}
            onApprove={() => {}}
            onDeny={() => {}}
            testId={`approval-${approvalFormLabCase.id}`}
          />
          <ApprovalForm
            toolLabel={approvalFormDangerousLabCase.toolLabel}
            detail={approvalFormDangerousLabCase.detail}
            dangerous={approvalFormDangerousLabCase.dangerous}
            onApprove={() => {}}
            onDeny={() => {}}
            testId={`approval-${approvalFormDangerousLabCase.id}`}
          />
        </div>
      </Section>

      <Section title="ToolChips" id="lab-tool-chips">
        <ToolChips items={toolChipLabCases} ariaLabel="Tool permissions" testId="tool-chips" />
      </Section>

      <Section title="TaskRows" id="lab-task-rows">
        <TaskRows items={taskRowLabCases} ariaLabel="Session tasks" testId="task-rows" />
      </Section>

      <Section title="PromptBar" id="lab-prompt-bar">
        <PromptBar
          label={promptBarLabCase.placeholder}
          placeholder={promptBarLabCase.placeholder}
          value={promptValue}
          canSend={promptValue.trim().length > 0}
          queuedCount={promptBarLabCase.queuedCount}
          onValueChange={setPromptValue}
          onSend={() => setPromptValue("")}
          testId="prompt-bar"
        />
      </Section>

      <Section title="DiffSummary" id="lab-diff-summary">
        <div className="component-lab__column">
          {diffSummaryLabCases.map((diffCase) => (
            <DiffSummary
              key={diffCase.id}
              path={diffCase.path}
              added={diffCase.added}
              removed={diffCase.removed}
              modified={diffCase.modified}
              testId={`diff-summary-${diffCase.id}`}
            />
          ))}
        </div>
      </Section>

      <Section title="CommandSearch" id="lab-command-search">
        <CommandSearch
          label={commandSearchLabCase.placeholder}
          placeholder={commandSearchLabCase.placeholder}
          items={commandSearchLabCase.items}
          onSelect={() => {}}
          testId="command-search"
        />
      </Section>

      <Section title="WorkflowSteps" id="lab-workflow-steps">
        <WorkflowSteps
          items={workflowStepsLabCases}
          ariaLabel="Pairing progress"
          testId="workflow-steps"
        />
      </Section>

      <Section title="CodeListing" id="lab-code-listing">
        <CodeListing
          path={codeListingLabCase.path}
          language={codeListingLabCase.language}
          code={codeListingLabCase.code}
          highlightLine={codeListingLabCase.highlightLine}
          testId="code-listing"
        />
      </Section>

      <Section title="SelectionActions" id="lab-selection-actions">
        <SelectionActions
          selectionSummary={selectionActionsLabCase.selectionSummary}
          actions={selectionActionsLabCase.actions}
          onAction={() => {}}
          testId="selection-actions"
        />
      </Section>
    </div>
  );
}

export default RecipeLab;
