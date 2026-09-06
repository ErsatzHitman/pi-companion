import type {
  PiAgentMessage,
  PiModel,
  PiPromptAck,
  PiPromptStreamingBehavior,
  PiRpcSlashCommand,
  PiRuntimeEvent,
  PiSessionState,
  PiSessionStats,
} from "./rpc-types.js";
import type { ProviderRuntimeSettings } from "../../provider-launch-config.js";

export interface PiRuntimeLaunch {
  cwd: string;
  argv: string[];
  env?: Record<string, string>;
  protocolMode?: "rpc" | "rpc-ui";
  model?: string;
  thinkingOptionId?: string;
  modeId?: string;
  session?: string;
  noSession?: boolean;
  mcpConfigPath?: string;
  extensionPaths?: string[];
  extraArgs?: string[];
}

export interface PiStartSessionInput {
  cwd: string;
  env?: Record<string, string>;
  protocolMode?: "rpc" | "rpc-ui";
  model?: string;
  thinkingOptionId?: string;
  modeId?: string;
  session?: string;
  noSession?: boolean;
  mcpConfigPath?: string;
  extensionPaths?: string[];
  extraArgs?: string[];
}

export interface PiRuntimeSession {
  onEvent(callback: (event: PiRuntimeEvent) => void): () => void;
  // T97: `streamingBehavior` mirrors Pi's own `prompt` RPC field (see
  // `PiPromptStreamingBehavior` in rpc-types.ts) — routes this one message as
  // a steer or a follow-up, independent of the session's current mode.
  // Omitting it preserves pre-T97 behaviour exactly.
  prompt(
    message: string,
    images?: Array<{ type: "image"; data: string; mimeType: string }>,
    streamingBehavior?: PiPromptStreamingBehavior,
  ): Promise<PiPromptAck>;
  compact(customInstructions?: string): Promise<void>;
  setAutoCompaction(enabled: boolean): Promise<void>;
  abort(): Promise<void>;
  getState(): Promise<PiSessionState>;
  getMessages(): Promise<PiAgentMessage[]>;
  getAvailableModels(timeoutMs?: number | null): Promise<PiModel[]>;
  setModel(provider: string, modelId: string): Promise<PiModel>;
  setThinkingLevel(level: string): Promise<void>;
  getSessionStats(): Promise<PiSessionStats>;
  getCommands(): Promise<PiRpcSlashCommand[]>;
  steer(
    message: string,
    images?: Array<{ type: "image"; data: string; mimeType: string }>,
  ): Promise<void>;
  followUp(
    message: string,
    images?: Array<{ type: "image"; data: string; mimeType: string }>,
  ): Promise<void>;
  getEntries(): Promise<unknown[]>;
  // T142: `getTree`/`get_tree` removed — see the doc comment above the
  // (removed) `get_tree` arm in `rpc-types.ts`'s `PiRpcCommand` union for
  // the full decision record. Zero production callers, and the session
  // tree that shipped does not use a daemon RPC at all.
  request(
    command: { type: string; [key: string]: unknown },
    timeoutMs?: number | null,
  ): Promise<unknown>;
  sendRawFrame(frame: object & { type: string }): void;
  respondToExtensionUiRequest(
    id: string,
    response: { value?: string; confirmed?: boolean; cancelled?: boolean },
  ): void;
  cancelExtensionUiRequest(id: string): void;
  close(): Promise<void>;
}

export interface PiRuntime {
  startSession(input: PiStartSessionInput): Promise<PiRuntimeSession>;
}

export function buildPiLaunch(input: {
  command: [string, ...string[]];
  runtimeSettings?: ProviderRuntimeSettings;
  session: PiStartSessionInput;
}): PiRuntimeLaunch {
  const command =
    input.runtimeSettings?.command?.mode === "replace" && input.runtimeSettings.command.argv[0]
      ? input.runtimeSettings.command.argv
      : input.command;
  const argv = [...command];

  const protocolMode = input.session.protocolMode ?? "rpc";
  appendPiLaunchArgs(argv, input.session, protocolMode);

  return {
    cwd: input.session.cwd,
    argv,
    env:
      input.runtimeSettings?.env || input.session.env
        ? {
            ...input.runtimeSettings?.env,
            ...input.session.env,
          }
        : undefined,
    model: input.session.model,
    thinkingOptionId: input.session.thinkingOptionId,
    protocolMode,
    modeId: input.session.modeId,
    session: input.session.session,
    noSession: input.session.noSession,
    mcpConfigPath: input.session.mcpConfigPath,
    extensionPaths: input.session.extensionPaths,
    extraArgs: input.session.extraArgs,
  };
}

function appendPiLaunchArgs(
  argv: string[],
  session: PiStartSessionInput,
  protocolMode: "rpc" | "rpc-ui",
): void {
  if (!hasModeFlag(argv)) {
    argv.push("--mode", protocolMode);
  }
  if (session.extraArgs?.length) {
    argv.push(...session.extraArgs);
  }
  if (session.model) {
    argv.push("--model", session.model);
  }
  if (session.thinkingOptionId) {
    argv.push("--thinking", session.thinkingOptionId);
  }
  if (session.noSession) {
    argv.push("--no-session");
  } else if (session.session) {
    argv.push("--session", session.session);
  }
  if (session.mcpConfigPath) {
    argv.push("--mcp-config", session.mcpConfigPath);
  }
  for (const extensionPath of session.extensionPaths ?? []) {
    argv.push("--extension", extensionPath);
  }
}

function hasModeFlag(argv: string[]): boolean {
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--mode") {
      return true;
    }
    if (argv[i]?.startsWith("--mode=")) {
      return true;
    }
  }
  return false;
}
