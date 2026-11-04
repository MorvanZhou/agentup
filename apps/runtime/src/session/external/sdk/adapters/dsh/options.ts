import fs from "node:fs";
import path from "node:path";

import type { ExternalTurnRequest } from "../../contract.js";
import {
  type AskUserAnswer,
  type AskUserOption,
  type AskUserQuestion,
} from "../../../../tools/ask-user.js";
import { ensureDshHome } from "./home.js";
import { dshChildEnv, resolveDshCliPath } from "./load.js";

/**
 * Host ExternalTurnRequest → DeepSeekHarness 启流选项。
 * systemPrompt：env DSH_SYSTEM_PROMPT + cordis 覆盖 `system-prompt.personaPrefix`
 * （完整 `sdk` profile **不**读该 env，须 patch；`sdk-minimal` 才内建读 env）。
 * AskUser：onUserQuestion；信任：approvalRequests + 恒 allowed-once。
 * AgentUp MCP：每轮写临时 cordis patch（`insert` dsh-mcp-client → mcp__agentup__*）。
 */

export const DSH_CONTEXT_HEADER = [
  "You are running as a local DeepSeek Harness agent hosted inside AgentUp.",
  "Follow the AgentUp context below. Prefer tools and directories listed there.",
  "When you need a clarifying choice from the human, use ask_user_question.",
].join("\n");

export const ASK_USER_HINT =
  "Expected: question text plus optional choices. Prefer multiple-choice when possible.";

/** 构造 DeepSeekHarness options（不含 onUserQuestion 闭包）。 */
export function dshHarnessOptionsOf(
  input: ExternalTurnRequest,
): {
  options: Record<string, unknown>;
  patchPath: string | null;
} {
  const home = ensureDshHome(input.userDataRoot, input.templateId);
  const dshBin = resolveDshCliPath(input.userDataRoot, input.templateId);
  const systemPrompt = systemPromptOf(input);
  // 始终写 patch：personaPrefix 覆盖；有 MCP 再 insert 客户端
  const patchPath = writeAgentUpMcpPatch(input, home);
  // 默认跟官方目录首条：deepseek-flash = V4.1 Flash（勿再用退休的 deepseek-v4-flash）
  const model =
    input.modelId && input.modelId !== "default" ? input.modelId : "deepseek-flash";

  const options: Record<string, unknown> = {
    profile: "sdk",
    dshHome: home,
    cwd: input.cwd,
    provider: "deepseek-official",
    model,
    // 信任模式：client 侧审批恒放行（AskUser 走独立回调）
    approvalRequests: true,
    env: dshChildEnv(input.userDataRoot, input.templateId, { systemPrompt }),
    ...(dshBin ? { dshBin } : {}),
    ...(patchPath ? { patches: [patchPath] } : {}),
  };
  return { options, patchPath };
}

export function systemPromptOf(input: ExternalTurnRequest): string {
  const append = input.systemAppend.trim();
  return append ? `${DSH_CONTEXT_HEADER}\n\n${append}` : DSH_CONTEXT_HEADER;
}

/**
 * 每轮临时 cordis patch（写隔离 home，下次覆盖）：
 * 1) 覆盖 `system-prompt.personaPrefix` ← `DSH_SYSTEM_PROMPT`（完整 sdk 必补）
 * 2) `insert` AgentUp MCP：serverName=agentup → mcp__agentup__*
 *
 * 无 mcpServer 时仍写出 persona 段，避免上下文静默丢失。
 */
export function writeAgentUpMcpPatch(
  input: ExternalTurnRequest,
  home: string,
): string | null {
  const url =
    input.mcpServer && typeof input.mcpServer.url === "string"
      ? input.mcpServer.url.trim()
      : "";
  const headers =
    url &&
    input.mcpServer?.headers &&
    typeof input.mcpServer.headers === "object" &&
    !Array.isArray(input.mcpServer.headers)
      ? (input.mcpServer.headers as Record<string, string>)
      : {};

  const headersYaml = Object.entries(headers)
    .map(([key, value]) => `          ${yamlQuote(key)}: ${yamlQuote(value)}`)
    .join("\n");

  // cordis 方言：无 insert 的 `- id` 是覆盖已有行；MCP 必须 `- insert:`（官方 templates/mcp）
  const lines = [
    `# AgentUp per-turn cordis — generated; do not edit`,
    `# 完整 sdk profile 不读 DSH_SYSTEM_PROMPT，须覆盖 personaPrefix`,
    `- id: system-prompt`,
    `  config:`,
    `    personaPrefix: !!js process.env.DSH_SYSTEM_PROMPT ?? 'You are a coding agent powered by the {{model}} model.'`,
  ];

  if (url) {
    lines.push(
      `- insert:`,
      `    - id: mcp-agentup`,
      `      name: '@deepseek-ai/dsh-mcp-client'`,
      `      config:`,
      `        serverName: agentup`,
      `        transport: streamable-http`,
      `        url: ${yamlQuote(url)}`,
      `        failOnStartupError: true`,
    );
    if (headersYaml) {
      lines.push(`        headers:`, headersYaml);
    }
  }

  lines.push(``);
  const file = path.join(home, "agentup-mcp.cordis.yml");
  fs.writeFileSync(file, lines.join("\n"), { encoding: "utf8", mode: 0o600 });
  return file;
}

