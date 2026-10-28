import os from "node:os";
import path from "node:path";

import { beforeEach, expect, it, vi } from "vitest";

import type { ModelConfig } from "../src/config/load.js";
import type { Visit } from "../src/package/sync.js";
import { openProfiledSession } from "../src/session/core/session-factory.js";
import { ApprovalBroker } from "../src/session/hitl/approval/index.js";
import { AskUserBroker } from "../src/session/tools/index.js";

const created: Array<{ tools?: string[]; sessionManager: { sessionDir: string; fresh?: boolean } }> = [];

vi.mock("@earendil-works/pi-coding-agent", () => ({
  createAgentSession: vi.fn(async (options: { tools?: string[]; sessionManager: { sessionDir: string; fresh?: boolean } }) => {
    created.push(options);
    return { session: { dispose() {}, bindExtensions: vi.fn(async () => undefined) } };
  }),
  buildSessionContext: () => ({ messages: [] }),
  defineTool: (tool: unknown) => tool,
  ModelRuntime: {
    create: async () => {
      const models = new Map<string, unknown>();
      return {
        registerNativeProvider: () => {},
        setRuntimeApiKey: async () => {},
        registerProvider: (provider: string, config: { baseUrl: string; api: string; apiKey: string; models: Array<{ id: string }> }) => {
          for (const entry of config.models) {
            models.set(`${provider}/${entry.id}`, { ...entry, provider, baseUrl: config.baseUrl, api: config.api, apiKey: config.apiKey });
          }
        },
        getModel: (provider: string, id: string) => models.get(`${provider}/${id}`),
      };
    },
  },
  SessionManager: {
    continueRecent: (cwd: string, sessionDir: string) => ({
      cwd,
      sessionDir,
      fresh: false,
      getEntries: () => [],
      getSessionFile: () => undefined,
    }),
    create: (_cwd: string, sessionDir: string) => ({
      getSessionFile: () => path.join(sessionDir, "fresh.jsonl"),
    }),
    open: (file: string, sessionDir: string, cwd: string) => ({
      cwd,
      sessionDir,
      file,
      fresh: true,
      getEntries: () => [],
      getSessionFile: () => file,
    }),
  },
  SettingsManager: {
    create: (cwd: string, agentDir: string, options: unknown) => ({ cwd, agentDir, options }),
  },
  DefaultResourceLoader: class {
    options: unknown;
    constructor(options: unknown) {
      this.options = options;
    }
    async reload() {}
  },
  createToolSearchExtension: () => ({ name: "tool_search" }),
  createCodemodeExtension: () => ({ name: "codemode" }),
  createMcpExtension: () => ({ name: "mcp" }),
}));

const model: ModelConfig = {
  providerId: "ollama",
  templateId: "ollama",
  modelId: "qwen",
  apiKey: "ollama",
  baseUrl: "http://localhost:11434/v1",
  kind: "ollama",
};

function visit(): Visit {
  return {
    userId: "patient",
    agentId: "tax-advisor",
    root: path.join(os.tmpdir(), "agentup-data", "users", "patient", "agents", "tax-advisor"),
    packageVersion: 1,
    packageDigest: "abc",
    tools: ["read", "bash"],
    modelCapabilities: ["tools"],
    projectTrust: "granted",
  };
}

beforeEach(() => {
  created.length = 0;
});

it("continues a one-to-one session without the delegation delivery tool", async () => {
  await openProfiledSession({
    kind: "interactive",
    visit: visit(),
    model,
    approvals: new ApprovalBroker(),
    askUser: new AskUserBroker(),
  });
  expect(created[0]?.tools).not.toContain("deliver_artifacts");
  expect(created[0]?.sessionManager.fresh).toBe(false);
  expect(created[0]?.sessionManager.sessionDir).toBe(path.join(visit().root, "sessions"));
});

it("opens a delegation child in a fresh session that can deliver artifacts", async () => {
  const sessionDir = path.join(os.tmpdir(), "agentup-delegation-factory", "task-1", "sessions");
  await openProfiledSession({
    kind: "delegation",
    visit: visit(),
    model,
    approvals: new ApprovalBroker(),
    askUser: new AskUserBroker(),
    taskId: "task-1",
    parentAgentId: "assistant",
    sessionDir,
    parentExtensions: () => ({
      afterShell: [{ name: "delegate" } as never],
    }),
  });
  expect(created[0]?.tools).toContain("deliver_artifacts");
  expect(created[0]?.sessionManager.fresh).toBe(true);
  expect(created[0]?.sessionManager.sessionDir).toBe(sessionDir);
  const loader = created[0] as {
    resourceLoader?: { options?: { extensionFactories?: Array<{ name?: string }> } };
  };
  const names = loader.resourceLoader?.options?.extensionFactories?.map((item) => item.name);
  expect(names).not.toContain("delegate");
});
