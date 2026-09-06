import { useState } from "react";
import { testing } from "@picompanion/frontend-core";
import { ScrollView, Text, View } from "react-native";

import {
  ApprovalForm,
  CodeListing,
  CommandSearch,
  DiffSummary,
  PromptBar,
  Section,
  SelectionActions,
  StreamingMessage,
  TaskRows,
  ThinkingSection,
  ToolChips,
  WorkflowSteps,
} from "../ui/index";
import { useTheme } from "../ui/theme/theme-context";

const {
  approvalFormDangerousLabCase,
  approvalFormLabCase,
  codeListingLabCase,
  commandSearchLabCase,
  diffSummaryLabCases,
  promptBarQueuedLabCase,
  selectionActionsLabCase,
  streamingMessageLabCases,
  taskRowLabCases,
  thinkingSectionLabCases,
  toolChipLabCases,
  workflowStepsLabCases,
} = testing;

/**
 * T26B dev-only recipe lab (plan.md §10.4): renders every §10.4 product
 * recipe from the shared `@picompanion/frontend-core/testing` fixtures —
 * one `<Section title="...">` per entry in `testing.recipeLabManifest`,
 * so `apps/android` exercises the exact same cases as `apps/web`'s T25B
 * recipe lab. Only ever reached through `app/dev/recipe-lab.tsx`'s
 * `__DEV__` branch — see that file for why this never ships in a
 * production bundle.
 */
export function RecipeLab() {
  const { theme } = useTheme();
  const [promptValue, setPromptValue] = useState(promptBarQueuedLabCase.value);

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: theme.colors.page }}
      contentContainerStyle={{ padding: theme.spacing[5], gap: theme.spacing[6] }}
    >
      <View>
        <Text
          style={{
            color: theme.colors.ink,
            fontSize: theme.typography.variant.display.fontSize,
          }}
        >
          Recipe lab
        </Text>
        <Text
          style={{
            color: theme.colors["ink-2"],
            fontSize: theme.typography.variant.body.fontSize,
          }}
        >
          Dev-only: renders every §10.4 product recipe from shared fixtures.
        </Text>
      </View>

      <Section title="ThinkingSection">
        <View style={{ gap: theme.spacing[3] }}>
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
        </View>
      </Section>

      <Section title="StreamingMessage">
        <View style={{ gap: theme.spacing[3] }}>
          {streamingMessageLabCases.map((messageCase) => (
            <StreamingMessage
              key={messageCase.id}
              speaker={messageCase.speaker}
              text={messageCase.text}
              streaming={messageCase.streaming}
              testId={`streaming-${messageCase.id}`}
            />
          ))}
        </View>
      </Section>

      <Section title="ApprovalForm">
        <View style={{ gap: theme.spacing[3] }}>
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
        </View>
      </Section>

      <Section title="ToolChips">
        <ToolChips items={toolChipLabCases} accessibleName="Tool permissions" testId="tool-chips" />
      </Section>

      <Section title="TaskRows">
        <TaskRows items={taskRowLabCases} accessibleName="Tasks" testId="task-rows" />
      </Section>

      <Section title="PromptBar">
        <PromptBar
          label="Message Pi"
          placeholder={promptBarQueuedLabCase.placeholder}
          value={promptValue}
          canSend={promptValue.length > 0}
          queuedCount={promptBarQueuedLabCase.queuedCount}
          onValueChange={setPromptValue}
          onSend={() => {}}
          testId="prompt-bar"
        />
      </Section>

      <Section title="DiffSummary">
        <View style={{ gap: theme.spacing[2] }}>
          {diffSummaryLabCases.map((diffCase) => (
            <DiffSummary
              key={diffCase.id}
              path={diffCase.path}
              added={diffCase.added}
              removed={diffCase.removed}
              modified={diffCase.modified}
              testId={`diff-${diffCase.id}`}
            />
          ))}
        </View>
      </Section>

      <Section title="CommandSearch">
        <CommandSearch
          label="Search commands"
          placeholder={commandSearchLabCase.placeholder}
          items={commandSearchLabCase.items}
          onSelect={() => {}}
          testId="command-search"
        />
      </Section>

      <Section title="WorkflowSteps">
        <WorkflowSteps
          items={workflowStepsLabCases}
          accessibleName="Pairing progress"
          testId="workflow-steps"
        />
      </Section>

      <Section title="CodeListing">
        <CodeListing
          path={codeListingLabCase.path}
          language={codeListingLabCase.language}
          code={codeListingLabCase.code}
          highlightLine={codeListingLabCase.highlightLine}
          testId="code-listing"
        />
      </Section>

      <Section title="SelectionActions">
        <SelectionActions
          selectionSummary={selectionActionsLabCase.selectionSummary}
          actions={selectionActionsLabCase.actions}
          onAction={() => {}}
          testId="selection-actions"
        />
      </Section>
    </ScrollView>
  );
}

export default RecipeLab;
