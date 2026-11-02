import { expect, it, vi } from "vitest";

import type { ModelConfig } from "../src/config/load.js";
import type { Visit } from "../src/package/sync.js";
import { FollowUpQueueFull } from "../src/session/turn/follow-up-queue.js";
import { VisitChats } from "../src/session/turn/visit-chats.js";
import type { PromptSession } from "../src/session/turn/types.js";

type Hook = (text: string, chats: VisitChats) => void;

/** 假会话：prompt 里挂钩子，用来在「回合进行中」操作 followUp 队列。 */
function fakeSession(onPrompt?: (text: string) => void): PromptSession {
  return {
    subscribe: () => () => undefined,
    prompt: vi.fn(async (text: string) => {
      onPrompt?.(text);
    }),
    sendCustomMessage: vi.fn(async () => undefined),
    abort: async () => undefined,
    dispose: () => undefined,
  } as unknown as PromptSession;
}

const visit = {
  userId: "u1",
  agentId: "a1",
  kind: "recruited",
  root: "/tmp/visit-a1",
  packageDigest: "digest-1",
} as unknown as Visit;

const sdkModel = {
  providerId: "codebuddy",
  templateId: "codebuddy-sdk",
  modelId: "claude-sonnet-5",
  apiKey: "ollama",
} as ModelConfig;

const apiModel = { ...sdkModel, templateId: "deepseek" } as ModelConfig;

function chatsWith(hook?: Hook): { chats: VisitChats; sessions: PromptSession[] } {
  const sessions: PromptSession[] = [];
  let chats!: VisitChats;
  chats = new VisitChats(async () => {
    const session = fakeSession((text) => hook?.(text, chats));
    sessions.push(session);
    return session;
  });
  return { chats, sessions };
}

/** 跑完一整轮（把流消费掉），hook 会在 busy=true 时回调。 */
async function runTurn(chats: VisitChats): Promise<void> {
  const stream = await chats.promptStream(visit, sdkModel, "第一句", undefined, undefined, [], "zh");
  for await (const _chunk of stream) void _chunk;
}

it("本地 Agent App（SDK）用队列，API Key 接入不用", () => {
  const chats = new VisitChats(async () => fakeSession());
  expect(chats.usesFollowUpQueue(sdkModel)).toBe(true);
  expect(chats.usesFollowUpQueue(apiModel)).toBe(false);
});

it("会话没在跑时不允许排队（不静默吞掉用户的话）", () => {
  const chats = new VisitChats(async () => fakeSession());
  expect(() => chats.enqueueFollowUp(visit, "喂")).toThrow();
  expect(chats.listFollowUps(visit)).toEqual([]);
});

it("回合进行中排队 → 回合结束后按排队顺序拼成一条，只开一轮", async () => {
  const { chats, sessions } = chatsWith((text, self) => {
    if (text !== "第一句") return;
    self.enqueueFollowUp(visit, "插话一");
    self.enqueueFollowUp(visit, "插话二");
  });

  await runTurn(chats);

  // 原句一轮 + 整串插话合成的一轮（不是一条一轮）
  await vi.waitFor(() => {
    expect(sessions[0]?.prompt).toHaveBeenCalledTimes(2);
  });
  const calls = (sessions[0]?.prompt as unknown as { mock: { calls: string[][] } }).mock.calls;
  expect(calls.map((call) => call[0])).toEqual(["第一句", "插话一\n插话二"]);
  expect(chats.listFollowUps(visit)).toEqual([]);
});

it("消费前先把用户这条发到旁路流：顺序是「用户 → 助手」", async () => {
  const chunks: Array<{ type: string; data?: unknown }> = [];
  const { chats } = chatsWith((text, self) => {
    if (text !== "第一句") return;
    self.enqueueFollowUp(visit, "插话一");
    self.enqueueFollowUp(visit, "插话二");
  });
  chats.subscribeTurnStream(visit.userId, visit.agentId, (chunk) => {
    chunks.push(chunk as { type: string; data?: unknown });
  });

  await runTurn(chats);

  await vi.waitFor(() => {
    expect(chunks.some((chunk) => chunk.type === "data-agentup-follow-up-sent")).toBe(true);
  });
  const echo = chunks.find((chunk) => chunk.type === "data-agentup-follow-up-sent");
  // 拼好的整串，不是单条
  expect(echo?.data).toMatchObject({ text: "插话一\n插话二" });
  // 必须排在助手正文之前：桌面靠它决定先渲染用户气泡
  const firstTextAt = chunks.findIndex((chunk) => chunk.type === "text-delta");
  const echoAt = chunks.findIndex((chunk) => chunk.type === "data-agentup-follow-up-sent");
  expect(echoAt).toBeGreaterThanOrEqual(0);
  expect(firstTextAt === -1 ? true : echoAt < firstTextAt).toBe(true);
});

it("消费轮进行中又排了新话 → 这轮结束后接着再开一轮消费", async () => {
  // 用户在第二条（消费轮）流式输出时又发了一条：不能躺到下次 prompt 才被看见
  const { chats, sessions } = chatsWith((text, self) => {
    if (text === "第一句") {
      self.enqueueFollowUp(visit, "插话一");
    } else if (text === "插话一") {
      self.enqueueFollowUp(visit, "插话二");
    }
  });

  await runTurn(chats);

  await vi.waitFor(() => {
    expect(sessions[0]?.prompt).toHaveBeenCalledTimes(3);
  });
  const calls = (sessions[0]?.prompt as unknown as { mock: { calls: string[][] } }).mock.calls;
  expect(calls.map((call) => call[0])).toEqual(["第一句", "插话一", "插话二"]);
  expect(chats.listFollowUps(visit)).toEqual([]);
});

