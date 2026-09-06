import { useState } from "react";
import { testing } from "@picompanion/frontend-core";
import { ScrollView, StyleSheet, Text, View } from "react-native";

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
  Toggle,
} from "../ui/primitives/index";
import { useTheme } from "../ui/theme/theme-context";

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
 * T26A dev-only component lab (plan.md §10.3): renders every primitive
 * from the shared `@picompanion/frontend-core/testing` fixtures — one
 * `<Section title="...">` per entry in `testing.primitiveLabManifest`, so
 * `apps/android` exercises the exact same cases as `apps/web`'s T25A lab.
 * Only ever reached through `app/dev/component-lab.tsx`'s `__DEV__`
 * branch — see that file for why this never ships in a production
 * bundle.
 */
export function ComponentLab() {
  const { theme } = useTheme();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [selected, setSelected] = useState<Record<string, string>>(() =>
    Object.fromEntries(selectLabCases.map((selectCase) => [selectCase.id, selectCase.value])),
  );
  const [toggles, setToggles] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(toggleLabCases.map((toggleCase) => [toggleCase.id, toggleCase.checked])),
  );

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
          Component lab
        </Text>
        <Text
          style={{
            color: theme.colors["ink-2"],
            fontSize: theme.typography.variant.body.fontSize,
          }}
        >
          Dev-only: renders every §10.3 primitive from shared fixtures.
        </Text>
      </View>

      <Section title="Button">
        <View style={styles.row}>
          {buttonLabCases.map((buttonCase) => (
            <Button
              key={buttonCase.id}
              kind={buttonCase.kind}
              label={buttonCase.label}
              disabled={buttonCase.disabled}
              onPress={() => {}}
            />
          ))}
        </View>
      </Section>

      <Section title="IconButton">
        <View style={styles.row}>
          {iconButtonLabCases.map((iconButtonCase) => (
            <IconButton
              key={iconButtonCase.id}
              icon={iconButtonCase.icon}
              accessibleName={iconButtonCase.accessibleName}
              onPress={() => {}}
            />
          ))}
        </View>
      </Section>

      <Section title="Link">
        <View style={styles.row}>
          {linkLabCases.map((linkCase) => (
            <Link
              key={linkCase.id}
              label={linkCase.label}
              external={linkCase.external}
              onPress={() => {}}
            />
          ))}
        </View>
      </Section>

      <Section title="TextField">
        <View style={styles.column}>
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
        </View>
      </Section>

      <Section title="TextArea">
        <TextArea
          label={textAreaLabCase.label}
          placeholder={textAreaLabCase.placeholder}
          testId="text-area-prompt"
        />
      </Section>

      <Section title="Select">
        <View style={styles.column}>
          {selectLabCases.map((selectCase) => (
            <Select
              key={selectCase.id}
              label={selectCase.label}
              options={selectCase.options}
              value={selected[selectCase.id] ?? selectCase.value}
              onValueChange={(value) =>
                setSelected((current) => ({ ...current, [selectCase.id]: value }))
              }
              testId={`select-${selectCase.id}`}
            />
          ))}
        </View>
      </Section>

      <Section title="Toggle">
        <View style={styles.column}>
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
        </View>
      </Section>

      <Section title="Card">
        <Card>
          <Text style={{ color: theme.colors.ink }}>A card is a raised surface container.</Text>
        </Card>
      </Section>

      <Section title="Section">
        <Section title="Nested example">
          <Text style={{ color: theme.colors.ink }}>
            Section groups related controls behind a labelled heading.
          </Text>
        </Section>
      </Section>

      <Section title="Divider">
        <Text style={{ color: theme.colors.ink }}>Above the divider.</Text>
        <Divider />
        <Text style={{ color: theme.colors.ink }}>Below the divider.</Text>
      </Section>

      <Section title="Chip">
        <View style={styles.row}>
          {chipLabCases.map((chipCase) => (
            <Chip
              key={chipCase.id}
              label={chipCase.label}
              tone={chipCase.tone}
              onRemove={chipCase.removable ? () => {} : undefined}
              testId={`chip-${chipCase.id}`}
            />
          ))}
        </View>
      </Section>

      <Section title="ChipGroup">
        <ChipGroup accessibleName="Permissions">
          {chipLabCases.map((chipCase) => (
            <Chip key={chipCase.id} label={chipCase.label} tone={chipCase.tone} />
          ))}
        </ChipGroup>
      </Section>

      <Section title="StatusIndicator">
        <View style={styles.column}>
          {statusIndicatorLabCases.map((statusCase) => (
            <StatusIndicator
              key={statusCase.id}
              label={statusCase.label}
              tone={statusCase.tone}
              statusText={statusCase.statusText}
              testId={`status-${statusCase.id}`}
            />
          ))}
        </View>
      </Section>

      <Section title="Progress">
        <View style={styles.column}>
          {progressLabCases.map((progressCase) => (
            <Progress
              key={progressCase.id}
              label={progressCase.label}
              value={progressCase.value}
              testId={`progress-${progressCase.id}`}
            />
          ))}
        </View>
      </Section>

      <Section title="SearchField">
        <View style={styles.column}>
          {searchFieldLabCases.map((searchCase) => (
            <SearchField
              key={searchCase.id}
              label={searchCase.label}
              placeholder={searchCase.placeholder}
              defaultValue={searchCase.value}
              testId={`search-field-${searchCase.id}`}
            />
          ))}
        </View>
      </Section>

      <Section title="RecordList">
        <RecordList
          accessibleName="Sessions"
          columns={recordListLabCase.columns}
          rows={recordListLabCase.rows}
          testId="record-list-sessions"
        />
      </Section>

      <Section title="CodeBlock">
        <View style={styles.column}>
          {codeBlockLabCases.map((codeCase) => (
            <CodeBlock key={codeCase.id} code={codeCase.code} language={codeCase.language} />
          ))}
        </View>
      </Section>

      <Section title="EmptyState">
        <EmptyState title={emptyStateLabCase.title} description={emptyStateLabCase.description} />
      </Section>

      <Section title="ErrorState">
        <ErrorState title={errorStateLabCase.title} description={errorStateLabCase.description} />
      </Section>

      <Section title="LoadingState">
        <LoadingState
          title={loadingStateLabCase.title}
          description={loadingStateLabCase.description}
        />
      </Section>

      <Section title="Sheet">
        <Button label="Open sheet" onPress={() => setSheetOpen(true)} />
        <Sheet
          open={sheetOpen}
          title={sheetLabCase.title}
          description={sheetLabCase.description}
          onClose={() => setSheetOpen(false)}
          testId="sheet-session-actions"
        />
      </Section>

      <Section title="Dialog">
        <Button label="Open dialog" onPress={() => setDialogOpen(true)} />
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

      <Section title="Popover">
        <Popover triggerLabel={popoverLabCase.triggerLabel} testId="popover-model-info">
          <Text style={{ color: theme.colors.ink }}>{popoverLabCase.content}</Text>
        </Popover>
      </Section>

      <Section title="Toast">
        <View style={{ gap: theme.spacing[2] }}>
          {toastLabCases.map((toastCase) => (
            <Toast
              key={toastCase.id}
              tone={toastCase.tone}
              message={toastCase.message}
              testId={`toast-${toastCase.id}`}
            />
          ))}
        </View>
      </Section>

      <Section title="Banner">
        <View style={styles.column}>
          {bannerLabCases.map((bannerCase) => (
            <Banner
              key={bannerCase.id}
              tone={bannerCase.tone}
              message={bannerCase.message}
              actionLabel={bannerCase.actionLabel}
              onAction={bannerCase.actionLabel ? () => {} : undefined}
              testId={`banner-${bannerCase.id}`}
            />
          ))}
        </View>
      </Section>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
  column: { gap: 12 },
});

export default ComponentLab;
