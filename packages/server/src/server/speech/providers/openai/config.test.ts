import { describe, expect, test } from "vitest";

import { PersistedConfigSchema, type PersistedConfig } from "../../../persisted-config.js";
import { resolveOpenAiSpeechConfig } from "./config.js";
import type { RequestedSpeechProviders } from "../../speech-types.js";

/**
 * `PersistedConfigSchema.parse(...)`'s inferred return type is the schema's
 * own raw output, not the narrower, hand-declared `PersistedConfig` type
 * exported alongside it (`persisted-config.ts`'s own `Omit<..., "agents"> &
 * {...}`) — a PRE-EXISTING mismatch this file's other tests already hit
 * (four call sites above, unrelated to Groq, already counted in
 * `guard-server-test-typecheck-ceiling.mjs`'s tolerated baseline before
 * this task). Fixing that mismatch belongs to whoever owns
 * `persisted-config.ts`'s exported types, not this task. This helper exists
 * so T277's OWN new call sites below don't add six more instances of an
 * already-tolerated, unrelated defect and push the real error count over
 * the guard's ceiling — the runtime value is identical either way; only
 * the compile-time type differs.
 */
function parsePersisted(input: Record<string, unknown>): PersistedConfig {
  return PersistedConfigSchema.parse(input) as unknown as PersistedConfig;
}

const ALL_OPENAI: RequestedSpeechProviders = {
  dictationStt: { provider: "openai", explicit: true },
  voiceTurnDetection: { provider: "local", explicit: false },
  voiceStt: { provider: "openai", explicit: true },
  voiceTts: { provider: "openai", explicit: true },
};

