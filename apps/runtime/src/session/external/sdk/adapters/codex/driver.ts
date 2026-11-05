import type {
  ExternalCompactRequest,
  ExternalDriver,
  ExternalDriverCapabilities,
  ExternalLoginInput,
  ExternalTurnHandle,
  ExternalTurnRequest,
  WorkerResult,
} from "../../contract.js";
import { collectCompactSummary } from "../../host/collect-compact-summary.js";
import { CodexAskUserIdBridge } from "./ask-user-bridge.js";
import { ensureCodexHome, hasCodexAuth } from "./home.js";
import {
  checkCodexLogin,
  fetchCodexModels,
  logoutCodex,
  startCodexLogin,
} from "./lifecycle.js";
import { loadCodexModule, resolveCodexCliPath } from "./load.js";
import {
  codexClientOptionsOf,
  codexCompactClientOptionsOf,
  codexCompactPromptOf,
  codexCompactThreadOptionsOf,
  codexThreadOptionsOf,
  codexTurnPromptOf,
  openCodexAskUserMcp,
} from "./options.js";
import { mirrorCodexEvents, workerResultFromCodexMessage } from "./stream.js";

const CAPABILITIES: ExternalDriverCapabilities = {
  driverId: "codex",
  // ThreadOptions 无 systemPrompt.append → Host context 进 prompt 前缀
  systemPromptMode: "prompt_prefix",
  // 临时 MCP agentup_ask → stream 解包成 ask_user
  askUserToolNames: ["ask_user", "agentup_ask_user"],
  // 无硬 deny 工具；靠空 cwd + 无 MCP + 压缩 prompt 软约束
  compactSummarize: true,
};

/**
 * Codex ExternalDriver。
 * 启流：new Codex → startThread → runStreamed；每轮新 thread，不 resume。
 */
export const codexDriver: ExternalDriver = {
  capabilities: CAPABILITIES,

  async login(input: ExternalLoginInput) {
    const result = await startCodexLogin(input.userDataRoot, input.templateId);
    if (result.auth_url) input.onAuthUrl(result.auth_url);
    return {
      authUrl: result.auth_url,
      state: result.state,
      ...(result.account_label ? { accountLabel: result.account_label } : {}),
    };
  },

  async logout(input) {
    await logoutCodex(input.userDataRoot, input.templateId);
  },

  async probeReady(input) {
    try {
      const result = await checkCodexLogin(input.userDataRoot, input.templateId);
      if (result.state === "ready") return "ready";
      return "not_logged_in";
    } catch {
      return "error";
    }
  },

  async listModels(input) {
    return fetchCodexModels(input.userDataRoot, input.templateId);
  },

  async startTurn(input: ExternalTurnRequest): Promise<ExternalTurnHandle> {
    if (!hasCodexAuth(input.userDataRoot, input.templateId)) {
      throw new Error("尚未登录 Codex");
    }
    const cliPath = resolveCodexCliPath(input.userDataRoot, input.templateId);
    if (!cliPath) throw new Error("找不到 Codex CLI，请重新安装");

    const sdk = await loadCodexModule(input.userDataRoot, input.templateId);
    const codexHome = ensureCodexHome(input.userDataRoot, input.templateId);
    const askBridge = new CodexAskUserIdBridge();
    const askMcp = await openCodexAskUserMcp(input, askBridge);

    const client = new sdk.Codex(
      codexClientOptionsOf(input, {
        cliPath,
        codexHome,
        askUserMcp: askMcp
          ? { url: askMcp.url, headers: askMcp.headers }
          : null,
      }),
    );
    // 每轮新 thread：禁止 resumeThread / 跨轮复用 id
    const thread = client.startThread(codexThreadOptionsOf(input));

    if (input.abortController.signal.aborted) {
      await askMcp?.close().catch(() => undefined);
      throw Object.assign(new Error("aborted"), { name: "AbortError" });
    }

    let closed = false;
    const closeAsk = async () => {
      if (closed) return;
      closed = true;
      await askMcp?.close().catch(() => undefined);
    };

    const onAbort = () => {
      // AbortSignal 传给 runStreamed；子进程由 SDK/CLI 处理
      void closeAsk();
    };
    input.abortController.signal.addEventListener("abort", onAbort, { once: true });

    let events: AsyncIterable<unknown>;
    try {
      const streamed = await thread.runStreamed(codexTurnPromptOf(input), {
        signal: input.abortController.signal,
      });
      events = streamed.events;
    } catch (error) {
      input.abortController.signal.removeEventListener("abort", onAbort);
      await closeAsk();
      throw error;
    }

    const messages = mirrorCodexEvents(events, { askUserBridge: askBridge });
    return {
      messages,
      abort: () => {
        input.abortController.abort();
      },
      close: async () => {
        input.abortController.signal.removeEventListener("abort", onAbort);
        await closeAsk();
      },
    };
  },

  normalizeResult(message: unknown): WorkerResult | null {
    return workerResultFromCodexMessage(message);
  },

  async compactSummarize(input: ExternalCompactRequest): Promise<string> {
    if (!hasCodexAuth(input.userDataRoot, input.templateId)) {
      throw new Error("尚未登录 Codex");
    }
    const cliPath =
      input.cliPath || resolveCodexCliPath(input.userDataRoot, input.templateId);
    if (!cliPath) throw new Error("找不到 Codex CLI，请重新安装");

    const sdk = await loadCodexModule(input.userDataRoot, input.templateId);
    const codexHome = ensureCodexHome(input.userDataRoot, input.templateId);
    const client = new sdk.Codex(
      codexCompactClientOptionsOf({ cliPath, codexHome }),
    );
    const thread = client.startThread(codexCompactThreadOptionsOf(input));
    const streamed = await thread.runStreamed(codexCompactPromptOf(input), {
      signal: input.abortController.signal,
    });
    const messages = mirrorCodexEvents(streamed.events);
    return collectCompactSummary(messages, {
      normalizeResult: workerResultFromCodexMessage,
    });
  },
};
