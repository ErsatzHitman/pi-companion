/**
 * T37D — resolves a flow name (what a T37E* task types on the command
 * line, e.g. `smoke`) to the `.yaml` file it names inside
 * `apps/android/maestro/`. plan.md §6 places flow files directly in that
 * directory (siblings of this harness's `README.md`), one file per T37E*
 * scenario; this module is the one place that turns a bare name into a
 * path so `run-flow.ts` and every future flow author agree on the same
 * naming rule.
 *
 * Takes `maestroDir` as a parameter (defaulting to the real
 * `apps/android/maestro/` directory) so `flow-registry.test.ts` can point
 * it at a throwaway fixture directory instead of depending on which
 * flows happen to exist in the real tree.
 */
import { readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REAL_MAESTRO_DIR = fileURLToPath(new URL("../../maestro/", import.meta.url));
const FLOW_EXTENSION = ".yaml";
// A future `config.yaml` (Maestro workspace-level config, not a flow) must
// never be offered back as a runnable flow name.
const RESERVED_NAMES = new Set(["config"]);
const FLOW_NAME_PATTERN = /^[a-z][a-z0-9-]*$/;

export interface FlowRegistry {
  listFlowNames(): string[];
  resolveFlowPath(name: string): string;
}

export function createFlowRegistry(maestroDir: string = REAL_MAESTRO_DIR): FlowRegistry {
  function listFlowNames(): string[] {
    let entries: string[];
    try {
      entries = readdirSync(maestroDir);
    } catch {
      return [];
    }
    return entries
      .filter((entry) => entry.endsWith(FLOW_EXTENSION))
      .map((entry) => entry.slice(0, -FLOW_EXTENSION.length))
      .filter((name) => !RESERVED_NAMES.has(name))
      .sort();
  }

  function resolveFlowPath(name: string): string {
    if (!FLOW_NAME_PATTERN.test(name)) {
      throw new Error(
        `Invalid flow name "${name}" — expected lowercase-kebab-case (e.g. "smoke"), matching a ${FLOW_EXTENSION} file in ${maestroDir}`,
      );
    }
    const names = listFlowNames();
    if (!names.includes(name)) {
      const available = names.length > 0 ? names.join(", ") : "(none)";
      throw new Error(`No flow named "${name}" in ${maestroDir}. Available flows: ${available}`);
    }
    return path.join(maestroDir, `${name}${FLOW_EXTENSION}`);
  }

  return { listFlowNames, resolveFlowPath };
}
