import fs from "node:fs";
import path from "node:path";

import type { ModelConfig } from "../config/load.js";
import type { ProviderTemplateKind } from "../config/provider-templates.js";
import type { Visit } from "../package/sync.js";

/** Pi `tools` 白名单：未列入的 Extension/`registerTool` 工具不会交给模型。 */
const BUILTIN_TOOLS = [
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
];

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
}

export class SessionRefused extends Error {}

export function buildSessionPlan(visit: Visit, model: ModelConfig): SessionPlan {
  if (visit.projectTrust !== "granted") {
    throw new SessionRefused("运行包尚未通过校验");
  }
  return {
    cwd: path.join(visit.root, "cwd"),
    sessionDir: path.join(visit.root, "sessions"),
    agentDir: path.join(visit.root, ".runtime"),
    tools: [...BUILTIN_TOOLS, ...DELEGATION_TOOLS],
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
  };
}
