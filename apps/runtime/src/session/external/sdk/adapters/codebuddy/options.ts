import type { ExternalTurnRequest } from "../../contract.js";
import type {
  AskUserAnswer,
  AskUserQuestion,
} from "../../../../tools/ask-user.js";

/**
 * ExternalTurnRequest → CodeBuddy query options。
 * 信任模式：bypass + canUseTool 恒 allow；AskUserQuestion 走宿主 sink。
 */
export function codebuddyOptionsOf(input: ExternalTurnRequest): Record<string, unknown> {
  const model = input.modelId ? { model: input.modelId } : {};
  return {
    abortController: input.abortController,
    cwd: input.cwd,
    ...(input.systemAppend ? { systemPrompt: { append: input.systemAppend } } : {}),
    ...(input.additionalDirs.length > 0 ? { additionalDirectories: input.additionalDirs } : {}),
    permissionMode: "bypassPermissions",
    canUseTool: canUseToolOf(input),
    includePartialMessages: true,
    // 上下文由 runtime 每轮重拼：不 resume，也不落厂商 projects 副本
    persistSession: false,
    ...model,
    ...(input.cliPath ? { pathToCodebuddyCode: input.cliPath } : {}),
    ...(input.mcpServer ? { mcpServers: { agentup: input.mcpServer } } : {}),
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
  // 优先 Host abortController：Composer 停止必须硬中断问卷，勿只依赖厂商 options.signal
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
