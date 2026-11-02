import { expect, it, vi } from "vitest";

import type { ModelConfig } from "../src/config/load.js";
import type { Visit } from "../src/package/sync.js";
import { VisitChats } from "../src/session/turn/visit-chats.js";
import type { PromptSession } from "../src/session/turn/types.js";

/**
 * 主会话的插话语义（docs/agent_cli §12.8）：
 * API / Pi 原生 → Pi 原生 steer（保留已做的工作）；本地 Agent App（SDK）→ followUp 队列。
 */

const visit = {
  userId: "u1",
  agentId: "a1",
  kind: "recruited",
  root: "/tmp/visit-a1",
  packageDigest: "digest-1",
} as unknown as Visit;

const apiModel = {
  providerId: "deepseek",
  templateId: "deepseek",
  modelId: "deepseek-chat",
  apiKey: "k",
} as ModelConfig;

const sdkModel = { ...apiModel, providerId: "codebuddy", templateId: "codebuddy-sdk" } as ModelConfig;

/** 假会话：`prompt` 挂起，回调里可以在 busy 中插话。 */
function fakeSession(onPrompt: (text: string) => void): PromptSession {
  return {
    subscribe: () => () => undefined,
    prompt: vi.fn(async (text: string) => {
      onPrompt(text);
    }),
    steer: vi.fn(async () => ({ queued: true })),
    abort: async () => undefined,
    dispose: () => undefined,
  } as unknown as PromptSession;
}

function chatsWith(hook: (text: string, chats: VisitChats) => void): {
  chats: VisitChats;
  session: () => PromptSession;
} {
  let opened: PromptSession | undefined;
  let chats!: VisitChats;
  chats = new VisitChats(async () => {
    opened = fakeSession((text) => hook(text, chats));
    return opened;
  });
  return { chats, session: () => opened! };
}

it("回合进行中：API 接入走 Pi 原生 steer，不打断当前轮", async () => {
  const { chats, session } = chatsWith(async (text, self) => {
    if (text !== "第一句") return;
    const outcome = await self.steer(visit, apiModel, "改成北京");
    expect(outcome.steered).toBe(true);
  });

  const stream = await chats.promptStream(visit, apiModel, "第一句", undefined, undefined, [], "zh");
  for await (const _chunk of stream) void _chunk;

  expect(session().steer).toHaveBeenCalledWith("改成北京");
  // steer 不另起一轮：本轮 prompt 只跑过一次
  expect(session().prompt).toHaveBeenCalledTimes(1);
});

it("外部 agent（SDK）接入不接 steer：那边是 followUp 队列", async () => {
  const { chats, session } = chatsWith(async (text, self) => {
    if (text !== "第一句") return;
    const outcome = await self.steer(visit, sdkModel, "改成北京");
    expect(outcome.steered).toBe(false);
  });

  const stream = await chats.promptStream(visit, sdkModel, "第一句", undefined, undefined, [], "zh");
  for await (const _chunk of stream) void _chunk;

  expect(session().steer).not.toHaveBeenCalled();
});

it("会话没在跑 / 空文本 / 会话没有 steer：都返回 false，交给调用方走重发", async () => {
  const chats = new VisitChats(async () => fakeSession(() => undefined));
  await expect(chats.steer(visit, apiModel, "喂")).resolves.toEqual({ steered: false });

  const { chats: busy } = chatsWith(async (text, self) => {
    if (text !== "第一句") return;
    await expect(self.steer(visit, apiModel, "   ")).resolves.toEqual({ steered: false });
  });
  const stream = await busy.promptStream(visit, apiModel, "第一句", undefined, undefined, [], "zh");
  for await (const _chunk of stream) void _chunk;

  // 没有 steer 方法的会话（老 Pi / 外部 agent）
  const plain = new VisitChats(async () => ({
    subscribe: () => () => undefined,
    prompt: async () => undefined,
    abort: async () => undefined,
    dispose: () => undefined,
  }) as unknown as PromptSession);
  await expect(plain.steer(visit, apiModel, "喂")).resolves.toEqual({ steered: false });
});
