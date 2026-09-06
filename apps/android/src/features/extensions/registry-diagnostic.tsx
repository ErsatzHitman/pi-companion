/**
 * One visible diagnostic (plan.md §11.2 "Unknown input becomes a visible
 * diagnostic with source and safe raw details", applied to the registry's
 * §11.4 "unknown-kind fallback"; T34A1).
 *
 * `registry-view.tsx` renders exactly one of these per problem element
 * (never one per malformed field, never raw JSON dropped straight into the
 * transcript/rail) — a `Banner`, a `source: ns:id (kind)` line, and the
 * safe, size-bounded raw element behind an explicit `Popover` disclosure.
 * Same content contract as the web counterpart's `ExtensionDiagnostic`
 * (`apps/web/src/features/extensions/registry-view.tsx`), rebuilt as
 * native primitives rather than shared markup (plan.md §18.3).
 */
import { useMemo } from "react";
import { StyleSheet, Text, View } from "react-native";

import type { PiUiElement } from "@picompanion/protocol/pi-ui-bridge/schema";

import { Banner, CodeBlock, Popover } from "../../ui/primitives";
import { useTheme } from "../../ui/theme/theme-context";
import type { RegistryDiagnostic } from "./registry-plan";

/** A safe, size-bounded preview of an element's raw wire shape for diagnostics. */
export function safeRawPreview(element: PiUiElement, limit = 2000): string {
  try {
    const json = JSON.stringify(element, null, 2) ?? String(element);
    return json.length > limit ? `${json.slice(0, limit)}\n… (truncated)` : json;
  } catch {
    return "(raw element could not be serialized)";
  }
}

export interface ExtensionDiagnosticProps {
  diagnostic: RegistryDiagnostic;
  element: PiUiElement;
  testId?: string;
}

export function ExtensionDiagnostic({ diagnostic, element, testId }: ExtensionDiagnosticProps) {
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);

  return (
    <View style={styles.wrapper} testID={testId}>
      <Banner tone="warning" message={`${diagnostic.title} — ${diagnostic.message}`} />
      <Text style={styles.source}>
        source: {element.ns}:{element.id} ({element.kind})
      </Text>
      <Popover triggerLabel="Show raw details">
        <CodeBlock code={safeRawPreview(element)} language="json" />
      </Popover>
    </View>
  );
}

function createStyles(theme: ReturnType<typeof useTheme>["theme"]) {
  return StyleSheet.create({
    wrapper: { gap: theme.spacing[2] },
    source: { color: theme.colors["ink-3"], fontSize: theme.typography.variant.caption.fontSize },
  });
}
