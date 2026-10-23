import fs from "node:fs";
import path from "node:path";

import type { ModelConfig } from "../config/load.js";
import type { ProviderTemplateKind } from "../config/provider-templates.js";
import type { Visit } from "../package/sync.js";
import {
  detectHostEnvironment,
  type DetectHostEnvironmentOptions,
  type HostEnvironment,
} from "./environment.js";

/** Pi `tools` 白名单中与平台无关的固定工具（shell 工具由环境探测插入）。 */
const BUILTIN_TOOLS_BEFORE_SHELL = [
  "read",
  "grep",
  "find",
  "ls",
  "write",
  "edit",
] as const;

const BUILTIN_TOOLS_AFTER_SHELL = [
  "web_search",
  "web_fetch",
  "ask_user",
  "todo",
  "bg_run",
  "bg_status",
  "bg_kill",
] as const;

/** 列出已招募专家并委托子任务（私人助理与第三方 Agent 共用）。 */
const DELEGATION_TOOLS = [
  "list_recruited_agents",
  "delegate_to_agent",
  "check_delegation",
  "cancel_delegation",
];

export interface SessionProviderBinding {
  templateId: string;
  providerId: string;
  modelId: string;
  apiKey: string;
  baseUrl?: string;
  kind: ProviderTemplateKind;
  contextWindow?: number;
  maxTokens?: number;
}

export interface SessionPlan {
  cwd: string;
  sessionDir: string;
  agentDir: string;
  tools: string[];
  mcp: boolean;
  provider: SessionProviderBinding;
  /** 本机会话环境（shell / 平台）；与 tools 白名单一致 */
  environment: HostEnvironment;
}

export class SessionRefused extends Error {}

export type BuildSessionPlanOptions = {
  /** 测试或显式覆盖本机探测 */
  environment?: HostEnvironment;
  detect?: DetectHostEnvironmentOptions;
};

export function buildSessionPlan(
  visit: Visit,
  model: ModelConfig,
  options: BuildSessionPlanOptions = {},
): SessionPlan {
  if (visit.projectTrust !== "granted") {
    throw new SessionRefused("运行包尚未通过校验");
  }
  const environment = options.environment ?? detectHostEnvironment(options.detect);
  return {
    cwd: path.join(visit.root, "cwd"),
    sessionDir: path.join(visit.root, "sessions"),
    agentDir: path.join(visit.root, ".runtime"),
    tools: [
      ...BUILTIN_TOOLS_BEFORE_SHELL,
      ...environment.shellTools,
      ...BUILTIN_TOOLS_AFTER_SHELL,
      ...DELEGATION_TOOLS,
    ],
    mcp: fs.existsSync(path.join(visit.root, "cwd", ".pi", "mcp.json")),
    provider: {
      templateId: model.templateId,
      providerId: model.providerId,
      modelId: model.modelId,
      apiKey: model.apiKey,
      baseUrl: model.baseUrl,
      kind: model.kind,
      contextWindow: model.contextWindow,
      maxTokens: model.maxTokens,
    },
    environment,
  };
}
