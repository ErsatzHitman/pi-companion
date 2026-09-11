import { useState } from "react";

import {
  THEME_PREFERENCES,
  THEME_PREFERENCE_LABELS,
  isThemePreference,
  readThemePreference,
  setThemePreference,
} from "../../styles/theme-preference.js";
import type { ThemePreference } from "../../styles/theme-preference.js";
import { Select } from "../../ui/primitives/index.js";

export interface ThemePreferenceControlProps {
  testId?: string;
}

/**
 * The settings screen's Theme control (System / Light / Dark).
 *
 * A native `Select` primitive (`role="combobox"`, full keyboard/AT
 * support) whose value is the persisted preference; changing it persists
 * the choice and applies it immediately as `data-theme` on `<html>` via
 * `styles/theme-preference.ts` — the same module
 * `styles/theme-runtime.ts` bootstraps from, so choosing `System` here
 * hands control back to `prefers-color-scheme` rather than freezing the
 * theme that happened to be resolved at that moment.
 */
export function ThemePreferenceControl({
  testId = "theme-preference",
}: ThemePreferenceControlProps) {
  const [preference, setPreference] = useState<ThemePreference>(() => readThemePreference());

  function handleChange(next: string): void {
    if (!isThemePreference(next)) return;
    setPreference(next);
    setThemePreference(next);
  }

  return (
    <div className="pc-theme-preference">
      <Select
        label="Theme"
        options={THEME_PREFERENCES.map((value) => ({
          value,
          label: THEME_PREFERENCE_LABELS[value],
        }))}
        value={preference}
        onChange={(event) => handleChange(event.target.value)}
        testId={testId}
      />
      <p className="pc-theme-preference__hint">System follows your OS setting.</p>
    </div>
  );
}

export default ThemePreferenceControl;
