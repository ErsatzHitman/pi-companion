import { describe, expect, it } from "vitest";

import {
  DEFAULT_SESSION_PROVIDER,
  validateCreateSessionForm,
} from "./validate-create-session-form.js";

describe("validateCreateSessionForm (T27B2)", () => {
  it("accepts a well-formed draft", () => {
    const result = validateCreateSessionForm({
      provider: DEFAULT_SESSION_PROVIDER,
      cwd: "/repo/demo",
    });
    expect(result).toEqual({ ok: true, draft: { provider: "pi", cwd: "/repo/demo" } });
  });

  it("rejects an empty working directory", () => {
    const result = validateCreateSessionForm({ provider: "pi", cwd: "   " });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected a validation failure");
    expect(result.errors.cwd).toMatch(/enter a working directory/i);
  });

  it("rejects an empty provider", () => {
    const result = validateCreateSessionForm({ provider: "  ", cwd: "/repo/demo" });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected a validation failure");
    expect(result.errors.provider).toMatch(/choose a provider/i);
  });

  it("trims surrounding whitespace from the accepted draft", () => {
    const result = validateCreateSessionForm({ provider: " pi ", cwd: "  /repo/demo  " });
    expect(result).toEqual({ ok: true, draft: { provider: "pi", cwd: "/repo/demo" } });
  });
});
