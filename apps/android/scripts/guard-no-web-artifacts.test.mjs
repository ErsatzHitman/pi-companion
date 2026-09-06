import { describe, expect, it } from "vitest";

import { findWebFileViolations, findWebImportViolations } from "./guard-no-web-artifacts.mjs";

describe("findWebFileViolations", () => {
  it("finds no violations in a clean apps/android-shaped path list", () => {
    const paths = ["app/_layout.tsx", "app/index.tsx", "src/features/connect/connection-shell.tsx"];
    expect(findWebFileViolations(paths)).toEqual([]);
  });

  it("fails on a seeded `.web.*` file", () => {
    const paths = ["app/_layout.tsx", "src/features/connect/connection-shell.web.tsx"];
    expect(findWebFileViolations(paths)).toEqual(["src/features/connect/connection-shell.web.tsx"]);
  });

  it("rejects `.web.*` regardless of extension", () => {
    const paths = ["src/ui/button.web.ts", "src/ui/button.web.js", "src/ui/button.tsx"];
    expect(findWebFileViolations(paths)).toEqual(["src/ui/button.web.ts", "src/ui/button.web.js"]);
  });
});

describe("findWebImportViolations", () => {
  it("finds no violations in clean React Native source", () => {
    const files = [
      { path: "app/_layout.tsx", contents: 'import { Stack } from "expo-router";' },
      {
        path: "src/features/connect/connection-shell.tsx",
        contents: 'import { View } from "react-native";',
      },
    ];
    expect(findWebImportViolations(files)).toEqual([]);
  });

  it("fails on a seeded `react-native-web` import", () => {
    const files = [
      { path: "src/ui/button.tsx", contents: 'import { View } from "react-native-web";' },
    ];
    expect(findWebImportViolations(files)).toEqual([
      { path: "src/ui/button.tsx", reason: 'imports "react-native-web"' },
    ]);
  });

  it("fails on a seeded `react-dom` require", () => {
    const files = [
      { path: "src/app/bootstrap.ts", contents: 'const ReactDOM = require("react-dom/client");' },
    ];
    expect(findWebImportViolations(files)).toEqual([
      { path: "src/app/bootstrap.ts", reason: 'imports "react-dom"' },
    ]);
  });
});
