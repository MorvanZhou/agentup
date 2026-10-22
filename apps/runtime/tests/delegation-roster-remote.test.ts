import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { expect, it, vi } from "vitest";

vi.mock("../src/control/client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/control/client.js")>();
  return {
    ...actual,
    listAgents: vi.fn(),
  };
});

import { listAgents } from "../src/control/client.js";
import { ApprovalBroker } from "../src/session/hitl/approval/index.js";
import { DelegationService } from "../src/session/delegation/index.js";
import {
  discoverRecruitedAgents,
  formatDiscoveredAgentsContext,
} from "../src/session/delegation/discover.js";

it("lists roster from local disk only and does not call backend listAgents", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "agentup-deleg-local-only-"));
  const now = new Date().toISOString();
  const localId = "loc-abcd1234ef";
  const localRoot = path.join(root, "users", "patient", "agents", localId);
  fs.mkdirSync(path.join(localRoot, "cwd", ".pi"), { recursive: true });
  fs.writeFileSync(
    path.join(localRoot, "instance.json"),
    `${JSON.stringify({
      kind: "local",
      user_id: "patient",
      agent_id: localId,
      name: "图图",
      role: "信息图大师",
      background: "根据资料绘制信息图",
      package_version: 1,
      package_digest: "localdigest",
      active_session_id: "main",
      tools: [],
      model_capabilities: ["tools"],
      project_trust: "granted",
      created_at: now,
      updated_at: now,
    })}\n`,
  );

  const marketRoot = path.join(root, "users", "patient", "agents", "hJsAC7Ph");
  fs.mkdirSync(path.join(marketRoot, "cwd", ".pi"), { recursive: true });
  fs.writeFileSync(
    path.join(marketRoot, "instance.json"),
    `${JSON.stringify({
      user_id: "patient",
      agent_id: "hJsAC7Ph",
      package_version: 1,
      package_digest: "m",
      project_trust: "granted",
      tools: [],
      model_capabilities: [],
    })}\n`,
  );
  fs.writeFileSync(
    path.join(marketRoot, "cwd", ".pi", "SYSTEM.md"),
    "你是 Weaty。岗位：气象学家。\n\n天气查询\n",
  );

  const service = new DelegationService({
    userDataRoot: root,
    backendUrl: "http://127.0.0.1:9",
    getModel: () => ({
      providerId: "ollama",
      templateId: "ollama",
      modelId: "m",
      apiKey: "k",
      baseUrl: "http://127.0.0.1:11434/v1",
      kind: "ollama" as const,
    }),
    approvals: new ApprovalBroker(),
    askUser: { request: vi.fn(), answer: vi.fn(), subscribe: vi.fn() } as never,
  });
  // 即使绑了 token，发现仍只走本机。
  service.bindAuth("patient", "token");

  const agents = await service.listRecruited("patient");
  expect(vi.mocked(listAgents)).not.toHaveBeenCalled();
  expect(agents.map((item) => item.agentId).sort()).toEqual(["hJsAC7Ph", localId].sort());

  const discovered = discoverRecruitedAgents(agents, "帮我画信息图");
  expect(discovered.agents.some((item) => item.agentId === localId)).toBe(true);
  expect(formatDiscoveredAgentsContext(discovered)).toContain("图图");
});
