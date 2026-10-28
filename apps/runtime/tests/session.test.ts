import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { beforeEach, expect, it, vi } from "vitest";

import type { ModelConfig } from "../src/config/load.js";
import type { Visit } from "../src/package/sync.js";
import { groupConversation } from "../src/session/core/conversation-ref.js";
import { openSession } from "../src/session/open.js";
import { buildSessionPlan, SessionRefused } from "../src/session/plan.js";

const created: unknown[] = [];
const mcpFactories: Array<{
  loadConfig?: () => {
    servers: Array<{
      name?: string;
      config: { url?: string; headers?: Record<string, string>; exposure?: string; command?: string };
    }>;
  };
}> = [];

vi.mock("@earendil-works/pi-coding-agent", () => ({
  createAgentSession: vi.fn(async (options: unknown) => {
    created.push(options);
    return {
      session: {
        dispose() {},
        bindExtensions: vi.fn(async () => undefined),
      },
    };
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
    create: (_cwd: string, sessionDir: string) => ({
      getSessionFile: () => path.join(sessionDir, "fresh.jsonl"),
    }),
    open: (file: string, sessionDir: string, cwd: string) => ({
      cwd,
      sessionDir,
      file,
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
  createMcpExtension: (options?: {
    loadConfig?: () => {
      servers: Array<{
        name?: string;
        config: { url?: string; headers?: Record<string, string>; exposure?: string; command?: string };
      }>;
    };
  }) => {
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
    "get_local_time",
    "web_search",
    "web_fetch",
    "ask_user",
    "todo",
    "bg_run",
    "bg_status",
    "bg_kill",
    "shell_hang_decide",
    "agent_search",
    "delegate_to_agent",
    "check_delegation",
    "cancel_delegation",
    "steer_delegation",
    "resolve_delegation_update",
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
    "get_local_time",
    "web_search",
    "web_fetch",
    "ask_user",
    "todo",
    "bg_run",
    "bg_status",
    "bg_kill",
    "shell_hang_decide",
    "agent_search",
    "delegate_to_agent",
    "check_delegation",
    "cancel_delegation",
    "steer_delegation",
    "resolve_delegation_update",
  ]);
  expect(options.noTools).toBeUndefined();
});

it("refuses to open Pi before the package is trusted", () => {
  expect(() => buildSessionPlan({ ...visit(), projectTrust: "pending" }, model)).toThrow(SessionRefused);
});

it("keeps a group holder session out of the one-to-one sessions directory", async () => {
  const holder = path.join(os.tmpdir(), "agentup-group-holder", "sessions");
  const plan = buildSessionPlan(visit(), model, { sessionDir: holder });
  expect(plan.sessionDir).toBe(holder);
  expect(plan.cwd).toBe(path.join(visit().root, "cwd"));
  await openSession(visit(), model, undefined, undefined, undefined, undefined, undefined, holder);
  const options = created.at(-1) as { sessionManager: { sessionDir: string }; cwd: string };
  expect(options.sessionManager.sessionDir).toBe(holder);
  expect(options.cwd).toBe(path.join(visit().root, "cwd"));
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
    "get_local_time",
    "web_search",
    "web_fetch",
    "ask_user",
    "todo",
    "bg_run",
    "bg_status",
    "bg_kill",
    "shell_hang_decide",
    "agent_search",
    "delegate_to_agent",
    "check_delegation",
    "cancel_delegation",
    "steer_delegation",
    "resolve_delegation_update",
  ]);
  expect(options.thinkingLevel).toBe("off");
  expect(options.model).toMatchObject({ api: "openai-completions", baseUrl: model.baseUrl, provider: "ollama" });
  expect(options.modelRuntime.getModel("ollama", "qwen")).toMatchObject({ id: "qwen", apiKey: "ollama" });
  expect(options.settingsManager.options.projectTrusted).toBe(true);
  // fs-guard / web / local-time / ask_user / todo / summary / artifacts / output-length / stream-guard / checkpoint / approval / sampling（无 MCP / 委托 / 后台时）
  expect(options.resourceLoader.options.extensionFactories).toHaveLength(12);
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
  expect(appended?.[4]).toContain("agent_search");
});

it("injects the group roster into the holder prompt and drops agent search", async () => {
  const holder = path.join(os.tmpdir(), "agentup-group-roster", "sessions");
  await openSession(
    visit(),
    model,
    undefined,
    undefined,
    {
      listGroupMembers: () => [
        { agentId: "tax-advisor", name: "顾问" },
        { agentId: "dev", name: "开发" },
        { agentId: "design", name: "设计师" },
      ],
      listRecruited: vi.fn(async () => [
        {
          agentId: "dev",
          name: "开发",
          role: "工程师",
          background: "写代码",
          remark: "",
          systemText: "SECRET-SYSTEM-BODY",
          agentsText: "SECRET-AGENTS-BODY",
        },
      ]),
    } as never,
    undefined,
    undefined,
    {
      sessionDir: holder,
      conversation: groupConversation({
        userId: "patient",
        groupId: "g1",
        holderAgentId: "tax-advisor",
      }),
    },
  );
  const opened = created.at(-1) as {
    tools?: string[];
    resourceLoader: {
      options: {
        appendSystemPromptOverride?: (base: string[]) => string[];
      };
    };
  };
  expect(opened.tools).not.toContain("agent_search");
  expect(opened.tools).toContain("delegate_to_agent");
  const appended = opened.resourceLoader.options.appendSystemPromptOverride?.(["base"]);
  const collaboration = appended?.find((part) => part.includes("AgentUp Group"));
  const roster = appended?.find((part) => part.includes("agent_id: dev"));
  expect(collaboration).toBeTruthy();
  expect(collaboration).not.toContain("agent_search");
  expect(appended?.some((part) => part.includes("AgentUp Collaboration"))).toBe(false);
  expect(roster).toContain("工程师");
  expect(roster).toContain("设计师 (agent_id: design)");
  expect(roster).not.toContain("agent_id: tax-advisor");
  expect(roster).not.toContain("SECRET-SYSTEM-BODY");
  expect(appended?.some((part) => part.includes("private scratch"))).toBe(false);
  expect(appended?.some((part) => part.includes("Group shared workspace"))).toBe(true);
  const workspace = appended?.find((part) => part.includes("Group shared workspace")) ?? "";
  expect(workspace).toContain(`${path.sep}users${path.sep}patient${path.sep}.runtime${path.sep}groups${path.sep}g1${path.sep}workspace`);
  expect(workspace).not.toContain(`${path.sep}users${path.sep}users${path.sep}`);
});

it("stamps the visit user onto hospital MCP, defaults exposure to deferred, and keeps explicit exposure", async () => {
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
        },
        pinned: {
          url: "http://127.0.0.1:8789/mcp",
          exposure: "direct",
        },
        local: { command: "echo", args: ["ok"] },
      },
    }),
  );
  const opened = await openSession({ ...visit(), root }, model);
  const loaded = mcpFactories[0]?.loadConfig?.();
  const hospital = loaded?.servers.find((server) => server.name === "hospital");
  const pinned = loaded?.servers.find((server) => server.name === "pinned");
  const local = loaded?.servers.find((server) => server.name === "local");
  expect(hospital?.config.headers?.["X-AgentUp-User-Id"]).toBe("patient");
  expect(hospital?.config.exposure).toBe("deferred");
  expect(pinned?.config.exposure).toBe("direct");
  expect(local?.config.exposure).toBe("deferred");
  expect(local && "headers" in local.config).toBe(false);
  expect(opened.session.bindExtensions).toHaveBeenCalledOnce();
  const options = created.at(-1) as {
    tools?: string[];
    resourceLoader: { options: { extensionFactories: unknown[] } };
  };
  expect(options.tools).toContain("tool_search");
  // + tool_search + codemode + mcp（相对无 MCP 时多 3）
  expect(options.resourceLoader.options.extensionFactories.length).toBeGreaterThanOrEqual(13);
});
