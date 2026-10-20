import { randomUUID } from "node:crypto";

import { Type } from "@earendil-works/pi-ai";
import { defineTool, type ExtensionFactory } from "@earendil-works/pi-coding-agent";

export const ASK_USER_TOOL = "ask_user";

export type AskUserOption = {
  title: string;
  description?: string;
};

export type AskUserQuestion = {
  question: string;
  context?: string;
  options: AskUserOption[];
  allowMultiple: boolean;
};

/** 单题答案；整批取消用 cancelled。 */
export type AskUserItemAnswer =
  | { kind: "selection"; selections: string[] }
  | { kind: "freeform"; text: string }
  | { kind: "skipped" };

export type AskUserAnswer =
  | { kind: "cancelled" }
  | { kind: "answers"; items: AskUserItemAnswer[] };

export type AskUserRequest = {
  id: string;
  userId: string;
  agentId: string;
  toolCallId: string;
  questions: AskUserQuestion[];
};

type AskUserResponse =
  | { kind: "selection"; selections: string[] }
  | { kind: "freeform"; text: string };

type AskUserDetails =
  | { error: string }
  | {
      questions: AskUserQuestion[];
      answers: Array<
        | { status: "answered"; response: AskUserResponse }
        | { status: "skipped" }
      >;
      cancelled: boolean;
    };

const OptionSchema = Type.Object({
  title: Type.String({ description: "选项标题，展示给用户" }),
  description: Type.Optional(Type.String({ description: "选项说明" })),
});

const QuestionItemSchema = Type.Object({
  question: Type.String({ description: "该题的问题文本" }),
  context: Type.Optional(Type.String({ description: "该题背景" })),
  options: Type.Array(OptionSchema, {
    description: "预设选项（至少 1 个）。UI 会在末尾固定追加「自己输入」",
    minItems: 1,
  }),
  allowMultiple: Type.Optional(
    Type.Boolean({ description: "true 为多选，false/省略为单选" }),
  ),
});

const AskUserParams = Type.Object({
  questions: Type.Array(QuestionItemSchema, {
    description:
      "一道或多道选择题（至少 1 道；单题也用本数组，长度为 1）。仅单选/多选；每题末尾由 UI 提供手动输入",
    minItems: 1,
  }),
});

export class AskUserBroker {
  private readonly pending = new Map<
    string,
    { request: AskUserRequest; resolve: (answer: AskUserAnswer) => void; cleanup: () => void }
  >();
  private readonly listeners = new Set<(request: AskUserRequest) => void>();

  request(request: Omit<AskUserRequest, "id">, signal?: AbortSignal): Promise<AskUserAnswer> {
    const value = { ...request, id: randomUUID() };
    return new Promise((resolve) => {
      const abort = () => {
        this.pending.delete(value.id);
        resolve({ kind: "cancelled" });
      };
      const cleanup = () => signal?.removeEventListener("abort", abort);
      if (signal?.aborted) {
        resolve({ kind: "cancelled" });
        return;
      }
      signal?.addEventListener("abort", abort, { once: true });
      this.pending.set(value.id, { request: value, resolve, cleanup });
      for (const listener of this.listeners) listener(value);
    });
  }

  answer(id: string, answer: AskUserAnswer): boolean {
    const pending = this.pending.get(id);
    if (!pending) return false;
    if (answer.kind === "answers" && answer.items.length !== pending.request.questions.length) {
      return false;
    }
    this.pending.delete(id);
    pending.cleanup();
    pending.resolve(answer);
    return true;
  }

