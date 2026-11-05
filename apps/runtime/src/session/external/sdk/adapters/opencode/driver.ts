import type {
  ExternalCompactRequest,
  ExternalDriver,
  ExternalDriverCapabilities,
  ExternalLoginInput,
  ExternalTurnHandle,
  ExternalTurnRequest,
  WorkerResult,
} from "../../contract.js";
import {
  formatAskUserResultText,
  type AskUserAnswer,
  type AskUserQuestion,
} from "../../../../tools/ask-user.js";
import { collectCompactSummary } from "../../host/collect-compact-summary.js";
import { disposeAgentSdkRuntimesForTemplate } from "../../host/runtime-pool.js";
import { hasOpencodeAuth } from "./home.js";
import {
  checkOpencodeLogin,
  fetchOpencodeModels,
  logoutOpencode,
  startOpencodeLogin,
} from "./lifecycle.js";
import { loadOpencodeSdkModule } from "./load.js";
import {
  opencodeCompactPromptBodyOf,
  opencodeCompactServerConfigOf,
  opencodeCompactSessionOptionsOf,
  opencodePromptBodyOf,
  opencodeServerConfigOf,
  opencodeSessionOptionsOf,
} from "./options.js";
import { acquireOpencodeServer } from "./server-pool.js";
import {
  mirrorOpencodeEvents,
  type OpencodeQuestion,
  workerResultFromOpencodeMessage,
} from "./stream.js";

const CAPABILITIES: ExternalDriverCapabilities = {
  driverId: "opencode",
  systemPromptMode: "append",
  askUserToolNames: ["ask_user", "question"],
  compactSummarize: true,
};

