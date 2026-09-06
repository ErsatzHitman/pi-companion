/**
 * T37F (plan.md §14.4) — structural proof of the exit gate's second
 * checkbox, "the suite is reproducible across runs, with no flow order
 * dependence". `apps/android/maestro/README.md`'s "Flow independence"
 * rule is that every flow's FIRST `launchApp` step sets `clearState:
 * true`, resetting onboarding/paired-host/cached-session state before the
 * flow's first real command — so no flow can depend on residue an
 * earlier flow (or an earlier run of itself) left behind, whatever order
 * a shard runs them in.
 *
 * This module checks that claim against the real `.yaml` text rather than
 * trusting the doc comment each flow file already carries — every one of
 * those doc comments mentions `clearState`/`launchApp` in prose too
 * (e.g. background-kill-restore.yaml's "on the FIRST `launchApp` only"),
 * so a check that just searched for the substring `clearState: true`
 * anywhere in the file would pass even if the real first step didn't set
 * it. `findFirstLaunchApp` instead matches only a real top-level YAML
 * step — `^- launchApp:` at column 0 — never a commented-out or prose
 * mention, since every comment line in these files starts with `#`.
 */
const LAUNCH_APP_STEP = /^- launchApp:\s*$/;
const CLEAR_STATE_TRUE = /^\s+clearState:\s*true\s*$/;

export interface FlowIndependenceResult {
  /** False if the flow has no `- launchApp:` step at all. */
  hasLaunchApp: boolean;
  /** False if the first `- launchApp:` step's next line isn't `clearState: true`. */
  firstLaunchAppClearsState: boolean;
}

/**
 * Finds the FIRST top-level `- launchApp:` step in a flow's raw yaml text
 * and reports whether the line immediately after it sets `clearState:
 * true`. A flow may contain a later, second `launchApp` (e.g.
 * background-kill-restore.yaml's kill-then-relaunch step) that
 * legitimately does NOT clear state — only the first one, which begins
 * the flow, is checked here.
 */
export function checkFlowIndependence(yamlText: string): FlowIndependenceResult {
  const lines = yamlText.split(/\r?\n/);
  const launchAppIndex = lines.findIndex((line) => LAUNCH_APP_STEP.test(line));
  if (launchAppIndex === -1) {
    return { hasLaunchApp: false, firstLaunchAppClearsState: false };
  }
  const nextLine = lines[launchAppIndex + 1] ?? "";
  return { hasLaunchApp: true, firstLaunchAppClearsState: CLEAR_STATE_TRUE.test(nextLine) };
}
