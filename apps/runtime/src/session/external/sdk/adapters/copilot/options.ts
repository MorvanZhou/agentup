import fs from "node:fs";
import path from "node:path";

import type { ExternalTurnRequest } from "../../contract.js";
import {
  formatAskUserResultText,
  type AskUserAnswer,
  type AskUserOption,
  type AskUserQuestion,
} from "../../../../tools/ask-user.js";
import { agentSdkSkillsProjectRel } from "../../../../../config/provider-templates.js";

/**
 * Host ExternalTurnRequest → CopilotClient / createSession / send 选项。
 * systemMessage 默认 append；信任用 approveAll；AskUser 走 onUserInputRequest。
 */

export const COPILOT_CONTEXT_HEADER = [
  "You are running as a local GitHub Copilot agent hosted inside AgentUp.",
  "Follow the AgentUp context below. Prefer tools and directories listed there.",
  "When you need a clarifying choice from the human, use the ask_user tool.",
].join("\n");

export const ASK_USER_HINT =
  'Expected: question text plus optional choices. Prefer multiple-choice when possible.';

/** Client 构造选项（baseDirectory / token / connection 在 driver 里补）。 */
export function copilotClientExtrasOf(input: ExternalTurnRequest): {
  workingDirectory: string;
} {
  return { workingDirectory: input.cwd };
}

/** createSession 配置（不含 handlers；handlers 在 driver 绑定闭包）。 */
export function copilotSessionConfigOf(
  input: ExternalTurnRequest,
  extras: {
    approveAll: (request: unknown, invocation?: unknown) => unknown;
    onUserInputRequest?: (
      request: unknown,
      invocation?: unknown,
    ) => Promise<unknown>;
  },
): Record<string, unknown> {
  const model =
    input.modelId && input.modelId !== "default" && input.modelId !== "auto"
      ? { model: input.modelId }
      : { model: "auto" };

  const skillDirectories = skillDirectoriesOf(input);
  const mcpServers = input.mcpServer
    ? { agentup: toCopilotHttpMcp(input.mcpServer) }
    : undefined;

  const systemAppend = input.systemAppend.trim();
  const systemMessage = {
    // 默认 append：保留 CLI 人格与安全段落，再挂 Host context
    content: systemAppend
      ? `${COPILOT_CONTEXT_HEADER}\n\n${systemAppend}`
      : COPILOT_CONTEXT_HEADER,
  };

  return {
    ...model,
    workingDirectory: input.cwd,
    trustWorkingDirectory: "session",
    // 禁止跨轮 resume / 持久化工作区
    infiniteSessions: { enabled: false },
    enableSessionStore: false,
    streaming: true,
    systemMessage,
    onPermissionRequest: extras.approveAll,
    ...(extras.onUserInputRequest
      ? {
          askUserVariant: "legacy",
          onUserInputRequest: extras.onUserInputRequest,
        }
      : {}),
    ...(mcpServers ? { mcpServers } : {}),
    ...(skillDirectories.length > 0 ? { skillDirectories } : {}),
  };
}

export function copilotSendOptionsOf(input: ExternalTurnRequest): Record<string, unknown> {
  const attachments: Array<{ type: string; path: string }> = [];
  for (const dir of input.additionalDirs) {
    if (!dir.trim()) continue;
    attachments.push({ type: "directory", path: dir });
  }
  return {
    prompt: input.prompt,
    ...(attachments.length > 0 ? { attachments } : {}),
  };
}

/** 方案 D：cwd 下 skillsProjectRel 父目录（内含各技能子目录的 SKILL.md）。 */
export function skillDirectoriesOf(input: ExternalTurnRequest): string[] {
  const rel = agentSdkSkillsProjectRel(input.templateId);
  if (!rel) return [];
  const absolute = path.resolve(input.cwd, rel);
  try {
    if (!fs.existsSync(absolute) || !fs.statSync(absolute).isDirectory()) return [];
  } catch {
    return [];
  }
  return [absolute];
}

/** Host mcpServer → Copilot mcpServers http 形。 */
export function toCopilotHttpMcp(server: Record<string, unknown>): Record<string, unknown> {
  const headers =
    server.headers && typeof server.headers === "object" && !Array.isArray(server.headers)
      ? (server.headers as Record<string, string>)
      : {};
  return {
    type: "http",
    url: typeof server.url === "string" ? server.url : "",
    headers,
    tools: ["*"],
  };
}

export async function runCopilotAskUser(
  input: ExternalTurnRequest,
  request: unknown,
  invocation?: unknown,
): Promise<{ answer: string; wasFreeform: boolean }> {
  if (!input.askUser || !input.userId || !input.agentId) {
    return { answer: "Ask user is unavailable in this session.", wasFreeform: true };
  }
  const questions = copilotAskUserRequestToQuestions(request);
  if (!questions) {
    return {
      answer: `Invalid ask-user parameters. ${ASK_USER_HINT}`,
      wasFreeform: true,
    };
  }
  const toolCallId = toolCallIdOf(invocation, request);
  const answer = (await input.askUser.request(
    {
      userId: input.userId,
      agentId: input.agentId,
      toolCallId,
      questions,
    },
    input.abortController.signal,
  )) as AskUserAnswer;
  return {
    answer: formatAskUserResultText(questions, answer),
    wasFreeform: true,
  };
}

function toolCallIdOf(invocation: unknown, request: unknown): string {
  if (invocation && typeof invocation === "object") {
    const row = invocation as Record<string, unknown>;
    for (const key of ["toolCallId", "tool_call_id", "id", "callId"]) {
      const value = row[key];
      if (typeof value === "string" && value.trim()) return value.trim();
    }
  }
  if (request && typeof request === "object") {
    const row = request as Record<string, unknown>;
    for (const key of ["toolCallId", "tool_call_id", "id"]) {
      const value = row[key];
      if (typeof value === "string" && value.trim()) return value.trim();
    }
  }
  return "copilot-ask-user";
}

/**
 * Copilot onUserInputRequest：{ question, choices?, allowFreeform? }
 * 也兼容 Cursor 形 questions[]。
 */
export function copilotAskUserRequestToQuestions(request: unknown): AskUserQuestion[] | null {
  if (!request || typeof request !== "object" || Array.isArray(request)) return null;
  const row = request as Record<string, unknown>;

  if (Array.isArray(row.questions)) {
    return sdkAskUserQuestions(row.questions);
  }

  const question = firstString(row.question, row.prompt, row.message);
  if (!question) return null;
  const options = normalizeOptions(row.choices ?? row.options);
  if (options.length === 0) {
    // 允许纯自由回答：给一个占位选项，桌面仍可填空
    return [
      {
        question,
        options: [{ title: "自由回答" }],
        allowMultiple: false,
      },
    ];
  }
  return [
    {
      question,
      options,
      allowMultiple: row.multiSelect === true || row.allowMultiple === true,
    },
  ];
}

function sdkAskUserQuestions(raw: unknown): AskUserQuestion[] | null {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const questions: AskUserQuestion[] = [];
  for (const value of raw) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const row = value as Record<string, unknown>;
    const question = firstString(row.question, row.prompt, row.message);
    if (!question) return null;
    const options = normalizeOptions(row.options ?? row.choices);
    if (options.length === 0) return null;
    const context = firstString(row.header, row.context);
    questions.push({
      question,
      ...(context ? { context } : {}),
      options,
      allowMultiple: row.multiSelect === true || row.allowMultiple === true,
    });
  }
  return questions;
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