export async function runDshAskUser(
  input: ExternalTurnRequest,
  request: unknown,
): Promise<{ answers: Array<{ id: string; selected: string[]; custom?: string }> } | { cancelled: true }> {
  if (!input.askUser || !input.userId || !input.agentId) {
    return { cancelled: true };
  }
  const mapped = dshAskUserRequestToQuestions(request);
  if (!mapped) {
    return { cancelled: true };
  }
  const { questions, ids, toolCallId } = mapped;
  const answer = (await input.askUser.request(
    {
      userId: input.userId,
      agentId: input.agentId,
      toolCallId,
      questions,
    },
    input.abortController.signal,
  )) as AskUserAnswer;

  // 回厂商 JSON；落盘文案由 stream.rewriteAskUserResultText → formatAskUserResultText
  return toDshUserQuestionResult(ids, answer);
}

/**
 * 原生 onUserQuestion：{ requestId, sessionId, questions[] }
 * Host 题型无 id → 平行数组保留厂商 id。
 */
export function dshAskUserRequestToQuestions(request: unknown): {
  questions: AskUserQuestion[];
  ids: string[];
  toolCallId: string;
} | null {
  if (!request || typeof request !== "object" || Array.isArray(request)) return null;
  const row = request as Record<string, unknown>;
  const toolCallId =
    typeof row.requestId === "string" && row.requestId.trim()
      ? row.requestId.trim()
      : "dsh-ask-user";
  if (!Array.isArray(row.questions) || row.questions.length === 0) return null;

  const questions: AskUserQuestion[] = [];
  const ids: string[] = [];
  for (const value of row.questions) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const item = value as Record<string, unknown>;
    const id =
      typeof item.id === "string" && item.id.trim()
        ? item.id.trim()
        : `q${ids.length + 1}`;
    const question = firstString(item.question, item.prompt, item.message);
    if (!question) return null;
    const options = normalizeOptions(item.options ?? item.choices);
    if (options.length === 0) {
      options.push({ title: "自由回答" });
    }
    const context = firstString(item.header, item.detail, item.context);
    questions.push({
      question,
      ...(context ? { context } : {}),
      options,
      allowMultiple: item.multiSelect === true || item.allowMultiple === true,
    });
    ids.push(id);
  }
  return { questions, ids, toolCallId };
}

export function toDshUserQuestionResult(
  ids: string[],
  answer: AskUserAnswer,
): { answers: Array<{ id: string; selected: string[]; custom?: string }> } | { cancelled: true } {
  if (answer.kind === "cancelled") return { cancelled: true };
  return {
    answers: ids.map((id, index) => {
      const item = answer.items[index] ?? { kind: "skipped" as const };
      if (item.kind === "freeform") {
        return { id, selected: [], custom: item.text };
      }
      if (item.kind === "selection") {
        return { id, selected: item.selections };
      }
      return { id, selected: [] };
    }),
  };
}

function normalizeOptions(raw: unknown): AskUserOption[] {
  if (!Array.isArray(raw)) return [];
  const options: AskUserOption[] = [];
  for (const value of raw) {
    if (typeof value === "string") {
      const title = value.trim();
      if (title) options.push({ title });
      continue;
    }
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    const item = value as Record<string, unknown>;
    const title = firstString(item.label, item.title, item.text, item.id);
    if (!title) continue;
    const description = firstString(item.description);
    options.push(description ? { title, description } : { title });
  }
  return options;
}

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
}

function yamlQuote(value: string): string {
  return JSON.stringify(value);
}