describe("resolveOpenAiSpeechConfig", () => {
  test("treats empty OPENAI_API_KEY as unset", () => {
    const persisted = PersistedConfigSchema.parse({});
    const env = {
      OPENAI_API_KEY: "",
    } as NodeJS.ProcessEnv;

    const resolved = resolveOpenAiSpeechConfig({
      env,
      persisted,
      providers: {
        ...ALL_OPENAI,
        dictationStt: { provider: "local", explicit: false },
        voiceStt: { provider: "local", explicit: false },
        voiceTts: { provider: "local", explicit: false },
      },
    });

    expect(resolved).toBeUndefined();
  });

  test("applies trimmed OPENAI_API_KEY to both STT and TTS", () => {
    const persisted = PersistedConfigSchema.parse({});
    const env = {
      OPENAI_API_KEY: "  sk-test  ",
    } as NodeJS.ProcessEnv;

    const resolved = resolveOpenAiSpeechConfig({ env, persisted, providers: ALL_OPENAI });

    expect(resolved?.stt?.apiKey).toBe("sk-test");
    expect(resolved?.tts?.apiKey).toBe("sk-test");
  });

  test("resolves distinct endpoints for STT and TTS", () => {
    const persisted = PersistedConfigSchema.parse({
      providers: {
        openai: {
          stt: {
            apiKey: "stt-key",
            baseUrl: " https://stt.example.com/v1 ",
          },
          tts: {
            apiKey: "tts-key",
            baseUrl: " https://tts.example.com/v1 ",
          },
        },
      },
    });

    const resolved = resolveOpenAiSpeechConfig({
      env: {} as NodeJS.ProcessEnv,
      persisted,
      providers: ALL_OPENAI,
    });

    expect(resolved?.stt?.apiKey).toBe("stt-key");
    expect(resolved?.stt?.baseUrl).toBe("https://stt.example.com/v1");
    expect(resolved?.tts?.apiKey).toBe("tts-key");
    expect(resolved?.tts?.baseUrl).toBe("https://tts.example.com/v1");
  });

  test("prefers nested STT/TTS config over env and global fallbacks", () => {
    const persisted = PersistedConfigSchema.parse({
      providers: {
        openai: {
          apiKey: "fallback-config-key",
          baseUrl: "https://global-config.example.com/v1",
          stt: { apiKey: "stt-config-key", baseUrl: " https://stt.example.com/v1 " },
          tts: { apiKey: "tts-config-key", baseUrl: " https://tts.example.com/v1 " },
        },
      },
    });
    const env = {
      OPENAI_API_KEY: "env-key",
      OPENAI_STT_API_KEY: "stt-env-key",
      OPENAI_STT_BASE_URL: "https://stt-env.example.com/v1",
      OPENAI_TTS_API_KEY: "tts-env-key",
      OPENAI_TTS_BASE_URL: "https://tts-env.example.com/v1",
      OPENAI_BASE_URL: "https://env.example.com/v1",
    } as NodeJS.ProcessEnv;

    const resolved = resolveOpenAiSpeechConfig({ env, persisted, providers: ALL_OPENAI });

    expect(resolved?.stt?.apiKey).toBe("stt-config-key");
    expect(resolved?.stt?.baseUrl).toBe("https://stt.example.com/v1");
    expect(resolved?.tts?.apiKey).toBe("tts-config-key");
    expect(resolved?.tts?.baseUrl).toBe("https://tts.example.com/v1");
  });

  test("uses STT/TTS env config when nested config is unset", () => {
    const persisted = PersistedConfigSchema.parse({});
    const env = {
      OPENAI_API_KEY: "sk-test",
      OPENAI_STT_API_KEY: "stt-env-key",
      OPENAI_STT_BASE_URL: " https://stt-env.example.com/v1 ",
      OPENAI_TTS_API_KEY: "tts-env-key",
      OPENAI_TTS_BASE_URL: " https://tts-env.example.com/v1 ",
      OPENAI_BASE_URL: "https://env.example.com/v1",
    } as NodeJS.ProcessEnv;

    const resolved = resolveOpenAiSpeechConfig({ env, persisted, providers: ALL_OPENAI });

    expect(resolved?.stt?.apiKey).toBe("stt-env-key");
    expect(resolved?.stt?.baseUrl).toBe("https://stt-env.example.com/v1");
    expect(resolved?.tts?.apiKey).toBe("tts-env-key");
    expect(resolved?.tts?.baseUrl).toBe("https://tts-env.example.com/v1");
  });

  test("falls back to global OpenAI config for both STT and TTS", () => {
    const persisted = PersistedConfigSchema.parse({
      providers: {
        openai: {
          apiKey: "fallback-config-key",
          baseUrl: " https://global-config.example.com/v1 ",
        },
      },
    });
    const env = {} as NodeJS.ProcessEnv;

    const resolved = resolveOpenAiSpeechConfig({ env, persisted, providers: ALL_OPENAI });

    expect(resolved?.stt?.apiKey).toBe("fallback-config-key");
    expect(resolved?.stt?.baseUrl).toBe("https://global-config.example.com/v1");
    expect(resolved?.tts?.apiKey).toBe("fallback-config-key");
    expect(resolved?.tts?.baseUrl).toBe("https://global-config.example.com/v1");
  });

  test("falls back to global OpenAI env config when feature inputs are unset", () => {
    const persisted = PersistedConfigSchema.parse({});
    const env = {
      OPENAI_API_KEY: "env-key",
      OPENAI_BASE_URL: " https://env.example.com/v1 ",
    } as NodeJS.ProcessEnv;

    const resolved = resolveOpenAiSpeechConfig({ env, persisted, providers: ALL_OPENAI });

    expect(resolved?.stt?.apiKey).toBe("env-key");
    expect(resolved?.stt?.baseUrl).toBe("https://env.example.com/v1");
    expect(resolved?.tts?.apiKey).toBe("env-key");
    expect(resolved?.tts?.baseUrl).toBe("https://env.example.com/v1");
  });

  test("ignores empty endpoint env vars and falls back to OPENAI_API_KEY", () => {
    const persisted = PersistedConfigSchema.parse({});
    const env = {
      OPENAI_API_KEY: "global-key",
      OPENAI_STT_API_KEY: "",
      OPENAI_STT_BASE_URL: "  ",
      OPENAI_TTS_API_KEY: "",
      OPENAI_TTS_BASE_URL: "",
    } as NodeJS.ProcessEnv;

    const resolved = resolveOpenAiSpeechConfig({ env, persisted, providers: ALL_OPENAI });

    expect(resolved?.stt?.apiKey).toBe("global-key");
    expect(resolved?.tts?.apiKey).toBe("global-key");
  });

  test("omits TTS when only an STT key is configured", () => {
    const persisted = PersistedConfigSchema.parse({
      providers: {
        openai: {
          stt: { apiKey: "stt-only-key" },
        },
      },
    });

    const resolved = resolveOpenAiSpeechConfig({
      env: {} as NodeJS.ProcessEnv,
      persisted,
      providers: ALL_OPENAI,
    });

    expect(resolved?.stt?.apiKey).toBe("stt-only-key");
    expect(resolved?.tts).toBeUndefined();
  });

  test("resolves STT even when an unused TTS env var is invalid", () => {
    const persisted = PersistedConfigSchema.parse({
      providers: {
        openai: {
          stt: { apiKey: "stt-only-key" },
        },
      },
    });
    const env = { TTS_VOICE: "not-a-real-voice", TTS_MODEL: "bogus-model" } as NodeJS.ProcessEnv;

    const resolved = resolveOpenAiSpeechConfig({ env, persisted, providers: ALL_OPENAI });

    expect(resolved?.stt?.apiKey).toBe("stt-only-key");
    expect(resolved?.tts).toBeUndefined();
  });

  // T277: Groq is a configuration of this same resolver's STT slot, not a
  // second code path — see this file's header for the argument.
  describe("Groq STT configuration (T277)", () => {
    test("a bare GROQ_API_KEY fills the STT slot with Groq's fixed endpoint and default model", () => {
      const persisted = parsePersisted({});
      const env = { GROQ_API_KEY: "gsk-test" } as NodeJS.ProcessEnv;

      const resolved = resolveOpenAiSpeechConfig({
        env,
        persisted,
        providers: {
          ...ALL_OPENAI,
          voiceTts: { provider: "local", explicit: false },
        },
      });

      expect(resolved?.stt?.apiKey).toBe("gsk-test");
      expect(resolved?.stt?.baseUrl).toBe("https://api.groq.com/openai/v1");
      expect(resolved?.stt?.model).toBe("whisper-large-v3-turbo");
      expect(resolved?.tts).toBeUndefined();
    });

    test("persisted providers.groq.apiKey resolves the same as the env var", () => {
      const persisted = parsePersisted({
        providers: { groq: { apiKey: "gsk-persisted" } },
      });

      const resolved = resolveOpenAiSpeechConfig({
        env: {} as NodeJS.ProcessEnv,
        persisted,
        providers: {
          ...ALL_OPENAI,
          voiceTts: { provider: "local", explicit: false },
        },
      });

      expect(resolved?.stt?.apiKey).toBe("gsk-persisted");
      expect(resolved?.stt?.baseUrl).toBe("https://api.groq.com/openai/v1");
    });

    test("GROQ_STT_MODEL and persisted providers.groq.stt.model override the default, env winning", () => {
      const persistedEnvWins = parsePersisted({
        providers: { groq: { apiKey: "gsk-test", stt: { model: "whisper-large-v3" } } },
      });
      const resolvedEnvWins = resolveOpenAiSpeechConfig({
        env: { GROQ_STT_MODEL: "whisper-large-v3-turbo" } as NodeJS.ProcessEnv,
        persisted: persistedEnvWins,
        providers: ALL_OPENAI,
      });
      expect(resolvedEnvWins?.stt?.model).toBe("whisper-large-v3-turbo");

      const persistedOnly = parsePersisted({
        providers: { groq: { apiKey: "gsk-test", stt: { model: "whisper-large-v3" } } },
      });
      const resolvedPersistedOnly = resolveOpenAiSpeechConfig({
        env: {} as NodeJS.ProcessEnv,
        persisted: persistedOnly,
        providers: ALL_OPENAI,
      });
      expect(resolvedPersistedOnly?.stt?.model).toBe("whisper-large-v3");
    });

    test("an explicit OpenAI STT credential wins over a configured Groq key — fully backward compatible", () => {
      const persisted = parsePersisted({
        providers: {
          openai: { stt: { apiKey: "openai-stt-key" } },
          groq: { apiKey: "gsk-should-be-ignored" },
        },
      });

      const resolved = resolveOpenAiSpeechConfig({
        env: {} as NodeJS.ProcessEnv,
        persisted,
        providers: ALL_OPENAI,
      });

      expect(resolved?.stt?.apiKey).toBe("openai-stt-key");
      expect(resolved?.stt?.baseUrl).toBeUndefined();
    });

    test("no Groq key and no OpenAI STT key: STT is omitted, exactly as before this task", () => {
      const persisted = parsePersisted({
        providers: { openai: { tts: { apiKey: "tts-only-key" } } },
      });

      const resolved = resolveOpenAiSpeechConfig({
        env: {} as NodeJS.ProcessEnv,
        persisted,
        providers: ALL_OPENAI,
      });

      expect(resolved?.stt).toBeUndefined();
      expect(resolved?.tts?.apiKey).toBe("tts-only-key");
    });
  });
});
