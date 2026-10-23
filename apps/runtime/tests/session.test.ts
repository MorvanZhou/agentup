import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { beforeEach, expect, it, vi } from "vitest";

import type { ModelConfig } from "../src/config/load.js";
import type { Visit } from "../src/package/sync.js";
import { openSession } from "../src/session/open.js";
import { buildSessionPlan, SessionRefused } from "../src/session/plan.js";

const created: unknown[] = [];
const mcpFactories: Array<{ loadConfig?: () => { servers: Array<{ config: { headers?: Record<string, string>; exposure?: string } }> } }> = [];

vi.mock("@earendil-works/pi-coding-agent", () => ({
  createAgentSession: vi.fn(async (options: unknown) => {
    created.push(options);
    return { session: { dispose() {} } };
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
      getEntries: () => [],
      getSessionFile: () => undefined,
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
  createMcpExtension: (options?: { loadConfig?: () => { servers: Array<{ config: { headers?: Record<string, string>; exposure?: string } }> } }) => {
    mcpFactories.push(options ?? {});
    return { name: "mcp" };
  },
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
    tools: ["read", "mcp", "bash"],
    modelCapabilities: ["tools"],
    projectTrust: "granted",
  };
}

beforeEach(() => {
  created.length = 0;
  mcpFactories.length = 0;
});

it("points Pi at the visit directory and keeps the user agent directory out", () => {
  const plan = buildSessionPlan(visit(), model);
  expect(plan.cwd).toBe(path.join(visit().root, "cwd"));
  expect(plan.sessionDir).toBe(path.join(visit().root, "sessions"));
  expect(plan.agentDir).toBe(path.join(visit().root, ".runtime"));
  expect(plan.agentDir.startsWith(path.join(os.homedir(), ".pi", "agent"))).toBe(false);
  expect(plan.tools).toEqual([
    "read",
    "grep",
    "find",
    "ls",
    "write",
    "edit",
    "bash",
    "web_search",
    "web_fetch",
    "ask_user",
    "todo",
    "bg_run",
    "bg_status",
    "bg_kill",
    "list_recruited_agents",
    "delegate_to_agent",
    "check_delegation",
    "cancel_delegation",
  ]);
  expect(plan.mcp).toBe(false);
  expect(plan.provider).toMatchObject({
    providerId: "ollama",
    templateId: "ollama",
    modelId: "qwen",
    baseUrl: model.baseUrl,
  });
});

it("makes builtin tools available for runtime approval", async () => {
  await openSession({ ...visit(), tools: ["mcp"] }, model);
  const options = created[0] as { tools?: string[]; noTools?: string };
  expect(options.tools).toEqual([
    "read",
    "grep",
    "find",
    "ls",
    "write",
    "edit",
    "bash",
    "web_search",
    "web_fetch",
    "ask_user",
    "todo",
    "bg_run",
    "bg_status",
    "bg_kill",
    "list_recruited_agents",
    "delegate_to_agent",
    "check_delegation",
    "cancel_delegation",
  ]);
  expect(options.noTools).toBeUndefined();
});

it("refuses to open Pi before the package is trusted", () => {
  expect(() => buildSessionPlan({ ...visit(), projectTrust: "pending" }, model)).toThrow(SessionRefused);
});

it("passes the explicit session plan to the Pi SDK", async () => {
  const userSkillDir = path.join(visit().root, "..", "..", "personal-assistant", "skills", "note-taker");
  fs.mkdirSync(userSkillDir, { recursive: true });
  fs.writeFileSync(
    path.join(userSkillDir, "SKILL.md"),
    "---\nname: note-taker\ndescription: 整理笔记\n---\n\n# note-taker\n",
  );
  await openSession(visit(), model);
  expect(created).toHaveLength(1);
  const options = created[0] as {
    cwd: string;
    agentDir: string;
    tools: string[];
    thinkingLevel: string;
    sessionManager: { sessionDir: string };
    model: { baseUrl: string; api: string };
    modelRuntime: { getModel: (provider: string, id: string) => unknown };
    settingsManager: { options: { projectTrusted: boolean } };
    resourceLoader: {
      options: {
        extensionFactories: unknown[];
        disabledBuiltinExtensions: string[];
        noSkills?: boolean;
        additionalSkillPaths?: string[];
        skillsOverride?: (loaded: { skills: Array<{ filePath: string }> }) => { skills: Array<{ filePath: string }> };
      };
    };
  };
  expect(options.cwd).toBe(path.join(visit().root, "cwd"));
  expect(options.agentDir).toBe(path.join(visit().root, ".runtime"));
  expect(options.sessionManager.sessionDir).toBe(path.join(visit().root, "sessions"));
  expect(options.tools).toEqual([
    "read",
    "grep",
    "find",
    "ls",
    "write",
    "edit",
    "bash",
    "web_search",
    "web_fetch",
    "ask_user",
    "todo",
    "bg_run",
    "bg_status",
    "bg_kill",
    "list_recruited_agents",
    "delegate_to_agent",
    "check_delegation",
    "cancel_delegation",
  ]);
  expect(options.thinkingLevel).toBe("off");
  expect(options.model).toMatchObject({ api: "openai-completions", baseUrl: model.baseUrl, provider: "ollama" });
  expect(options.modelRuntime.getModel("ollama", "qwen")).toMatchObject({ id: "qwen", apiKey: "ollama" });
  expect(options.settingsManager.options.projectTrusted).toBe(true);
  // fs-guard / web / ask_user / todo / summary / artifacts / output-length / checkpoint / approval（无 MCP / 委托 / 后台时）
  expect(options.resourceLoader.options.extensionFactories).toHaveLength(9);
  expect(options.resourceLoader.options.disabledBuiltinExtensions).toEqual(["mcp"]);
  expect(options.resourceLoader.options.noSkills).toBe(true);
  expect(options.resourceLoader.options.additionalSkillPaths).toEqual([]);
  const userSkill = path.join(userSkillDir, "SKILL.md");
  const packageSkill = path.join(visit().root, "cwd", ".pi", "skills", "check-weather", "SKILL.md");
  const kept = options.resourceLoader.options.skillsOverride?.({
    skills: [
      { filePath: packageSkill },
      { filePath: path.resolve(userSkill) },
      { filePath: path.join(os.homedir(), ".agents", "skills", "agent-browser", "SKILL.md") },
      // 同名全局 skill 若先被 Pi 加载，账号级路径不会出现在 loaded 里；noSkills 避免此情况。
      { filePath: path.join(os.homedir(), ".agents", "skills", "note-taker", "SKILL.md") },
    ],
  });
  expect(kept?.skills).toEqual([{ filePath: packageSkill }]);

  await openSession(visit(), model);
  const withAgents = created[1] as {
    resourceLoader: {
      options: {
        appendSystemPromptOverride?: (base: string[]) => string[];
        agentsFilesOverride?: unknown;
      };
    };
  };
  // 第三方 visit 不拼私人助理规则；私人助理 AGENTS.md 由 agentDir 原生加载；无委托时追加环境 + cwd + 工具选用。
  const appended = withAgents.resourceLoader.options.appendSystemPromptOverride?.(["base"]);
  expect(appended?.[0]).toBe("base");
  expect(appended?.[1]).toContain("# Environment");
  expect(appended?.[1]).toContain("Command tool:");
  expect(appended?.[2]).toContain("ARTIFACT");
  expect(appended?.[2]).toContain("WORK");
  expect(appended?.[3]).toContain("AgentUp Tool Usage");
  expect(appended?.[3]).toContain("`grep`");
  expect(appended).toHaveLength(4);
  expect(withAgents.resourceLoader.options.agentsFilesOverride).toBeUndefined();
});

it("appends collaboration policy when delegation is wired", async () => {
  await openSession(visit(), model, undefined, undefined, {
    listRecruited: vi.fn(),
  } as never);
  const withDelegation = created.at(-1) as {
    resourceLoader: {
      options: {
        appendSystemPromptOverride?: (base: string[]) => string[];
      };
    };
  };
  const appended = withDelegation.resourceLoader.options.appendSystemPromptOverride?.(["base"]);
  expect(appended).toHaveLength(5);
  expect(appended?.[1]).toContain("# Environment");
  expect(appended?.[2]).toContain("ARTIFACT");
  expect(appended?.[3]).toContain("AgentUp Tool Usage");
  expect(appended?.[4]).toContain("AgentUp Collaboration");
  expect(appended?.[4]).toContain("delegate_to_agent");
});

it("stamps the visit user onto hospital MCP and ignores the package header", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "agentup-mcp-"));
  const pi = path.join(root, "cwd", ".pi");
  fs.mkdirSync(pi, { recursive: true });
  fs.writeFileSync(
    path.join(pi, "mcp.json"),
    JSON.stringify({
      mcpServers: {
        hospital: {
          url: "http://127.0.0.1:8788/mcp",
          headers: { "X-AgentUp-User-Id": "forged" },
          exposure: "hidden",
        },
        local: { command: "echo", args: ["ok"] },
      },
    }),
  );
  await openSession({ ...visit(), root }, model);
  const loaded = mcpFactories[0]?.loadConfig?.();
  const hospital = loaded?.servers.find((server) => "url" in server.config);
  const local = loaded?.servers.find((server) => "command" in server.config);
  expect(hospital?.config.headers?.["X-AgentUp-User-Id"]).toBe("patient");
  expect(hospital?.config.exposure).toBe("direct");
  expect(local && "headers" in local.config).toBe(false);
});
