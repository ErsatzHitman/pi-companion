import { describe, expect, it } from "vitest";

import { MAX_EXPLICIT_AGENT_TITLE_CHARS, validateSessionName } from "./validate-session-name.js";

describe("validateSessionName (T38A4)", () => {
  it("accepts a normal name and trims surrounding whitespace", () => {
    const result = validateSessionName("  Refactor router  ");
    expect(result).toEqual({ ok: true, name: "Refactor router" });
  });

  it("rejects an empty string", () => {
    const result = validateSessionName("");
    expect(result).toEqual({ ok: false, error: "Enter a name for this session." });
  });

  it("rejects a whitespace-only string as empty, not as invalid content", () => {
    const result = validateSessionName("   \t  ");
    expect(result).toEqual({ ok: false, error: "Enter a name for this session." });
  });

  it("accepts a name exactly at the cap (boundary: at the cap passes)", () => {
    const name = "x".repeat(MAX_EXPLICIT_AGENT_TITLE_CHARS);
    const result = validateSessionName(name);
    expect(result).toEqual({ ok: true, name });
  });

  it("rejects a name exactly one character over the cap (boundary: one over fails)", () => {
    const name = "x".repeat(MAX_EXPLICIT_AGENT_TITLE_CHARS + 1);
    const result = validateSessionName(name);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe(
        `Names can be at most ${MAX_EXPLICIT_AGENT_TITLE_CHARS} characters (this one is ${MAX_EXPLICIT_AGENT_TITLE_CHARS + 1}).`,
      );
    }
  });

  it("trims before measuring the cap, so surrounding whitespace never pushes a name over it", () => {
    const inner = "x".repeat(MAX_EXPLICIT_AGENT_TITLE_CHARS);
    const result = validateSessionName(`  ${inner}  `);
    expect(result).toEqual({ ok: true, name: inner });
  });

  it("allows any Unicode content within the cap — no character-set restriction beyond length", () => {
    const result = validateSessionName("🚀 プロジェクト — refactor/router (v2)");
    expect(result.ok).toBe(true);
  });

  it("MAX_EXPLICIT_AGENT_TITLE_CHARS matches the real daemon-enforced constant, not a re-guessed number", () => {
    // Verified against `AgentSessionConfigSchema.title`
    // (`@picompanion/protocol`'s `messages.ts`): both import the same
    // `agent-title-limits.ts` constant, so this can only drift if the
    // protocol package itself changes it — never silently here.
    expect(MAX_EXPLICIT_AGENT_TITLE_CHARS).toBe(200);
  });
});