export const opencodeDriver: ExternalDriver = {
  capabilities: CAPABILITIES,

  async login(input: ExternalLoginInput) {
    const result = await startOpencodeLogin(input.userDataRoot, input.templateId);
    if (result.auth_url) input.onAuthUrl(result.auth_url);
    return {
      authUrl: result.auth_url,
      state: result.state,
      ...(result.account_label ? { accountLabel: result.account_label } : {}),
    };
  },

  async logout(input) {
    await disposeAgentSdkRuntimesForTemplate(input.userDataRoot, input.templateId);
    await logoutOpencode(input.userDataRoot, input.templateId);
  },

  async probeReady(input) {
    try {
      const result = await checkOpencodeLogin(input.userDataRoot, input.templateId);
      return result.state === "ready" ? "ready" : "not_logged_in";
    } catch {
      return "error";
    }
  },

  async listModels(input) {
    return fetchOpencodeModels(input.userDataRoot, input.templateId);
  },

  async startTurn(input: ExternalTurnRequest): Promise<ExternalTurnHandle> {
    if (!hasOpencodeAuth(input.userDataRoot, input.templateId)) {
      throw new Error("尚未登录 OpenCode");
    }
    const config = opencodeServerConfigOf(input);
    const lease = await acquireOpencodeServer({
      userDataRoot: input.userDataRoot,
      templateId: input.templateId,
      cwd: input.cwd,
      config,
      signal: input.abortController.signal,
    });
    if (input.abortController.signal.aborted) {
      lease.release();
      throw Object.assign(new Error("aborted"), { name: "AbortError" });
    }
    const server = lease.value;

    const sdk = await loadOpencodeSdkModule(input.userDataRoot, input.templateId);
    const client = sdk.createOpencodeClient({
      baseUrl: server.url,
      directory: input.cwd,
    });
    const created = await client.session.create(opencodeSessionOptionsOf(input));
    const sessionId = responseId(created);
    if (!sessionId) {
      lease.release();
      throw new Error("OpenCode 未返回 session id");
    }

    let closed = false;
    const close = async () => {
      if (closed) return;
      closed = true;
      await client.session.delete({ sessionID: sessionId, directory: input.cwd }).catch(() => undefined);
      // 进程还给池；闲置到期再 server.close
      lease.release();
    };
    // 关本轮会话；SSE 依赖 abort/delete，不顺手杀 serve
    const killVendor = () => {
      void client.session.abort({ sessionID: sessionId, directory: input.cwd }).catch(() => undefined);
      void close();
    };
    const abort = () => {
      if (!input.abortController.signal.aborted) {
        // abort controller 会同步触发下方 listener → killVendor
        input.abortController.abort();
        return;
      }
      killVendor();
    };
    input.abortController.signal.addEventListener("abort", killVendor, { once: true });
    if (input.abortController.signal.aborted) killVendor();

    try {
      const subscription = await client.event.subscribe({ directory: input.cwd });
      const messages = mirrorOpencodeEvents(subscription.stream, {
        sessionId,
        onPermission: async (requestId) => {
          // 信任模式：普通 permission 请求自动永久放行。
          await client.permission.reply({
            requestID: requestId,
            directory: input.cwd,
            reply: "always",
          });
        },
        onQuestion:
          input.askUser && input.userId && input.agentId
            ? async ({ requestId, toolCallId, questions }) => {
                const hostQuestions = questions as AskUserQuestion[];
                const answer = (await input.askUser!.request(
                  {
                    userId: input.userId!,
                    agentId: input.agentId!,
                    toolCallId,
                    questions: hostQuestions,
                  },
                  input.abortController.signal,
                )) as AskUserAnswer;
                await client.question.reply({
                  requestID: requestId,
                  directory: input.cwd,
                  answers: answerSelections(answer, questions),
                });
                return formatAskUserResultText(hostQuestions, answer);
              }
            : undefined,
      });
      const prompted = await client.session.promptAsync({
        sessionID: sessionId,
        directory: input.cwd,
        ...opencodePromptBodyOf(input),
      });
      assertSdkSuccess(prompted, "OpenCode prompt 提交失败");
      return {
        messages,
        abort,
        close: async () => {
          input.abortController.signal.removeEventListener("abort", killVendor);
          await close();
        },
      };
    } catch (error) {
      input.abortController.signal.removeEventListener("abort", killVendor);
      await close();
      throw error;
    }
  },

  normalizeResult(message: unknown): WorkerResult | null {
    return workerResultFromOpencodeMessage(message);
  },

  async compactSummarize(input: ExternalCompactRequest): Promise<string> {
    if (!hasOpencodeAuth(input.userDataRoot, input.templateId)) {
      throw new Error("尚未登录 OpenCode");
    }
    const config = opencodeCompactServerConfigOf();
    const lease = await acquireOpencodeServer({
      userDataRoot: input.userDataRoot,
      templateId: input.templateId,
      cwd: input.cwd,
      config,
      signal: input.abortController.signal,
    });
    if (input.abortController.signal.aborted) {
      lease.release();
      throw Object.assign(new Error("aborted"), { name: "AbortError" });
    }
    const server = lease.value;
    const sdk = await loadOpencodeSdkModule(input.userDataRoot, input.templateId);
    const client = sdk.createOpencodeClient({
      baseUrl: server.url,
      directory: input.cwd,
    });
    const created = await client.session.create(opencodeCompactSessionOptionsOf(input));
    const sessionId = responseId(created);
    if (!sessionId) {
      lease.release();
      throw new Error("OpenCode 未返回 session id");
    }

    const close = async () => {
      await client.session
        .delete({ sessionID: sessionId, directory: input.cwd })
        .catch(() => undefined);
      lease.release();
    };

    try {
      const subscription = await client.event.subscribe({ directory: input.cwd });
      const messages = mirrorOpencodeEvents(subscription.stream, {
        sessionId,
        onPermission: async (requestId) => {
          await client.permission.reply({
            requestID: requestId,
            directory: input.cwd,
            reply: "reject",
          });
        },
      });
      const prompted = await client.session.promptAsync({
        sessionID: sessionId,
        directory: input.cwd,
        ...opencodeCompactPromptBodyOf(input),
      });
      assertSdkSuccess(prompted, "OpenCode compact prompt 提交失败");
      return await collectCompactSummary(messages, {
        normalizeResult: workerResultFromOpencodeMessage,
      });
    } finally {
      await close();
    }
  },
};

function responseId(raw: unknown): string | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const row = raw as Record<string, unknown>;
  const data =
    row.data && typeof row.data === "object" && !Array.isArray(row.data)
      ? (row.data as Record<string, unknown>)
      : row;
  return typeof data.id === "string" && data.id ? data.id : null;
}

function assertSdkSuccess(raw: unknown, message: string): void {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return;
  if ((raw as Record<string, unknown>).error) throw new Error(message);
}

function answerSelections(
  answer: AskUserAnswer,
  questions: OpencodeQuestion[],
): string[][] {
  if (!answer || typeof answer !== "object" || !("items" in answer)) {
    return questions.map(() => []);
  }
  const items = Array.isArray(answer.items) ? answer.items : [];
  return questions.map((_, index) => {
    const item = items[index];
    if (!item || typeof item !== "object") return [];
    if ("selections" in item && Array.isArray(item.selections)) {
      return item.selections.filter((value): value is string => typeof value === "string");
    }
    if ("text" in item && typeof item.text === "string") return [item.text];
    return [];
  });
}