it("队列管理：编辑 / 置顶 / 删除都生效", async () => {
  const { chats } = chatsWith((text, self) => {
    if (text !== "第一句") return;
    const first = self.enqueueFollowUp(visit, "一");
    const second = self.enqueueFollowUp(visit, "二");
    self.enqueueFollowUp(visit, "三");
    self.updateFollowUp(visit, second.id, "二改");
    self.promoteFollowUp(visit, second.id);
    self.removeFollowUp(visit, first.id);
    expect(self.listFollowUps(visit).map((item) => item.text)).toEqual(["二改", "三"]);
  });

  await runTurn(chats);
});

it("队列满（5 条）时拒绝入队", async () => {
  const { chats } = chatsWith((text, self) => {
    if (text !== "第一句") return;
    for (let index = 0; index < 5; index += 1) self.enqueueFollowUp(visit, `第 ${index} 条`);
    expect(() => self.enqueueFollowUp(visit, "第六条")).toThrow(FollowUpQueueFull);
    expect(self.listFollowUps(visit)).toHaveLength(5);
  });

  await runTurn(chats);
});

it("停止当前轮时保留队列，用户确认继续后才消费", async () => {
  let release: (() => void) | undefined;
  const prompt = vi.fn(
    (text: string) =>
      text === "第一句"
        ? new Promise<void>((resolve) => {
            release = resolve;
          })
        : Promise.resolve(),
  );
  const session = {
    ...fakeSession(),
    prompt,
    abort: vi.fn(async () => release?.()),
  } as PromptSession;
  const chats = new VisitChats(async () => session);
  const controller = new AbortController();
  const stream = await chats.promptStream(
    visit,
    sdkModel,
    "第一句",
    controller.signal,
    undefined,
    [],
    "zh",
  );
  const consume = (async () => {
    for await (const _chunk of stream) void _chunk;
  })();

  await vi.waitFor(() => expect(prompt).toHaveBeenCalledTimes(1));
  chats.enqueueFollowUp(visit, "停止后继续");
  controller.abort();
  await consume;

  expect(chats.listFollowUps(visit).map((item) => item.text)).toEqual(["停止后继续"]);
  expect(prompt).toHaveBeenCalledTimes(1);
  expect(chats.resumeFollowUps(visit)).toBe(true);
  await vi.waitFor(() => expect(prompt).toHaveBeenCalledTimes(2));
  expect(prompt).toHaveBeenLastCalledWith(
    "停止后继续",
    expect.objectContaining({ expandPromptTemplates: false }),
  );
});

it("通过 abort API 停止 SDK 直连回合时会中断 SDK controller", async () => {
  const sdkController = new AbortController();
  const externalQuery = vi.fn(async () => ({
    controller: sdkController,
    iterable: (async function* () {
      await new Promise<void>((resolve) => {
        sdkController.signal.addEventListener("abort", () => resolve(), { once: true });
      });
    })(),
    timeoutMs: 10_000,
  }));
  const session = {
    ...fakeSession(),
    externalQuery,
    abort: vi.fn(async () => undefined),
  } as unknown as PromptSession;
  const chats = new VisitChats(async () => session);
  const stream = await chats.promptStream(visit, sdkModel, "第一句");
  const consume = (async () => {
    for await (const _chunk of stream) void _chunk;
  })();

  await vi.waitFor(() => expect(externalQuery).toHaveBeenCalledOnce());
  await chats.abort(visit.userId, visit.agentId, visit.kind);
  await consume;

  expect(sdkController.signal.aborted).toBe(true);
  expect(session.abort).toHaveBeenCalledOnce();
});

it("follow-up 起流失败时放回原队列，不静默丢消息或自动重试", async () => {
  let releaseFirst: (() => void) | undefined;
  const externalQuery = vi
    .fn()
    .mockImplementationOnce(async () => ({
      controller: new AbortController(),
      iterable: (async function* () {
        await new Promise<void>((resolve) => {
          releaseFirst = resolve;
        });
        yield { type: "result", subtype: "success", result: "第一轮完成" };
      })(),
      timeoutMs: 10_000,
    }))
    .mockRejectedValueOnce(new Error("SDK 起流失败"));
  const session = {
    ...fakeSession(),
    externalQuery,
  } as unknown as PromptSession;
  const chats = new VisitChats(async () => session);
  const stream = await chats.promptStream(visit, sdkModel, "第一句");
  const consume = (async () => {
    for await (const _chunk of stream) void _chunk;
  })();

  await vi.waitFor(() => expect(releaseFirst).toBeTypeOf("function"));
  chats.enqueueFollowUp(visit, "不能丢");
  releaseFirst?.();
  await consume;
  await vi.waitFor(() => expect(externalQuery).toHaveBeenCalledTimes(2));
  await vi.waitFor(() => expect(chats.busy(visit.userId, visit.agentId, visit.kind)).toBe(false));

  expect(chats.listFollowUps(visit).map((item) => item.text)).toEqual(["不能丢"]);
  expect(externalQuery).toHaveBeenCalledTimes(2);
});
