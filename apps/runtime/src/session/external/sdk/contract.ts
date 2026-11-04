/**
 * 本地 Agent App / 外部 SDK 的统一 Driver 契约。
 * 文档：.cursor/skills/agentup-sdk-adapter/references/contract.md
 *
 * Host 只认本文件类型；厂商差异全部进 adapters/<driverId>/。
 */

/** 与模板 agentSdk.driverId 对齐的稳定实现 id。 */
export type ExternalDriverId =
  | "codebuddy"
  | "claude-code"
  | "cursor"
  | "codex"
  | "opencode"
  | (string & {});

/**
 * append：厂商支持 systemPrompt.append。
 * replace：厂商只接受整段替换（常需账号开通；Cursor 多数账号未开）。
 * prompt_prefix：不改厂商系统提示，把 Host context 拼进本轮 user prompt 前缀。
 */
export type SystemPromptMode = "append" | "replace" | "prompt_prefix";

export interface ExternalDriverCapabilities {
  driverId: ExternalDriverId;
  systemPromptMode: SystemPromptMode;
  /** 需拦到 AskUserBroker 的厂商工具名；空 = 本路径无问卷。 */
  askUserToolNames: readonly string[];
}

export interface ExternalLoginInput {
  userDataRoot: string;
  templateId: string;
  onAuthUrl: (url: string) => void;
  signal?: AbortSignal;
}

export interface ExternalModel {
  id: string;
  name: string;
  /** credit 倍率；0 是真实值，认不出才是 undefined */
  credits?: number;
}

export type ExternalProbeState = "ready" | "not_logged_in" | "error";

export interface ExternalDriverLifecycle {
  login(input: ExternalLoginInput): Promise<{
    authUrl: string | null;
    state: "logging_in" | "ready" | "not_logged_in";
    accountLabel?: string;
  }>;
  logout(input: { userDataRoot: string; templateId: string }): Promise<void>;
  probeReady(input: {
    userDataRoot: string;
    templateId: string;
    signal?: AbortSignal;
  }): Promise<ExternalProbeState>;
  listModels(input: {
    userDataRoot: string;
    templateId: string;
  }): Promise<ExternalModel[]>;
}

/** AskUser 宿主 sink：问卷 ≠ 工具权限。具体题型由 Host ask-user 收窄。 */
export interface ExternalAskUserSink {
  request(
    request: {
      userId: string;
      agentId: string;
      toolCallId: string;
      questions: unknown[];
    },
    signal?: AbortSignal,
  ): Promise<unknown>;
}

/**
 * Host 每轮重拼后交给 adaptor 的单次输入。
 * 禁止用厂商 sessionId 续聊；下一轮再拼一份新的。
 */
export interface ExternalTurnRequest {
  prompt: string;
  cwd: string;
  additionalDirs: string[];
  systemAppend: string;
  modelId?: string;
  mcpServer?: Record<string, unknown>;
  abortController: AbortController;
  askUser?: ExternalAskUserSink;
  userId?: string;
  agentId?: string;
  cliPath?: string | null;
  userDataRoot: string;
  templateId: string;
}

export interface ExternalTurnHandle {
  messages: AsyncIterable<unknown>;
  abort(): void;
  close(): Promise<void> | void;
}

export interface WorkerResult {
  finalText: string;
  finishReason: "completed" | "max_tokens" | "error" | "aborted";
  /** 仅日志；不得用于下一轮 resume */
  sessionId?: string;
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    cacheRead?: number;
    cacheWrite?: number;
    durationMs?: number;
  };
  error?: { code: string; message: string };
  permissionDenials: number;
  numTurns?: number;
}

export interface ExternalDriverTurn {
  startTurn(input: ExternalTurnRequest): Promise<ExternalTurnHandle>;
  /** 覆盖默认鸭子归一；缺省用 host/result */
  normalizeResult?(message: unknown): WorkerResult | null;
}

export interface ExternalDriver extends ExternalDriverLifecycle, ExternalDriverTurn {
  readonly capabilities: ExternalDriverCapabilities;
}
