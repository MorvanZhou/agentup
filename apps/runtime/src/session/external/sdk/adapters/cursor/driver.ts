import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";

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
import { readCursorApiKey } from "./credentials.js";
import {
  checkCursorLogin,
  fetchCursorModels,
  logoutCursor,
  startCursorLogin,
} from "./lifecycle.js";
import { loadCursorModule } from "./load.js";
import {
  cursorCompactCreateOptionsOf,
  cursorCompactPromptOf,
  cursorCreateOptionsOf,
  cursorTurnPromptOf,
} from "./options.js";
import { mirrorCursorRun, workerResultFromCursorMessage } from "./stream.js";

const CAPABILITIES: ExternalDriverCapabilities = {
  driverId: "cursor",
  // 多数账号未开通 Custom system prompt；用 prompt 前缀注入 Host context
  systemPromptMode: "prompt_prefix",
  // customTools → MCP custom-user-tools；stream 解包成 ask_user
  askUserToolNames: ["ask_user", "agentup_ask_user"],
  // 无硬 deny；靠空 cwd + 无 MCP/tools + 压缩 prompt
  compactSummarize: true,
};

/**
 * Cursor ExternalDriver。
 * 启流：Agent.create → send → stream；每轮新 agent + 临时 Jsonl store，不 resume。
 */
export const cursorDriver: ExternalDriver = {
  capabilities: CAPABILITIES,

  async login(input: ExternalLoginInput) {
    const result = await startCursorLogin(input.userDataRoot, input.templateId);
    if (result.auth_url) input.onAuthUrl(result.auth_url);
    return {
      authUrl: result.auth_url,
      state: result.state,
      ...(result.account_label ? { accountLabel: result.account_label } : {}),
    };
  },

  async logout(input) {
    await logoutCursor(input.userDataRoot, input.templateId);
  },

  async probeReady(input) {
    try {
      const result = await checkCursorLogin(input.userDataRoot, input.templateId);
      if (result.state === "ready") return "ready";
      return "not_logged_in";
    } catch {
      return "error";
    }
  },

  async listModels(input) {
    return fetchCursorModels(input.userDataRoot, input.templateId);
  },

  async startTurn(input: ExternalTurnRequest): Promise<ExternalTurnHandle> {
    const sdk = await loadCursorModule(input.userDataRoot, input.templateId);
    const apiKey = await readCursorApiKey(input.userDataRoot, input.templateId);
    if (!apiKey) throw new Error("尚未登录 Cursor");

    const storeDir = path.join(
      os.tmpdir(),
      "agentup-cursor-store",
      `${input.templateId}-${randomUUID()}`,
    );
    fs.mkdirSync(storeDir, { recursive: true });
    const JsonlStore = sdk.JsonlLocalAgentStore;
    if (typeof JsonlStore !== "function") {
      throw new Error("Cursor SDK 缺少 JsonlLocalAgentStore");
    }
    const localStore = new JsonlStore(storeDir);

    const agent = await sdk.Agent.create(
      cursorCreateOptionsOf(input, { apiKey, localStore }),
    );

    let run: Awaited<ReturnType<typeof agent.send>> | undefined;
    const onAbort = () => {
      void Promise.resolve(run?.cancel()).catch(() => undefined);
    };
    if (input.abortController.signal.aborted) {
      await Promise.resolve(agent.close()).catch(() => undefined);
      fs.rmSync(storeDir, { recursive: true, force: true });
      throw Object.assign(new Error("aborted"), { name: "AbortError" });
    }

    input.abortController.signal.addEventListener("abort", onAbort, { once: true });
    try {
      // context 进 prompt 前缀，不碰 systemPrompt（未开通账号会 invalid_argument）
      run = await agent.send(cursorTurnPromptOf(input));
    } catch (error) {
      input.abortController.signal.removeEventListener("abort", onAbort);
      await Promise.resolve(agent.close()).catch(() => undefined);
      fs.rmSync(storeDir, { recursive: true, force: true });
      throw error;
    }

    const messages = mirrorCursorRun(agent, run);
    return {
      messages,
      abort: () => {
        input.abortController.abort();
        void Promise.resolve(run?.cancel()).catch(() => undefined);
      },
      close: async () => {
        input.abortController.signal.removeEventListener("abort", onAbort);
        try {
          await Promise.resolve(run?.cancel()).catch(() => undefined);
        } finally {
          await Promise.resolve(agent.close()).catch(() => undefined);
          fs.rmSync(storeDir, { recursive: true, force: true });
        }
      },
    };
  },

  normalizeResult(message: unknown): WorkerResult | null {
    return workerResultFromCursorMessage(message);
  },

  async compactSummarize(input: ExternalCompactRequest): Promise<string> {
    const sdk = await loadCursorModule(input.userDataRoot, input.templateId);
    const apiKey = await readCursorApiKey(input.userDataRoot, input.templateId);
    if (!apiKey) throw new Error("尚未登录 Cursor");

    const storeDir = path.join(
      os.tmpdir(),
      "agentup-cursor-compact",
      `${input.templateId}-${randomUUID()}`,
    );
    fs.mkdirSync(storeDir, { recursive: true });
    const JsonlStore = sdk.JsonlLocalAgentStore;
    if (typeof JsonlStore !== "function") {
      throw new Error("Cursor SDK 缺少 JsonlLocalAgentStore");
    }
    const localStore = new JsonlStore(storeDir);
    const agent = await sdk.Agent.create(
      cursorCompactCreateOptionsOf(input, { apiKey, localStore }),
    );

    let run: Awaited<ReturnType<typeof agent.send>> | undefined;
    const onAbort = () => {
      void Promise.resolve(run?.cancel()).catch(() => undefined);
    };
    input.abortController.signal.addEventListener("abort", onAbort, { once: true });
    try {
      run = await agent.send(cursorCompactPromptOf(input));
      const messages = mirrorCursorRun(agent, run);
      return await collectCompactSummary(messages, {
        normalizeResult: workerResultFromCursorMessage,
      });
    } finally {
      input.abortController.signal.removeEventListener("abort", onAbort);
      try {
        await Promise.resolve(run?.cancel()).catch(() => undefined);
      } finally {
        await Promise.resolve(agent.close()).catch(() => undefined);
        fs.rmSync(storeDir, { recursive: true, force: true });
      }
    }
  },
};
