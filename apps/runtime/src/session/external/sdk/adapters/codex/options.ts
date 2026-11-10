import type { ExternalCompactRequest, ExternalTurnRequest } from "../../contract.js";
import {
  formatAskUserResultText,
  type AskUserAnswer,
  type AskUserOption,
  type AskUserQuestion,
} from "../../../../tools/ask-user.js";
import { compactUserPrompt } from "../../host/compact-instruction.js";
import { mergeExternalTurnMcpServers } from "../../mcp-servers.js";
import { startExternalMcpServer, type ExternalMcpServer } from "../../../mcp/server.js";
import type { CodexAskUserIdBridge } from "./ask-user-bridge.js";

/**
 * Codex 无 systemPrompt.append / customTools。
 * Host context → prompt_prefix；AskUser → 临时 HTTP MCP（server: agentup_ask）。
 */

export const CODEX_CONTEXT_HEADER = [
  "You are running as a local Codex agent hosted inside AgentUp.",
  "Follow the AgentUp context below. Prefer tools and directories listed there.",
  "When you need a clarifying choice from the human, call MCP tool agentup_ask_user (server agentup_ask) with { questions: [{ question, options: [{ label, description? }] }] }.",
].join("\n");

export const ASK_USER_HINT =
  'Expected: { "questions": [{ "question": "...?", "options": [{ "label": "...", "description": "..." }] }] }';

/** 与 Cursor 同形，便于模型一次写对。 */
export const CODEX_ASK_USER_INPUT_SCHEMA = {
  type: "object" as const,
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
};

export type CodexClientOptions = {
  codexPathOverride?: string;
  env: Record<string, string>;
  config: Record<string, unknown>;
};

export type CodexThreadOptions = {
  model?: string;
  sandboxMode: "danger-full-access";
  approvalPolicy: "never";
  workingDirectory: string;
  skipGitRepoCheck: true;
  additionalDirectories?: string[];
  networkAccessEnabled?: boolean;
};

/** ExternalTurnRequest → Codex 构造 + Thread 选项。 */
export function codexClientOptionsOf(
  input: ExternalTurnRequest,
  extras: {
    cliPath: string;
    codexHome: string;
    askUserMcp?: { url: string; headers: Record<string, string> } | null;
  },
): CodexClientOptions {
  // 平台 MCP + agentup HTTP；AskUser 另挂 agentup_ask
  const mcpServers: Record<string, unknown> = {
    ...(mergeExternalTurnMcpServers(input, toCodexHttpMcp) ?? {}),
  };
  if (extras.askUserMcp) {
    mcpServers.agentup_ask = {
      url: extras.askUserMcp.url,
      http_headers: extras.askUserMcp.headers,
    };
  }

  const pathKey = process.platform === "win32" ? "Path" : "PATH";
  const env: Record<string, string> = {
    CODEX_HOME: extras.codexHome,
    [pathKey]: process.env[pathKey] ?? process.env.PATH ?? "",
  };
  if (process.env.HOME) env.HOME = process.env.HOME;
  if (process.env.USERPROFILE) env.USERPROFILE = process.env.USERPROFILE;
  if (process.env.LANG) env.LANG = process.env.LANG;
  if (process.env.LC_ALL) env.LC_ALL = process.env.LC_ALL;

  return {
    codexPathOverride: extras.cliPath,
    env,
    config: {
      // 信任：MCP 工具也默认自动跑（AskUser 仍阻塞在我们自己的 MCP handler）
      mcp_servers: mcpServers,
    },
  };
}

export function codexThreadOptionsOf(input: ExternalTurnRequest): CodexThreadOptions {
  const model =
    input.modelId && input.modelId !== "default" ? { model: input.modelId } : {};
  return {
    ...model,
    sandboxMode: "danger-full-access",
    approvalPolicy: "never",
    workingDirectory: input.cwd,
    skipGitRepoCheck: true,
    ...(input.additionalDirs.length > 0
      ? { additionalDirectories: input.additionalDirs }
      : {}),
    networkAccessEnabled: true,
  };
}

export function codexTurnPromptOf(input: ExternalTurnRequest): string {
  return composePromptPrefix(input.systemAppend, input.prompt);
}

