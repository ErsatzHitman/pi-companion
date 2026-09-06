import { describe, expect, it } from "vitest";

import {
  EXPO_ROUTER_CTX_IGNORE,
  regexTextEquals,
  tryRequireRealCtxIgnore,
} from "./expo-router-ctx-ignore";

/**
 * T136 coverage for the vendored regex and its two support functions.
 * Neither this file nor `./expo-router-ctx-ignore.ts` imports
 * `react-native` or `expo-router` itself, so this is a real behavioural
 * unit test, not a source-text assertion.
 */
describe("EXPO_ROUTER_CTX_IGNORE (vendored)", () => {
  it("matches ordinary route files", () => {
    for (const path of [
      "./index.tsx",
      "./_layout.tsx",
      "./connect.tsx",
      "./+not-found.tsx",
      "./dev/component-lab.tsx",
      "./h/[serverId]/(tabs)/sessions.tsx",
      "./h/[serverId]/session/[agentId]/index.tsx",
    ]) {
      expect(EXPO_ROUTER_CTX_IGNORE.test(path), path).toBe(true);
    }
  });

  it("matches .test.ts/.spec.ts files too (filtered out separately by the caller, not by this regex)", () => {
    expect(EXPO_ROUTER_CTX_IGNORE.test("./router-root.test.ts")).toBe(true);
    expect(EXPO_ROUTER_CTX_IGNORE.test("./foo.spec.tsx")).toBe(true);
  });

  it("excludes the three Expo Router special-file conventions", () => {
    for (const path of [
      "./foo+api.ts",
      "./[id]+api.tsx",
      "./+html.tsx",
      "./+native-intent.ts",
      "./nested/bar+api.js",
    ]) {
      expect(EXPO_ROUTER_CTX_IGNORE.test(path), path).toBe(false);
    }
  });
});

describe("regexTextEquals", () => {
  it("is true for two regexes with identical source and flags, even as distinct objects", () => {
    const a = /^\.\/foo\.tsx$/;
    const b = new RegExp(a.source, a.flags);
    expect(a).not.toBe(b);
    expect(regexTextEquals(a, b)).toBe(true);
  });

  it("is false when source text differs (proves this is not a vacuous true-returning stub)", () => {
    expect(regexTextEquals(/^\.\/foo\.tsx$/, /^\.\/bar\.tsx$/)).toBe(false);
  });

  it("is false when flags differ", () => {
    expect(regexTextEquals(/foo/, /foo/i)).toBe(false);
  });
});

describe("tryRequireRealCtxIgnore", () => {
  it("returns null (never throws) when requireFn throws MODULE_NOT_FOUND — the branch this environment actually takes", () => {
    const requireFn = () => {
      throw Object.assign(new Error("Cannot find module 'expo-router/_ctx-shared'"), {
        code: "MODULE_NOT_FOUND",
      });
    };
    expect(tryRequireRealCtxIgnore(requireFn)).toBeNull();
  });

  it("extracts and returns EXPO_ROUTER_CTX_IGNORE when requireFn succeeds — proving the 'package present' branch is live, not dead code", () => {
    const fakeReal = /^\.\/fake-real-regex$/;
    const requireFn = () => ({ EXPO_ROUTER_CTX_IGNORE: fakeReal });
    const result = tryRequireRealCtxIgnore(requireFn);
    expect(result).toBe(fakeReal);
    // And the value that comes back is exactly what a real parity check
    // would then feed into regexTextEquals — demonstrated end to end:
    expect(regexTextEquals(result as RegExp, fakeReal)).toBe(true);
    expect(regexTextEquals(result as RegExp, /^\.\/something-else$/)).toBe(false);
  });

  it("returns null when the resolved module has no EXPO_ROUTER_CTX_IGNORE export", () => {
    const requireFn = () => ({ somethingElse: true });
    expect(tryRequireRealCtxIgnore(requireFn)).toBeNull();
  });

  it("returns null when the resolved export is not actually a RegExp", () => {
    const requireFn = () => ({ EXPO_ROUTER_CTX_IGNORE: "not-a-regex" });
    expect(tryRequireRealCtxIgnore(requireFn)).toBeNull();
  });
});
