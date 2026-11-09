import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, expect, it, vi } from "vitest";

import { PERSONAL_ASSISTANT_ID } from "../src/local/assistant/personal-assistant.js";
import { ApprovalBroker } from "../src/session/hitl/approval/index.js";
import { DelegationService } from "../src/session/delegation/index.js";
import type { DelegationStartedEvent } from "../src/session/delegation/progress.js";

vi.mock("../src/session/delegation/run.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/session/delegation/run.js")>();
  return {
    ...actual,
    // 不跑真专员回合：只验证派出时 started 已带模型。
    runDelegatedPrompt: vi.fn(async () => ({
      text: "",
      error: undefined,
      artifactsConfirmed: false,
      artifacts: [],
    })),
  };
});

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

function seedWeatherAgent(root: string): void {
  const agentRoot = path.join(root, "users", "patient", "agents", "weather");
  fs.mkdirSync(path.join(agentRoot, "cwd", ".pi"), { recursive: true });
  fs.writeFileSync(
    path.join(agentRoot, "instance.json"),
    `${JSON.stringify({
      user_id: "patient",
      agent_id: "weather",
      name: "天气通",
      role: "气象顾问",
      background: "本地天气预报",
      package_version: 1,
      package_digest: "abc",
      project_trust: "granted",
      tools: [],
      model_capabilities: [],
    })}\n`,
  );
  fs.writeFileSync(
    path.join(agentRoot, "cwd", ".pi", "SYSTEM.md"),
    "你是天气通。\n",
  );
}

it("delegateFanout 在专员开跑前就把 replyModel 写进 started 事件", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "agentup-deleg-started-model-"));
  roots.push(root);
  seedWeatherAgent(root);

  const service = new DelegationService({
    userDataRoot: root,
    backendUrl: "http://127.0.0.1:9",
    getModel: () => ({
      providerId: "openai",
      templateId: "openai",
      modelId: "gpt-4o",
      apiKey: "k",
      kind: "openai" as const,
    }),
    approvals: new ApprovalBroker(),
    askUser: { request: vi.fn(), answer: vi.fn(), subscribe: vi.fn() } as never,
  });

  const started: DelegationStartedEvent[] = [];
  const stop = service.subscribeStarted((event) => {
    started.push(event);
  });

  const result = await service.delegateFanout({
    userId: "patient",
    fromAgentId: PERSONAL_ASSISTANT_ID,
    items: [{ toAgentId: "weather", brief: "查天气" }],
    wait: false,
    toolCallId: "tool-weather-1",
  });
  stop();

  expect(result.tasks).toHaveLength(1);
  expect(started.length).toBeGreaterThanOrEqual(1);
  const first = started[0]!;
  expect(first.toolCallId).toBe("tool-weather-1");
  expect(first.replyModel).toMatchObject({
    templateId: "openai",
    modelId: "gpt-4o",
    vendorId: "openai",
  });
  expect(result.tasks[0]?.replyModel).toMatchObject({
    templateId: "openai",
    modelId: "gpt-4o",
  });
});
