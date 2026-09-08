import { z } from "zod";

import type { PersistedConfig } from "../../../persisted-config.js";
import type { RequestedSpeechProviders } from "../../speech-types.js";
import type { STTConfig } from "./stt.js";
import type { TTSConfig } from "./tts.js";

export const DEFAULT_OPENAI_TTS_MODEL = "tts-1";

/**
 * T277 (plan.md §9.4 "Groq transcription and draft insertion"): Groq's transcription API is
 * served at this exact path and speaks the identical request/response shape
 * `OpenAISTT` already sends to OpenAI's own `/audio/transcriptions` endpoint
 * (multipart file + model + language in, `{ text }` json out — re-verified
 * against Groq's own docs, not copied from a research note). Established by
 * execution, not assumed: `OpenAISTT`'s constructor already accepts an
 * arbitrary `baseUrl` and passes it straight to the `openai` SDK's
 * `baseURL` option (see this file's `buildSttConfig`), and its model field
 * is typed `(string & {})` specifically to allow a non-OpenAI model id. So
 * pointing that SAME class at Groq's endpoint with a Groq model id and key
 * transcribes through Groq with zero new engine code — Groq is a
 * configuration in front of the existing OpenAI-compatible path, not a
 * second provider implementation. (This is the same shape
 * `D:\Handy\research\cloud-stt-groq\07-proposed-architecture.md` reached for
 * a different codebase; cited here as a reference for the reasoning, not as
 * authority for this repository's own decision, which is recorded in
 * `plan.md` §9.4.)
 */
export const GROQ_STT_BASE_URL = "https://api.groq.com/openai/v1";
export const DEFAULT_GROQ_STT_MODEL = "whisper-large-v3-turbo";

export interface OpenAiSpeechProviderConfig {
  stt?: Partial<STTConfig> & { apiKey?: string };
  tts?: Partial<TTSConfig> & { apiKey?: string };
}

const OpenAiTtsVoiceSchema = z.enum(["alloy", "echo", "fable", "onyx", "nova", "shimmer"]);

const OpenAiTtsModelSchema = z.enum(["tts-1", "tts-1-hd"]);

const NumberLikeSchema = z.union([z.number(), z.string().trim().min(1)]);

const OptionalFiniteNumberSchema = NumberLikeSchema.pipe(
  z.coerce.number<string | number>().finite(),
).optional();

const OptionalTrimmedStringSchema = z
  .string()
  .trim()
  .optional()
  .transform((value) => (value && value.length > 0 ? value : undefined));

// Endpoint credentials only — plain trimmed strings, so this never throws on a
// malformed value. The STT/TTS option groups parse separately and only for the
// endpoint that is actually configured, so a stale env var for an unused endpoint
// (e.g. a leftover TTS_VOICE in an STT-only setup) can't break the other one.
const OpenAiEndpointKeysSchema = z.object({
  sttApiKey: OptionalTrimmedStringSchema,
  sttBaseUrl: OptionalTrimmedStringSchema,
  ttsApiKey: OptionalTrimmedStringSchema,
  ttsBaseUrl: OptionalTrimmedStringSchema,
});

const OpenAiSttOptionsSchema = z.object({
  sttConfidenceThreshold: OptionalFiniteNumberSchema,
  sttModel: OptionalTrimmedStringSchema,
});

const OpenAiTtsOptionsSchema = z.object({
  ttsVoice: z.string().trim().toLowerCase().pipe(OpenAiTtsVoiceSchema).default("alloy"),
  ttsModel: z
    .string()
    .trim()
    .toLowerCase()
    .pipe(OpenAiTtsModelSchema)
    .default(DEFAULT_OPENAI_TTS_MODEL),
});

function isOpenAiProviderActive(provider: { enabled?: boolean; provider: string }): boolean {
  return provider.enabled !== false && provider.provider === "openai";
}

function pickIfOpenAi<T>(
  provider: { enabled?: boolean; provider: string },
  value: T | undefined,
): T | undefined {
  return isOpenAiProviderActive(provider) ? value : undefined;
}

function firstDefined<T>(values: Array<T | null | undefined>): T | undefined {
  for (const value of values) {
    if (value === undefined || value === null) {
      continue;
    }
    // Empty/whitespace env vars (e.g. a copied .env.example with OPENAI_STT_API_KEY=)
    // must not shadow a later fallback such as OPENAI_API_KEY.
    if (typeof value === "string" && value.trim().length === 0) {
      continue;
    }
    return value;
  }
  return undefined;
}

function buildOpenAiSttInput(params: {
  env: NodeJS.ProcessEnv;
  persisted: PersistedConfig;
  providers: RequestedSpeechProviders;
}): Record<string, unknown> {
  const { env, persisted, providers } = params;
  return {
    sttConfidenceThreshold: firstDefined<string | number>([
      env.STT_CONFIDENCE_THRESHOLD,
      persisted.features?.dictation?.stt?.confidenceThreshold,
    ]),
    sttModel: firstDefined<string>([
      env.STT_MODEL,
      pickIfOpenAi(providers.voiceStt, persisted.features?.voiceMode?.stt?.model),
      pickIfOpenAi(providers.dictationStt, persisted.features?.dictation?.stt?.model),
    ]),
  };
}