  subscribe(listener: (request: AskUserRequest) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}

export function createAskUserExtension(
  broker: AskUserBroker,
  userId: string,
  agentId: string,
): ExtensionFactory {
  return (pi) => {
    pi.registerTool(
      defineTool<typeof AskUserParams, AskUserDetails>({
        name: ASK_USER_TOOL,
        label: "Ask User",
        description:
          "Ask the user clarifying questions and wait for their answers before continuing. " +
          "Use whenever a choice, preference, confirmation, or missing detail would change " +
          "what you do next. Pass one or more items in questions[]; each item offers preset " +
          "options (single- or multi-select via allowMultiple). The UI adds a freeform input " +
          "as the last choice—do not invent that option yourself.",
        parameters: AskUserParams,
        annotations: {
          readOnlyHint: true,
          openWorldHint: false,
          destructiveHint: false,
        },
        async execute(toolCallId, params, signal) {
          const questions = normalizeQuestions(params.questions);
          if ("error" in questions) {
            return {
              content: [{ type: "text", text: `Error: ${questions.error}` }],
              details: { error: questions.error },
            };
          }
          const answer = await broker.request(
            {
              userId,
              agentId,
              toolCallId,
              questions: questions.items,
            },
            signal,
          );
          return formatAnswer(questions.items, answer);
        },
      }),
    );
  };
}

function normalizeQuestions(
  raw: Array<{
    question: string;
    context?: string;
    options: Array<{ title: string; description?: string }>;
    allowMultiple?: boolean;
  }>,
): { items: AskUserQuestion[] } | { error: string } {
  if (!Array.isArray(raw) || raw.length < 1) {
    return { error: "questions must have at least 1 item" };
  }
  const items: AskUserQuestion[] = [];
  for (const entry of raw) {
    const item = toQuestion(entry);
    if ("error" in item) return item;
    items.push(item);
  }
  return { items };
}

function toQuestion(raw: {
  question: string;
  context?: string;
  options?: Array<{ title: string; description?: string }>;
  allowMultiple?: boolean;
}): AskUserQuestion | { error: string } {
  const question = typeof raw.question === "string" ? raw.question.trim() : "";
  if (!question) return { error: "empty_question" };
  const options = normalizeOptions(raw.options);
  if (options.length === 0) return { error: "options_required" };
  return {
    question,
    context: optionalTrim(raw.context),
    options,
    allowMultiple: raw.allowMultiple === true,
  };
}

function normalizeOptions(raw: unknown): AskUserOption[] {
  if (!Array.isArray(raw)) return [];
  const options: AskUserOption[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const title = optionTitle(record);
    if (!title) continue;
    const description =
      typeof record.description === "string" ? record.description.trim() : undefined;
    options.push(description ? { title, description } : { title });
  }
  return options;
}

function optionTitle(record: Record<string, unknown>): string | undefined {
  for (const key of ["title", "label", "text", "value", "name", "option"] as const) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
}

function optionalTrim(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function formatAnswer(
  questions: AskUserQuestion[],
  answer: AskUserAnswer,
): { content: [{ type: "text"; text: string }]; details: AskUserDetails } {
  if (answer.kind === "cancelled") {
    return {
      content: [
        {
          type: "text",
          text: "User dismissed the questions. Proceed with your best judgment, or ask again if the answers are required.",
        },
      ],
      details: { questions, answers: [], cancelled: true },
    };
  }
  const lines: string[] = [];
  const detailsAnswers: Array<
    { status: "answered"; response: AskUserResponse } | { status: "skipped" }
  > = [];
  for (let index = 0; index < questions.length; index += 1) {
    const item = answer.items[index] ?? { kind: "skipped" as const };
    const q = questions[index]!;
    if (item.kind === "skipped") {
      lines.push(`${index + 1}. ${q.question} → (skipped)`);
      detailsAnswers.push({ status: "skipped" });
      continue;
    }
    if (item.kind === "freeform") {
      lines.push(`${index + 1}. ${q.question} → ${item.text}`);
      detailsAnswers.push({ status: "answered", response: { kind: "freeform", text: item.text } });
      continue;
    }
    const joined = item.selections.join("; ");
    lines.push(`${index + 1}. ${q.question} → ${joined}`);
    detailsAnswers.push({
      status: "answered",
      response: { kind: "selection", selections: item.selections },
    });
  }
  return {
    content: [{ type: "text", text: `User answered:\n${lines.join("\n")}` }],
    details: { questions, answers: detailsAnswers, cancelled: false },
  };
}

/** 校验桌面提交的答案体。 */
export function parseAskUserAnswer(body: unknown): AskUserAnswer | undefined {
  if (typeof body !== "object" || body === null) return undefined;
  const record = body as Record<string, unknown>;
  if (record.cancelled === true) return { kind: "cancelled" };
  const answer = record.answer;
  if (typeof answer !== "object" || answer === null) return undefined;
  const value = answer as Record<string, unknown>;
  if (value.kind === "cancelled") return { kind: "cancelled" };
  if (value.kind === "answers" && Array.isArray(value.items)) {
    const items: AskUserItemAnswer[] = [];
    for (const raw of value.items) {
      const item = parseItemAnswer(raw);
      if (!item) return undefined;
      items.push(item);
    }
    if (items.length === 0) return undefined;
    return { kind: "answers", items };
  }
  return undefined;
}

function parseItemAnswer(raw: unknown): AskUserItemAnswer | undefined {
  if (typeof raw !== "object" || raw === null) return undefined;
  const value = raw as Record<string, unknown>;
  if (value.kind === "skipped") return { kind: "skipped" };
  if (value.kind === "freeform" && typeof value.text === "string") {
    const text = value.text.trim();
    if (!text) return undefined;
    return { kind: "freeform", text };
  }
  if (value.kind === "selection" && Array.isArray(value.selections)) {
    const selections = value.selections
      .filter((item): item is string => typeof item === "string")
      .map((item) => item.trim())
      .filter(Boolean);
    if (selections.length === 0) return undefined;
    return { kind: "selection", selections };
  }
  return undefined;
}
