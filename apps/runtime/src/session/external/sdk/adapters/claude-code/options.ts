import type { ExternalCompactRequest, ExternalTurnRequest } from "../../contract.js";
import type {
  AskUserAnswer,
  AskUserQuestion,
} from "../../../../tools/ask-user.js";
import { COMPACT_SYSTEM_PROMPT } from "../../host/compact-instruction.js";
import { ensureClaudeHome, readClaudeApiKey } from "./home.js";
import { resolveClaudeCliPath } from "./load.js";

/**
 * ExternalTurnRequest → Claude Agent SDK query options。
 * 信任模式：bypass + allowDangerouslySkipPermissions + canUseTool 恒 allow；
 * AskUserQuestion 走宿主 sink。
 * systemPrompt：preset claude_code + append（保留厂商默认）。
 */

export function claudeOptionsOf(input: ExternalTurnRequest): Record<string, unknown> {
  const home = ensureClaudeHome(input.userDataRoot, input.templateId);
  const apiKey = readClaudeApiKey(input.userDataRoot, input.templateId);
  const cliPath = input.cliPath || resolveClaudeCliPath(input.userDataRoot, input.templateId);
  const model =
    input.modelId && input.modelId !== "default" ? { model: input.modelId } : {};

  // TS SDK 的 env 整表替换（非 merge）→ 必须展开 process.env
  const env: Record<string, string | undefined> = {
    ...process.env,
    CLAUDE_CONFIG_DIR: home,
    CLAUDE_CODE_DISABLE_AUTO_MEMORY: "1",
  };
  if (apiKey) env.ANTHROPIC_API_KEY = apiKey;

  return {
    abortController: input.abortController,
    cwd: input.cwd,
    // preset + append：只叠 Host context，不盖掉 Claude Agent 默认系统提示
    ...(input.systemAppend
      ? {
          systemPrompt: {
            type: "preset",
            preset: "claude_code",
            append: input.systemAppend,
          },
        }
      : {}),
    ...(input.additionalDirs.length > 0
      ? { additionalDirectories: input.additionalDirs }
      : {}),
    permissionMode: "bypassPermissions",
    allowDangerouslySkipPermissions: true,
    canUseTool: canUseToolOf(input),
    includePartialMessages: true,
    // 上下文由 runtime 每轮重拼：不 resume，也不落厂商 projects 副本
    persistSession: false,
    // 只读项目层：技能投影在 cwd/.claude/skills；勿吞用户 ~/.claude settings
    settingSources: ["project"],
    ...model,
    ...(cliPath ? { pathToClaudeCodeExecutable: cliPath } : {}),
    ...(input.mcpServer ? { mcpServers: { agentup: input.mcpServer } } : {}),
    env,
  };
}

/**
 * 受限压缩 options：空 cwd、无 additionalDirectories / mcpServers、
 * systemPrompt 整段替换、canUseTool 恒 deny、不读 project settings。
 */
export function claudeCompactOptionsOf(input: ExternalCompactRequest): Record<string, unknown> {
  const home = ensureClaudeHome(input.userDataRoot, input.templateId);
  const apiKey = readClaudeApiKey(input.userDataRoot, input.templateId);
  const cliPath = input.cliPath || resolveClaudeCliPath(input.userDataRoot, input.templateId);
  const model =
    input.modelId && input.modelId !== "default" ? { model: input.modelId } : {};

  const env: Record<string, string | undefined> = {
    ...process.env,
    CLAUDE_CONFIG_DIR: home,
    CLAUDE_CODE_DISABLE_AUTO_MEMORY: "1",
  };
  if (apiKey) env.ANTHROPIC_API_KEY = apiKey;

  return {
    abortController: input.abortController,
    cwd: input.cwd,
    systemPrompt: COMPACT_SYSTEM_PROMPT,
    permissionMode: "bypassPermissions",
    allowDangerouslySkipPermissions: true,
    canUseTool: async () => ({
      behavior: "deny" as const,
      message: "压缩回合不允许使用工具",
    }),
    includePartialMessages: false,
    persistSession: false,
    // 空数组：不读项目 skills / settings
    settingSources: [],
    maxTurns: 1,
    ...model,
    ...(cliPath ? { pathToClaudeCodeExecutable: cliPath } : {}),
    env,
  };
}

function canUseToolOf(input: ExternalTurnRequest) {
  return async (
    toolName: string,
    toolInput: Record<string, unknown>,
    options: { toolUseID?: string; signal?: AbortSignal },
  ): Promise<
    | { behavior: "allow"; updatedInput?: Record<string, unknown> }
    | { behavior: "deny"; message: string }
  > => {
    if (toolName === "AskUserQuestion") {
      return askUserQuestion(input, toolInput, options);
    }
    return { behavior: "allow" };
  };
}

async function askUserQuestion(
  input: ExternalTurnRequest,
  toolInput: Record<string, unknown>,
  options: { toolUseID?: string; signal?: AbortSignal },
): Promise<
  | { behavior: "allow"; updatedInput: Record<string, unknown> }
  | { behavior: "deny"; message: string }
> {
  if (!input.askUser || !input.userId || !input.agentId) {
    return { behavior: "deny", message: "当前没有可提问的通道" };
  }
  const questions = sdkAskUserQuestions(toolInput.questions);
  if (!questions) return { behavior: "deny", message: "提问参数无效" };
  // 优先 Host abortController：Composer 停止必须硬中断问卷
  const answer = (await input.askUser.request(
    {
      userId: input.userId,
      agentId: input.agentId,
      toolCallId: options.toolUseID || "sdk-ask-user",
      questions,
    },
    input.abortController.signal,
  )) as AskUserAnswer;
  if (answer.kind === "cancelled") {
    return { behavior: "deny", message: "用户取消了提问" };
  }
  const answers: Record<string, string> = {};
  for (let index = 0; index < questions.length; index += 1) {
    const item = answer.items[index];
    if (!item || item.kind === "skipped") continue;
    answers[questions[index]!.question] =
      item.kind === "freeform" ? item.text : item.selections.join(", ");
  }
  return { behavior: "allow", updatedInput: { ...toolInput, answers } };
}

function sdkAskUserQuestions(raw: unknown): AskUserQuestion[] | null {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const questions: AskUserQuestion[] = [];
  for (const value of raw) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const row = value as Record<string, unknown>;
    const question = typeof row.question === "string" ? row.question.trim() : "";
    if (!question || !Array.isArray(row.options)) return null;
    const options = row.options.flatMap((option) => {
      if (!option || typeof option !== "object" || Array.isArray(option)) return [];
      const item = option as Record<string, unknown>;
      const title = typeof item.label === "string" ? item.label.trim() : "";
      if (!title) return [];
      const description =
        typeof item.description === "string" && item.description.trim()
          ? item.description.trim()
          : undefined;
      return [description ? { title, description } : { title }];
    });
    if (options.length === 0) return null;
    const context =
      typeof row.header === "string" && row.header.trim() ? row.header.trim() : undefined;
    questions.push({
      question,
      ...(context ? { context } : {}),
      options,
      allowMultiple: row.multiSelect === true,
    });
  }
  return questions;
}