function buildOpenAiTtsInput(params: {
  env: NodeJS.ProcessEnv;
  persisted: PersistedConfig;
  providers: RequestedSpeechProviders;
}): Record<string, unknown> {
  const { env, persisted, providers } = params;
  return {
    ttsVoice: firstDefined<string>([
      env.TTS_VOICE,
      pickIfOpenAi(providers.voiceTts, persisted.features?.voiceMode?.tts?.voice),
      "alloy",
    ]),
    ttsModel: firstDefined<string>([
      env.TTS_MODEL,
      pickIfOpenAi(providers.voiceTts, persisted.features?.voiceMode?.tts?.model),
      DEFAULT_OPENAI_TTS_MODEL,
    ]),
  };
}

function buildOpenAiResolutionInput(params: {
  env: NodeJS.ProcessEnv;
  persisted: PersistedConfig;
  providers: RequestedSpeechProviders;
}): Record<string, unknown> {
  const { env } = params;
  const openai = params.persisted.providers?.openai;
  return {
    sttApiKey: firstDefined<string>([
      openai?.stt?.apiKey,
      env.OPENAI_STT_API_KEY,
      openai?.apiKey,
      env.OPENAI_API_KEY,
    ]),
    sttBaseUrl: firstDefined<string>([
      openai?.stt?.baseUrl,
      env.OPENAI_STT_BASE_URL,
      openai?.baseUrl,
      env.OPENAI_BASE_URL,
    ]),
    ttsApiKey: firstDefined<string>([
      openai?.tts?.apiKey,
      env.OPENAI_TTS_API_KEY,
      openai?.apiKey,
      env.OPENAI_API_KEY,
    ]),
    ttsBaseUrl: firstDefined<string>([
      openai?.tts?.baseUrl,
      env.OPENAI_TTS_BASE_URL,
      openai?.baseUrl,
      env.OPENAI_BASE_URL,
    ]),
    ...buildOpenAiSttInput(params),
    ...buildOpenAiTtsInput(params),
  };
}

/**
 * T277: resolves a Groq STT credential from its OWN dedicated slots
 * (`GROQ_API_KEY` env, `persisted.providers.groq.apiKey`) — never from the
 * generic `OPENAI_*` names, so a user configuring Groq never has to know the
 * "point OpenAI's baseUrl at a different vendor" trick is even possible.
 * `baseUrl` is always Groq's real endpoint (never overridable — see
 * `persisted-config.ts`'s `GroqProviderSchema` header for why), and `model`
 * always resolves to a Groq-valid whisper id (never `OpenAISTT`'s own
 * `"whisper-1"` default, which Groq does not serve).
 */
function resolveGroqSttCredentials(params: {
  env: NodeJS.ProcessEnv;
  persisted: PersistedConfig;
}): { apiKey: string; baseUrl: string; model: string } | undefined {
  const groq = params.persisted.providers?.groq;
  const apiKey = firstDefined<string>([groq?.apiKey, params.env.GROQ_API_KEY]);
  if (!apiKey) {
    return undefined;
  }
  const model =
    firstDefined<string>([params.env.GROQ_STT_MODEL, groq?.stt?.model]) ?? DEFAULT_GROQ_STT_MODEL;
  return { apiKey, baseUrl: GROQ_STT_BASE_URL, model };
}

export function resolveOpenAiSpeechConfig(params: {
  env: NodeJS.ProcessEnv;
  persisted: PersistedConfig;
  providers: RequestedSpeechProviders;
}): OpenAiSpeechProviderConfig | undefined {
  const input = buildOpenAiResolutionInput(params);
  const keys = OpenAiEndpointKeysSchema.parse(input);

  // An explicit OpenAI STT credential always wins — unchanged, fully
  // backward-compatible behaviour. Only when NONE is configured does a
  // configured Groq key step in to fill the same `stt` slot, reusing
  // `OpenAISTT` unmodified (see this file's header for why that is the
  // whole point).
  const groqStt = keys.sttApiKey
    ? undefined
    : resolveGroqSttCredentials({ env: params.env, persisted: params.persisted });

  if (!keys.sttApiKey && !groqStt && !keys.ttsApiKey) {
    return undefined;
  }

  const sttConfig = keys.sttApiKey
    ? buildSttConfig(keys.sttApiKey, keys.sttBaseUrl, input)
    : groqStt
      ? { apiKey: groqStt.apiKey, baseUrl: groqStt.baseUrl, model: groqStt.model }
      : undefined;

  return {
    ...(sttConfig ? { stt: sttConfig } : {}),
    ...(keys.ttsApiKey ? { tts: buildTtsConfig(keys.ttsApiKey, keys.ttsBaseUrl, input) } : {}),
  };
}

function buildSttConfig(
  apiKey: string,
  baseUrl: string | undefined,
  input: Record<string, unknown>,
): OpenAiSpeechProviderConfig["stt"] {
  const options = OpenAiSttOptionsSchema.parse(input);
  return {
    apiKey,
    ...(baseUrl ? { baseUrl } : {}),
    ...(options.sttConfidenceThreshold !== undefined
      ? { confidenceThreshold: options.sttConfidenceThreshold }
      : {}),
    ...(options.sttModel ? { model: options.sttModel } : {}),
  };
}

function buildTtsConfig(
  apiKey: string,
  baseUrl: string | undefined,
  input: Record<string, unknown>,
): OpenAiSpeechProviderConfig["tts"] {
  const options = OpenAiTtsOptionsSchema.parse(input);
  return {
    apiKey,
    ...(baseUrl ? { baseUrl } : {}),
    voice: options.ttsVoice,
    model: options.ttsModel,
    responseFormat: "pcm",
  };
}
