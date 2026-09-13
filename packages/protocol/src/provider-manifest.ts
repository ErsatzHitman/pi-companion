import { z } from "zod";
import type { AgentMode } from "./agent-types.js";

export type AgentModeColorTier = "safe" | "moderate" | "dangerous" | "planning" | `#${string}`;
// Open string by design: the client looks icons up in a registry and falls back
// to a default for unknown values. Daemon downgrades unknown icons for clients
// that pre-date the open-string contract (see CLIENT_CAPS.customModeIcons).
export type AgentModeIcon = string;

export interface AgentModeVisuals {
  icon: AgentModeIcon;
  colorTier: AgentModeColorTier;
}

export type AgentProviderModeDefinition = Omit<AgentMode, "icon" | "colorTier"> &
  AgentModeVisuals & {
    // Marks the provider's most-permissioned no-prompt mode. Selecting it means tools run without approval; the runtime mechanism is provider-specific.
    isUnattended?: boolean;
  };

// `modes` here is static UI metadata, never the runtime source of truth.
// Providers report their own modes at runtime via `fetchCatalog` (see
// `ProviderDefinition.fetchCatalog` in
// `packages/server/src/server/agent/provider-registry.ts`), surfaced through
// the snapshot (`ProviderSnapshotManager.listModes` in
// `provider-snapshot-manager.ts`) and the `list_provider_modes` /
// `get_providers_snapshot` response paths (`ListProviderModesResponseMessageSchema`
// and `GetProvidersSnapshotResponseMessageSchema` in
// `packages/protocol/src/messages.ts`). The runtime list is the source of
// truth; this file enriches it with UI metadata (icons, colorTier) on top via
// `enrichModesWithUiMetadata` (which `provider-registry.ts`'s catalog merge
// calls), falling back to `getModeVisuals` per mode. A definition's own
// `modes` array is only the fallback visuals (and `defaultModeId` / `isUnattended`)
// used when the runtime reports nothing yet.
export interface AgentProviderDefinition {
  id: string;
  label: string;
  description: string;
  enabledByDefault?: boolean;
  defaultModeId: string | null;
  modes: AgentProviderModeDefinition[];
  voice?: {
    enabled: boolean;
    defaultModeId: string;
    defaultModel?: string;
  };
}

export const AGENT_PROVIDER_DEFINITIONS: AgentProviderDefinition[] = [
  {
    id: "pi",
    label: "Pi",
    description: "Minimal terminal-based coding agent with multi-provider LLM support",
    defaultModeId: null,
    modes: [],
  },
];

export const DEV_AGENT_PROVIDER_DEFINITIONS: AgentProviderDefinition[] = [];

export function getAgentProviderDefinition(
  provider: string,
  definitions: AgentProviderDefinition[] = [
    ...AGENT_PROVIDER_DEFINITIONS,
    ...DEV_AGENT_PROVIDER_DEFINITIONS,
  ],
): AgentProviderDefinition {
  const definition = definitions.find((entry) => entry.id === provider);
  if (!definition) {
    throw new Error(`Unknown agent provider: ${provider}`);
  }
  return definition;
}

export const BUILTIN_PROVIDER_IDS = AGENT_PROVIDER_DEFINITIONS.map((d) => d.id);
export const AGENT_PROVIDER_IDS = BUILTIN_PROVIDER_IDS;

export const AgentProviderSchema = z.string();

export function isValidAgentProvider(
  value: string,
  validIds: Iterable<string> = BUILTIN_PROVIDER_IDS,
): boolean {
  return Array.isArray(validIds) ? validIds.includes(value) : new Set(validIds).has(value);
}

export function getUnattendedModeId(
  provider: string,
  definitions: AgentProviderDefinition[] = [
    ...AGENT_PROVIDER_DEFINITIONS,
    ...DEV_AGENT_PROVIDER_DEFINITIONS,
  ],
): string | undefined {
  const definition = definitions.find((entry) => entry.id === provider);
  return definition?.modes.find((mode) => mode.isUnattended)?.id;
}

export function getModeVisuals(
  provider: string,
  modeId: string,
  definitions: AgentProviderDefinition[],
): AgentModeVisuals | undefined {
  const definition = definitions.find((entry) => entry.id === provider);
  const mode = definition?.modes.find((m) => m.id === modeId);
  if (!mode) return undefined;
  return { icon: mode.icon, colorTier: mode.colorTier };
}

/**
 * Enriches runtime-reported modes with static UI metadata on top.
 * `runtimeModes` (from `fetchCatalog`) is the source of truth and is never
 * reordered or filtered here; only a missing `icon`/`colorTier` is filled
 * from the provider's static definition via `getModeVisuals`. A mode the
 * runtime reports that the definition does not know passes through untouched,
 * and a mode already carrying both fields is returned as-is.
 */
export function enrichModesWithUiMetadata(
  provider: string,
  runtimeModes: AgentMode[],
  definitions: AgentProviderDefinition[] = [
    ...AGENT_PROVIDER_DEFINITIONS,
    ...DEV_AGENT_PROVIDER_DEFINITIONS,
  ],
): AgentMode[] {
  return runtimeModes.map((mode) => {
    if (mode.icon && mode.colorTier) return mode;
    const visuals = getModeVisuals(provider, mode.id, definitions);
    if (!visuals) return mode;
    return {
      ...mode,
      icon: mode.icon ?? visuals.icon,
      colorTier: mode.colorTier ?? visuals.colorTier,
    };
  });
}
