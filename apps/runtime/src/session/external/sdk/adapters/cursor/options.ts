import type { ExternalTurnRequest } from "../../contract.js";
import {
  formatAskUserResultText,
  type AskUserAnswer,
  type AskUserOption,
  type AskUserQuestion,
} from "../../../../tools/ask-user.js";

/**
 * Cursor 多数账号未开通 Custom system prompt（会报 invalid_argument）。
 * 因此默认 **不传** `systemPrompt`，把 Host context 拼进本轮 user prompt 前缀。
 * 文档：.cursor/skills/agentup-sdk-adapter/references/contract.md §7。
 */
export const CURSOR_CONTEXT_HEADER = [
  "You are running as a local Cursor agent hosted inside AgentUp.",
  "Follow the AgentUp context below. Prefer tools and directories listed there.",
  // Cursor 把 customTools 挂成 MCP server `custom-user-tools`；schema 必须用 inputSchema
  "When you need a clarifying choice from the human, call MCP tool agentup_ask_user (server custom-user-tools) with { questions: [{ question, options: [{ label, description? }] }] }.",
].join("\n");

/** 给模型看的期望形状（错误回执也复用，避免再去 grep 源码）。 */
export const ASK_USER_HINT =
  'Expected: { "questions": [{ "question": "...?", "options": [{ "label": "...", "description": "..." }] }] }';

/**
 * Cursor customTools 对外广告的 JSON Schema（字段名必须是 inputSchema，不是 parameters）。
 * 形状对齐 Cursor / CodeBuddy 的 AskUserQuestion，便于模型一次写对。
 */
export const CURSOR_ASK_USER_INPUT_SCHEMA = {
  type: "object",
  properties: {
    questions: {
      type: "array",
      description: "1-4 questions to ask the human",
      items: {
        type: "object",
        properties: {
          question: { type: "string", description: "Full question text (prefer ending with ?)" },
          header: { type: "string", description: "Short chip label (max ~12 chars)" },
          multiSelect: { type: "boolean", description: "Allow multiple selections" },
          options: {
            type: "array",
            description: "2-4 choices",
            items: {
              type: "object",
              properties: {
                label: { type: "string", description: "Short option title" },
                description: { type: "string", description: "What this option means" },
              },
              required: ["label"],
            },
          },
        },
        required: ["question", "options"],
      },
    },
  },
  required: ["questions"],
} as const;

/** ExternalTurnRequest → Agent.create 选项（不含 apiKey / store；不含 systemPrompt）。 */
export function cursorCreateOptionsOf(
  input: ExternalTurnRequest,
  extras: { apiKey: string; localStore: unknown },
): Record<string, unknown> {
  const model =
    input.modelId && input.modelId !== "default" ? { model: { id: input.modelId } } : {};
  return {
    apiKey: extras.apiKey,
    ...model,
    // 故意不传 systemPrompt：未开通账号会整轮失败
    local: {
      cwd: input.cwd,
      ...(input.additionalDirs.length > 0 ? { dirs: input.additionalDirs } : {}),
      store: extras.localStore,
      ...(input.askUser ? { customTools: askUserCustomTools(input) } : {}),
    },
    ...(input.mcpServer ? { mcpServers: { agentup: normalizeMcp(input.mcpServer) } } : {}),
  };
}

/** 本轮发给 Cursor 的 user 文本：前缀 Host context + 用户/transcript prompt。 */
export function cursorTurnPromptOf(input: ExternalTurnRequest): string {
  return composePromptPrefix(input.systemAppend, input.prompt);
}

export function composePromptPrefix(systemAppend: string, prompt: string): string {
  const append = systemAppend.trim();
  const body = prompt.trim();
  const context = append
    ? `${CURSOR_CONTEXT_HEADER}\n\n${append}`
    : CURSOR_CONTEXT_HEADER;
  if (!body) return context;
  return `${context}\n\n---\n\n${body}`;
}

/** @deprecated 旧名：现已改为 prompt 前缀，不再用于 systemPrompt replace */
export const CURSOR_SYSTEM_BASE = CURSOR_CONTEXT_HEADER;

/** @deprecated 见 composePromptPrefix */
export function composeSystemPrompt(systemAppend: string): string {
  return composePromptPrefix(systemAppend, "");
}

function normalizeMcp(server: Record<string, unknown>): Record<string, unknown> {
  return { ...server };
}

function askUserCustomTools(input: ExternalTurnRequest): Record<string, unknown> {
  return {
    agentup_ask_user: {
      description:
        "Ask the human a multiple-choice question and wait. Pass questions[{question, options[{label, description?}]}]. Do not invent other argument shapes.",
      // Cursor SDK 只认 inputSchema；写成 parameters 时模型拿不到 schema，会乱猜参数
      inputSchema: CURSOR_ASK_USER_INPUT_SCHEMA,
      execute: async (
        args: Record<string, unknown>,
        context?: { toolCallId?: string },
      ) => askUserExecute(input, args, context),
    },
  };
}

async function askUserExecute(
  input: ExternalTurnRequest,
  args: Record<string, unknown>,
  context?: { toolCallId?: string },
): Promise<string> {
  if (!input.askUser || !input.userId || !input.agentId) {
    return "Ask user is unavailable in this session.";
  }
  // Cursor MCP 入参 → Host AskUserQuestion[]（兼容模型偶发的扁平写法）
  const questions = cursorAskUserArgsToQuestions(args);
  if (!questions) return `Invalid ask-user parameters. ${ASK_USER_HINT}`;
  // 必须用 SDK 真实 toolCallId：subscribeResolved → completeTool 才对得上时间线，否则卡会假「已终止」
  const toolCallId =
    typeof context?.toolCallId === "string" && context.toolCallId.trim()
      ? context.toolCallId.trim()
      : "cursor-ask-user";
  const answer = (await input.askUser.request(
    {
      userId: input.userId,
      agentId: input.agentId,
      toolCallId,
      questions,
    },
    input.abortController.signal,
  )) as AskUserAnswer;
  // 与 Pi / CodeBuddy 同形，桌面 summarizeAskUserTool 才能还原答案（勿自制 "题: 答"）
  return formatAskUserResultText(questions, answer);
}

/**
 * 把 Cursor `agentup_ask_user` 的工具入参程序化转成 Host AskUserQuestion[]。
 * 支持：
 * - 标准：`{ questions: [{ question, header?, options: [{label,description?}], multiSelect? }] }`
 * - 扁平：`{ question, options }` / `{ prompt|message, choices|options }`
 */
export function cursorAskUserArgsToQuestions(args: unknown): AskUserQuestion[] | null {
  if (!args || typeof args !== "object" || Array.isArray(args)) return null;
  const row = args as Record<string, unknown>;

  if (Array.isArray(row.questions)) {
    return sdkAskUserQuestions(row.questions);
  }

  // 模型常猜的扁平单题：{ question, options:[{id,label}] }
  const flatQuestion = firstString(row.question, row.prompt, row.message);
  if (flatQuestion) {
    const options = normalizeOptions(row.options ?? row.choices);
    if (options.length === 0) return null;
    return [
      {
        question: flatQuestion,
        options,
        allowMultiple: row.multiSelect === true || row.allowMultiple === true,
      },
    ];
  }

  return null;
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

/** Cursor option.label / 扁平 string / id|title|text → Host { title, description? } */
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
