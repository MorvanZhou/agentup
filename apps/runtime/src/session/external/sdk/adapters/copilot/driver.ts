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
import { disposeAgentSdkRuntimesForTemplate } from "../../host/runtime-pool.js";
import { acquireCopilotClient } from "./client-pool.js";
import {
  checkCopilotLogin,
  fetchCopilotModels,
  logoutCopilot,
  startCopilotLogin,
} from "./lifecycle.js";
import type { CopilotSdkClient } from "./load.js";
import { loadCopilotModule } from "./load.js";
import {
  copilotCompactSendOptionsOf,
  copilotCompactSessionConfigOf,
  copilotSendOptionsOf,
  copilotSessionConfigOf,
  runCopilotAskUser,
} from "./options.js";
import { mirrorCopilotSession, workerResultFromCopilotMessage } from "./stream.js";

const CAPABILITIES: ExternalDriverCapabilities = {
  driverId: "copilot",
  // systemMessage 默认 append Host context
  systemPromptMode: "append",
  askUserToolNames: ["ask_user", "AskUserQuestion"],
  compactSummarize: true,
};

/**
 * GitHub Copilot ExternalDriver。
 * 启流：池化 CopilotClient → 每轮 createSession → send + 事件；不 resume。
 */
export const copilotDriver: ExternalDriver = {
  capabilities: CAPABILITIES,

  async login(input: ExternalLoginInput) {
    const result = await startCopilotLogin(input.userDataRoot, input.templateId);
    if (result.auth_url) input.onAuthUrl(result.auth_url);
    return {
      authUrl: result.auth_url,
      state: result.state,
      ...(result.account_label ? { accountLabel: result.account_label } : {}),
    };
  },

  async logout(input) {
    await disposeAgentSdkRuntimesForTemplate(input.userDataRoot, input.templateId);
    await logoutCopilot(input.userDataRoot, input.templateId);
  },

  async probeReady(input) {
    try {
      const result = await checkCopilotLogin(input.userDataRoot, input.templateId);
      if (result.state === "ready") return "ready";
      return "not_logged_in";
    } catch {
      return "error";
    }
  },

  async listModels(input) {
    return fetchCopilotModels(input.userDataRoot, input.templateId);
  },

  async startTurn(input: ExternalTurnRequest): Promise<ExternalTurnHandle> {
    throwIfAborted(input.abortController.signal);

    const lease = await raceAbort(
      acquireCopilotClient({
        userDataRoot: input.userDataRoot,
        templateId: input.templateId,
        cwd: input.cwd,
      }),
      input.abortController.signal,
      () => undefined,
    ).catch((error) => {
      throw error;
    });

    // acquire 成功后若已 abort：还回池，勿 stop（池负责生命周期）
    if (input.abortController.signal.aborted) {
      lease.release();
      throw Object.assign(new Error("aborted"), { name: "AbortError" });
    }

    const { client } = lease.value;
    const sdk = await loadCopilotModule(input.userDataRoot, input.templateId);

    const onUserInputRequest = input.askUser
      ? (request: unknown, invocation?: unknown) =>
          runCopilotAskUser(input, request, invocation)
      : undefined;

    let session: Awaited<ReturnType<CopilotSdkClient["createSession"]>>;
    try {
      session = await raceAbort(
        client.createSession(
          copilotSessionConfigOf(input, {
            approveAll: sdk.approveAll,
            onUserInputRequest,
          }),
        ),
        input.abortController.signal,
        () => undefined,
      );
    } catch (error) {
      lease.release();
      throw error;
    }

    if (input.abortController.signal.aborted) {
      await session.disconnect().catch(() => undefined);
      lease.release();
      throw Object.assign(new Error("aborted"), { name: "AbortError" });
    }

    let settled = false;
    const waitIdle = new Promise<void>((resolve) => {
      const finish = () => {
        if (settled) return;
        settled = true;
        resolve();
      };
      try {
        session.on("session.idle", finish);
        session.on("session.error", finish);
        session.on("error", finish);
      } catch {
        /* typed on 失败时 mirror 内通配也会收 idle */
      }
      input.abortController.signal.addEventListener("abort", finish, { once: true });
    });

    const onAbort = () => {
      // 只杀本轮 session；CLI 进程留给池闲置回收
      void Promise.resolve(session.abort?.()).catch(() => undefined);
    };
    input.abortController.signal.addEventListener("abort", onAbort, { once: true });

    try {
      await raceAbort(session.send(copilotSendOptionsOf(input)), input.abortController.signal, onAbort);
    } catch (error) {
      input.abortController.signal.removeEventListener("abort", onAbort);
      await session.disconnect().catch(() => undefined);
      lease.release();
      throw error;
    }

    const messages = mirrorCopilotSession(session, waitIdle);
    return {
      messages,
      abort: () => {
        input.abortController.abort();
        void Promise.resolve(session.abort?.()).catch(() => undefined);
      },
      close: async () => {
        input.abortController.signal.removeEventListener("abort", onAbort);
        try {
          await session.disconnect().catch(() => undefined);
        } finally {
          lease.release();
        }
      },
    };
  },

  normalizeResult(message: unknown): WorkerResult | null {
    return workerResultFromCopilotMessage(message);
  },

  async compactSummarize(input: ExternalCompactRequest): Promise<string> {
    throwIfAborted(input.abortController.signal);
    const lease = await raceAbort(
      acquireCopilotClient({
        userDataRoot: input.userDataRoot,
        templateId: input.templateId,
        cwd: input.cwd,
      }),
      input.abortController.signal,
      () => undefined,
    );
    if (input.abortController.signal.aborted) {
      lease.release();
      throw Object.assign(new Error("aborted"), { name: "AbortError" });
    }

    const { client } = lease.value;
    const denyAll = async () => ({ kind: "denied", message: "压缩回合不允许使用工具" });
    let session: Awaited<ReturnType<CopilotSdkClient["createSession"]>>;
    try {
      session = await raceAbort(
        client.createSession(
          copilotCompactSessionConfigOf(input, { denyAll }),
        ),
        input.abortController.signal,
        () => undefined,
      );
    } catch (error) {
      lease.release();
      throw error;
    }

    let settled = false;
    const waitIdle = new Promise<void>((resolve) => {
      const finish = () => {
        if (settled) return;
        settled = true;
        resolve();
      };
      try {
        session.on("session.idle", finish);
        session.on("session.error", finish);
        session.on("error", finish);
      } catch {
        /* ignore */
      }
      input.abortController.signal.addEventListener("abort", finish, { once: true });
    });

    const onAbort = () => {
      void Promise.resolve(session.abort?.()).catch(() => undefined);
    };
    input.abortController.signal.addEventListener("abort", onAbort, { once: true });

    try {
      await raceAbort(
        session.send(copilotCompactSendOptionsOf(input)),
        input.abortController.signal,
        onAbort,
      );
      const messages = mirrorCopilotSession(session, waitIdle);
      return await collectCompactSummary(messages, {
        normalizeResult: workerResultFromCopilotMessage,
      });
    } finally {
      input.abortController.signal.removeEventListener("abort", onAbort);
      await session.disconnect().catch(() => undefined);
      lease.release();
    }
  },
};

function throwIfAborted(signal: AbortSignal, cleanup?: () => void): void {
  if (!signal.aborted) return;
  cleanup?.();
  throw Object.assign(new Error("aborted"), { name: "AbortError" });
}

/** 把长时间 await（冷启 CLI / createSession / send）接到 Composer 停止。 */
function raceAbort<T>(
  promise: Promise<T>,
  signal: AbortSignal,
  onAbort: () => void,
): Promise<T> {
  if (signal.aborted) {
    onAbort();
    return Promise.reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
  }
  return new Promise<T>((resolve, reject) => {
    const onSig = () => {
      onAbort();
      reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
    };
    signal.addEventListener("abort", onSig, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener("abort", onSig);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener("abort", onSig);
        reject(error);
      },
    );
  });
}
