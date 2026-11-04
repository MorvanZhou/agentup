import type {
  ExternalDriver,
  ExternalDriverCapabilities,
  ExternalLoginInput,
  ExternalTurnHandle,
  ExternalTurnRequest,
  WorkerResult,
} from "../../contract.js";
import { hasDshApiKey } from "./home.js";
import {
  checkDshLogin,
  fetchDshModels,
  logoutDsh,
  startDshLogin,
} from "./lifecycle.js";
import { loadDshModule, type DshHarness, type DshHarnessNotification } from "./load.js";
import { dshHarnessOptionsOf, runDshAskUser } from "./options.js";
import { mirrorDshRun, workerResultFromDshMessage } from "./stream.js";

const CAPABILITIES: ExternalDriverCapabilities = {
  driverId: "dsh",
  // env + cordis 覆盖 system-prompt.personaPrefix（完整 sdk 不内建读 env）
  systemPromptMode: "replace",
  askUserToolNames: ["ask_user", "ask_user_question", "AskUserQuestion"],
};

/**
 * DeepSeek Harness ExternalDriver。
 * 启流：DeepSeekHarness → run + onNotification；每轮新 session，不 resume。
 * abort = close()（官方无 mid-turn cancel）。
 */
export const dshDriver: ExternalDriver = {
  capabilities: CAPABILITIES,

  async login(input: ExternalLoginInput) {
    const result = await startDshLogin(input.userDataRoot, input.templateId);
    if (result.auth_url) input.onAuthUrl(result.auth_url);
    return {
      authUrl: result.auth_url,
      state: result.state,
      ...(result.account_label ? { accountLabel: result.account_label } : {}),
    };
  },

  async logout(input) {
    await logoutDsh(input.userDataRoot, input.templateId);
  },

  async probeReady(input) {
    try {
      const result = await checkDshLogin(input.userDataRoot, input.templateId);
      return result.state === "ready" ? "ready" : "not_logged_in";
    } catch {
      return "error";
    }
  },

  async listModels(input) {
    return fetchDshModels(input.userDataRoot, input.templateId);
  },

  async startTurn(input: ExternalTurnRequest): Promise<ExternalTurnHandle> {
    if (!hasDshApiKey(input.userDataRoot, input.templateId)) {
      throw new Error("尚未登录 DeepSeek Harness（请先在设置里粘贴 API Key）");
    }

    const sdk = await loadDshModule(input.userDataRoot, input.templateId);
    const { options } = dshHarnessOptionsOf(input);

    if (input.askUser) {
      options.onUserQuestion = async (
        request: unknown,
        context?: { signal?: AbortSignal },
      ) => {
        if (context?.signal?.aborted || input.abortController.signal.aborted) {
          return { cancelled: true };
        }
        return runDshAskUser(input, request);
      };
    }

    const harness: DshHarness = new sdk.DeepSeekHarness(options);

    // 信任：审批恒 allowed-once（须在 start 前挂 onRequest）
    harness.client.start();
    harness.client.onRequest(async (method) => {
      if (method !== "approval/request") {
        throw new Error(`Unsupported request: ${method}`);
      }
      return { outcome: "allowed-once" };
    });

    if (input.abortController.signal.aborted) {
      await harness.close().catch(() => undefined);
      throw Object.assign(new Error("aborted"), { name: "AbortError" });
    }

    let pushNotification: ((n: DshHarnessNotification) => void) | null = null;
    const runPromise = (async () => {
      await harness.start();
      return harness.run(input.prompt, {
        onNotification: (notification) => {
          pushNotification?.(notification);
        },
      });
    })();

    const onAbort = () => {
      void harness.close().catch(() => undefined);
    };
    input.abortController.signal.addEventListener("abort", onAbort, { once: true });

    const messages = mirrorDshRun(runPromise, (push) => {
      pushNotification = push;
    });

    return {
      messages,
      abort: () => {
        input.abortController.abort();
        void harness.close().catch(() => undefined);
      },
      close: async () => {
        input.abortController.signal.removeEventListener("abort", onAbort);
        await harness.close().catch(() => undefined);
      },
    };
  },

  normalizeResult(message: unknown): WorkerResult | null {
    return workerResultFromDshMessage(message);
  },
};
