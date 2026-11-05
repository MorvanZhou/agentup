import type {
  ExternalCompactRequest,
  ExternalDriver,
  ExternalDriverCapabilities,
  ExternalLoginInput,
  ExternalTurnHandle,
  ExternalTurnRequest,
  WorkerResult,
} from "../../contract.js";
import { closeIterable, collectCompactSummary } from "../../host/collect-compact-summary.js";
import { resultFromSdkMessage } from "../../host/result.js";
import { hasClaudeApiKey } from "./home.js";
import {
  checkClaudeLogin,
  fetchClaudeModels,
  logoutClaude,
  startClaudeLogin,
} from "./lifecycle.js";
import { loadClaudeModule } from "./load.js";
import { claudeCompactOptionsOf, claudeOptionsOf } from "./options.js";

const CAPABILITIES: ExternalDriverCapabilities = {
  driverId: "claude-code",
  systemPromptMode: "append",
  askUserToolNames: ["AskUserQuestion"],
  compactSummarize: true,
};

/**
 * Claude Agent SDK ExternalDriver。
 * 启流：query({ prompt, options })；上下文单次注入，persistSession: false。
 * 登录：粘贴 Console API Key（禁止未批准的 claude.ai OAuth）。
 */
export const claudeCodeDriver: ExternalDriver = {
  capabilities: CAPABILITIES,

  async login(input: ExternalLoginInput) {
    const result = await startClaudeLogin(input.userDataRoot, input.templateId);
    if (result.auth_url) input.onAuthUrl(result.auth_url);
    return {
      authUrl: result.auth_url,
      state: result.state,
      ...(result.account_label ? { accountLabel: result.account_label } : {}),
    };
  },

  async logout(input) {
    await logoutClaude(input.userDataRoot, input.templateId);
  },

  async probeReady(input) {
    try {
      const result = await checkClaudeLogin(input.userDataRoot, input.templateId);
      return result.state === "ready" ? "ready" : "not_logged_in";
    } catch {
      return "error";
    }
  },

  async listModels(input) {
    return fetchClaudeModels(input.userDataRoot, input.templateId);
  },

  async startTurn(input: ExternalTurnRequest): Promise<ExternalTurnHandle> {
    if (!hasClaudeApiKey(input.userDataRoot, input.templateId)) {
      throw new Error("尚未登录 Claude Code（请先在设置里粘贴 API Key）");
    }

    const module = await loadClaudeModule(input.userDataRoot, input.templateId);
    if (typeof module.query !== "function") {
      throw new Error("本地 Agent App 不支持 query()");
    }
    const iterable = module.query({
      prompt: input.prompt,
      options: claudeOptionsOf(input),
    });
    return {
      messages: iterable,
      abort: () => input.abortController.abort(),
      close: () => closeIterable(iterable),
    };
  },

  normalizeResult(message: unknown): WorkerResult | null {
    return resultFromSdkMessage(message);
  },

  async compactSummarize(input: ExternalCompactRequest): Promise<string> {
    if (!hasClaudeApiKey(input.userDataRoot, input.templateId)) {
      throw new Error("尚未登录 Claude Code（请先在设置里粘贴 API Key）");
    }
    const module = await loadClaudeModule(input.userDataRoot, input.templateId);
    if (typeof module.query !== "function") {
      throw new Error("本地 Agent App 不支持 query()");
    }
    const iterable = module.query({
      prompt: input.prompt,
      options: claudeCompactOptionsOf(input),
    });
    try {
      return await collectCompactSummary(iterable);
    } finally {
      closeIterable(iterable);
    }
  },
};
