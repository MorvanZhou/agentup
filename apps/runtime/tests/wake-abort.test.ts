import path from "node:path";

import { expect, it } from "vitest";

import type { Visit } from "../src/package/sync.js";
import { VisitChats } from "../src/session/turn/index.js";

const model = {
  providerId: "ollama",
  templateId: "ollama",
  modelId: "qwen",
  apiKey: "ollama",
  baseUrl: "http://127.0.0.1:11434/v1",
  kind: "ollama" as const,
};

function visitFixture(): Visit {
  return {
    userId: "patient-a",
    agentId: "personal-assistant",
    kind: "personal",
    root: path.join(osTmp(), "agentup-wake-abort-visit"),
    packageVersion: 1,
    packageDigest: "digest",
    tools: [],
    modelCapabilities: [],
    projectTrust: "granted",
  };
}

function osTmp(): string {
  return process.env.TMPDIR || "/tmp";
}

/**
 * 复现：取消异步 → wake 占 busy → 用户重发 409 abort wake →
 * 旧逻辑会立刻再开 wake，与重试 prompt 抢锁导致卡死。
 */
it("aborted async wake does not immediately restart; next user prompt can start", async () => {
  let releaseWake: () => void = () => undefined;
  const wakeGate = new Promise<void>((resolve) => {
    releaseWake = resolve;
  });
  let wakeStarts = 0;
  const prompts: string[] = [];
  const visit = visitFixture();

  const chats = new VisitChats(
    async () => ({
      subscribe() {
        return () => undefined;
      },
      async prompt(text) {
        prompts.push(text);
      },
      async sendCustomMessage(_message, options) {
        if (options && "triggerTurn" in options && options.triggerTurn) {
          wakeStarts += 1;
          await wakeGate;
          throw new Error("aborted");
        }
      },
      async abort() {
        releaseWake();
      },
      dispose() {},
    }),
    undefined,
    undefined,
    undefined,
    {
      resolveVisit: async () => visit,
      resolveModel: () => model,
    },
  );

  chats.enqueueAsyncWake({
    id: "delegation:task-1",
    userId: visit.userId,
    agentId: visit.agentId,
    kind: "personal",
    urgency: "immediate",
    body: "【委托已取消】专家已停止",
    markDelivered: () => undefined,
  });

  await waitFor(() => chats.busy(visit.userId, visit.agentId, "personal"));
  expect(wakeStarts).toBe(1);

  await chats.abort(visit.userId, visit.agentId, "personal");
  expect(chats.busy(visit.userId, visit.agentId, "personal")).toBe(false);

  await new Promise((resolve) => setTimeout(resolve, 40));
  expect(wakeStarts).toBe(1);

  const stream = await chats.promptStream(visit, model, "重新画一个太阳");
  const reader = stream.getReader();
  while (!(await reader.read()).done) {
    /* drain */
  }
  expect(prompts).toEqual(["重新画一个太阳"]);
  expect(wakeStarts).toBe(1);
});

async function waitFor(predicate: () => boolean, ms = 500): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > ms) throw new Error("timeout waiting for condition");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}