/** 压缩：无 MCP；空 cwd；prompt 仅压缩指令（无业务 header）。 */
export function codexCompactClientOptionsOf(extras: {
  cliPath: string;
  codexHome: string;
}): CodexClientOptions {
  const pathKey = process.platform === "win32" ? "Path" : "PATH";
  const env: Record<string, string> = {
    CODEX_HOME: extras.codexHome,
    [pathKey]: process.env[pathKey] ?? process.env.PATH ?? "",
  };
  if (process.env.HOME) env.HOME = process.env.HOME;
  if (process.env.USERPROFILE) env.USERPROFILE = process.env.USERPROFILE;
  return {
    codexPathOverride: extras.cliPath,
    env,
    config: { mcp_servers: {} },
  };
}

export function codexCompactThreadOptionsOf(input: ExternalCompactRequest): CodexThreadOptions {
  const model =
    input.modelId && input.modelId !== "default" ? { model: input.modelId } : {};
  return {
    ...model,
    sandboxMode: "danger-full-access",
    approvalPolicy: "never",
    workingDirectory: input.cwd,
    skipGitRepoCheck: true,
    networkAccessEnabled: false,
  };
}

export function codexCompactPromptOf(input: ExternalCompactRequest): string {
  return compactUserPrompt(input.prompt);
}

export function composePromptPrefix(systemAppend: string, prompt: string): string {
  const append = systemAppend.trim();
  const body = prompt.trim();
  const context = append
    ? `${CODEX_CONTEXT_HEADER}\n\n${append}`
    : CODEX_CONTEXT_HEADER;
  if (!body) return context;
  return `${context}\n\n---\n\n${body}`;
}

/** Host mcpServer（type/url/headers）→ Codex config.mcp_servers 形。 */
export function toCodexHttpMcp(server: Record<string, unknown>): Record<string, unknown> {
  const url = typeof server.url === "string" ? server.url : "";
  const headers =
    server.headers && typeof server.headers === "object" && !Array.isArray(server.headers)
      ? (server.headers as Record<string, string>)
      : {};
  return {
    url,
    http_headers: headers,
  };
}

/**
 * 起一轮专用 AskUser MCP；handler 内等 bridge 拿到真实 toolCallId。
 */
export async function openCodexAskUserMcp(
  input: ExternalTurnRequest,
  bridge: CodexAskUserIdBridge,
): Promise<ExternalMcpServer | null> {
  if (!input.askUser || !input.userId || !input.agentId) return null;
  return startExternalMcpServer({
    serverName: "agentup_ask",
    tools: [
      {
        name: "agentup_ask_user",
        description:
          "Ask the human a multiple-choice question and wait. Pass questions[{question, options[{label, description?}]}]. Do not invent other argument shapes.",
        inputSchema: CODEX_ASK_USER_INPUT_SCHEMA,
        handler: async (args) => {
          const text = await askUserExecute(input, args, bridge);
          return { text };
        },
      },
    ],
  });
}

async function askUserExecute(
  input: ExternalTurnRequest,
  args: Record<string, unknown>,
  bridge: CodexAskUserIdBridge,
): Promise<string> {
  if (!input.askUser || !input.userId || !input.agentId) {
    return "Ask user is unavailable in this session.";
  }
  const questions = codexAskUserArgsToQuestions(args);
  if (!questions) return `Invalid ask-user parameters. ${ASK_USER_HINT}`;
  // 等 stream 发布真实 mcp_tool_call.id；对不上会假「已终止」
  const toolCallId = await bridge.take(input.abortController.signal);
  const answer = (await input.askUser.request(
    {
      userId: input.userId,
      agentId: input.agentId,
      toolCallId,
      questions,
    },
    input.abortController.signal,
  )) as AskUserAnswer;
  return formatAskUserResultText(questions, answer);
}

/** 与 Cursor 同形的入参归一。 */
export function codexAskUserArgsToQuestions(args: unknown): AskUserQuestion[] | null {
  if (!args || typeof args !== "object" || Array.isArray(args)) return null;
  const row = args as Record<string, unknown>;

  if (Array.isArray(row.questions)) {
    return sdkAskUserQuestions(row.questions);
  }

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
