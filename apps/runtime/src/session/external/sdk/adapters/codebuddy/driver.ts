import type {
  ExternalDriver,
  ExternalDriverCapabilities,
  ExternalLoginInput,
  ExternalTurnHandle,
  ExternalTurnRequest,
  WorkerResult,
} from "../../contract.js";
import { resultFromSdkMessage } from "../../host/result.js";
import { loadCodebuddyModule } from "./load.js";
import {
  checkAgentSdkLogin,
  logoutAgentSdk,
  startAgentSdkLogin,
} from "./login-impl.js";
import { fetchAgentSdkModels } from "./models-impl.js";
import { codebuddyOptionsOf } from "./options.js";

const CAPABILITIES: ExternalDriverCapabilities = {
  driverId: "codebuddy",
  systemPromptMode: "append",
  askUserToolNames: ["AskUserQuestion"],
};

/**
 * CodeBuddy / Workbuddy ExternalDriver。
 * 启流：query({ prompt, options })；上下文单次注入，persistSession: false。
 */
export const codebuddyDriver: ExternalDriver = {
  capabilities: CAPABILITIES,

  async login(input: ExternalLoginInput) {
    // 设置页仍走 startAgentSdkLogin（需先返回 auth_url）；契约 login 用于统一面
    const result = await startAgentSdkLogin(input.userDataRoot, input.templateId);
    if (result.auth_url) input.onAuthUrl(result.auth_url);
    return {
      authUrl: result.auth_url,
      state: result.state,
      ...(result.account_label ? { accountLabel: result.account_label } : {}),
    };
  },

  async logout(input) {
    await logoutAgentSdk(input.userDataRoot, input.templateId);
  },

  async probeReady(input) {
    try {
      const result = await checkAgentSdkLogin(input.userDataRoot, input.templateId);
      if (result.state === "ready") return "ready";
      if (result.state === "logging_in") return "not_logged_in";
      return "not_logged_in";
    } catch {
      return "error";
    }
  },

  async listModels(input) {
    return fetchAgentSdkModels(input.userDataRoot, input.templateId);
  },

  async startTurn(input: ExternalTurnRequest): Promise<ExternalTurnHandle> {
    const module = await loadCodebuddyModule(input.userDataRoot, input.templateId);
    if (typeof module.query !== "function") throw new Error("本地 Agent App 不支持 query()");
    const iterable = module.query({
      prompt: input.prompt,
      options: codebuddyOptionsOf(input),
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
};

function closeIterable(iterable: AsyncIterable<unknown>): void {
  try {
    const closer = (iterable as { return?: () => Promise<unknown> | undefined }).return;
    void Promise.resolve(closer?.call(iterable)).catch(() => undefined);
  } catch {
    // 关不掉就算了
  }
}
