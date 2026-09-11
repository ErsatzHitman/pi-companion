import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";

import { THEME_PREFERENCE_STORAGE_KEY } from "../../styles/theme-preference.js";
import { ThemePreferenceControl } from "./ThemePreferenceControl.js";

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  document.documentElement.removeAttribute("data-theme");
  document.documentElement.removeAttribute("data-contrast");
});

describe("ThemePreferenceControl", () => {
  it("offers System (the default) / Light / Dark", () => {
    render(<ThemePreferenceControl />);
    const select = screen.getByTestId("theme-preference") as HTMLSelectElement;

    expect(select.value).toBe("system");
    expect([...select.options].map((option) => option.textContent)).toEqual([
      "System",
      "Light",
      "Dark",
    ]);
    expect(screen.getByText(/follows your OS setting/i)).toBeTruthy();
  });

  it("persists an explicit choice and applies it to the document", async () => {
    const user = userEvent.setup();
    render(<ThemePreferenceControl />);

    await user.selectOptions(screen.getByTestId("theme-preference"), "dark");

    expect(window.localStorage.getItem(THEME_PREFERENCE_STORAGE_KEY)).toBe("dark");
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
  });

  it("starts from the persisted preference rather than always defaulting to System", () => {
    window.localStorage.setItem(THEME_PREFERENCE_STORAGE_KEY, "light");
    render(<ThemePreferenceControl />);
    expect((screen.getByTestId("theme-preference") as HTMLSelectElement).value).toBe("light");
  });

  it("resolves back through the OS query when System is chosen again", async () => {
    const user = userEvent.setup();
    window.localStorage.setItem(THEME_PREFERENCE_STORAGE_KEY, "dark");
    render(<ThemePreferenceControl />);

    await user.selectOptions(screen.getByTestId("theme-preference"), "system");

    expect(window.localStorage.getItem(THEME_PREFERENCE_STORAGE_KEY)).toBe("system");
    // jsdom has no matchMedia, so System resolves to light here; the
    // point is that the stored "dark" no longer pins the attribute.
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
  });
});
