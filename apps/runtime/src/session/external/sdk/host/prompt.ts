import type { Message } from "@earendil-works/pi-ai";

/** 交付给外部 agent 的 prompt 上限：超了只留尾部。 */
export const MAX_PROMPT_CHARS = 60_000;
/** 最近几轮保留原文（一轮 = 一条用户消息 + 它之后的助手/工具结果）。 */
export const DEFAULT_RECENT_TURNS = 6;
/** 更早的消息每条压成多长的一行摘要。 */
const DEFAULT_DIGEST_CHARS = 120;

export type TranscriptPromptOptions = {
  maxChars?: number;
  recentTurns?: number;
  digestChars?: number;
};

/**
 * 把 transcript 折成一段任务描述：丢掉 Pi 的系统提示，只留对话本身。
 * 分层重放：最近 N 轮原文 + 更早的一行摘要；超预算先丢更早摘要并明说省略。
 * 上下文一律由 runtime 每轮重拼，不 resume 厂商 session。
 */
export function transcriptToPrompt(
  messages: readonly Message[],
  options: TranscriptPromptOptions = {},
): string {
  const maxChars = options.maxChars ?? MAX_PROMPT_CHARS;
  const recentTurns = options.recentTurns ?? DEFAULT_RECENT_TURNS;
  const digestChars = options.digestChars ?? DEFAULT_DIGEST_CHARS;

  const splitAt = recentTurnStartIndex(messages, recentTurns);
  const recent = messages
    .slice(splitAt)
    .map(messageToLine)
    .filter((line): line is string => line !== null);
  let digest = messages
    .slice(0, splitAt)
    .map((message) => digestLine(message, digestChars))
    .filter((line): line is string => line !== null);

  const joinWith = (digestLines: string[]): string => {
    const head =
      digestLines.length > 0 ? ["以下是更早对话的摘要（原文未展开）：", ...digestLines, "---"] : [];
    return [...head, ...recent].join("\n");
  };

  let dropped = 0;
  let text = joinWith(digest);
  while (text.length > maxChars && digest.length > 0) {
    digest = digest.slice(1);
    dropped += 1;
    text = joinWith(digest);
  }
  if (text.length > maxChars) text = `…${text.slice(-(maxChars - 1))}`;
  const notice = dropped > 0 ? `（已省略更早 ${dropped} 条消息，需要回顾请说）\n` : "";
  return `${notice}${text}`;
}

function recentTurnStartIndex(messages: readonly Message[], turns: number): number {
  if (turns <= 0) return 0;
  let seen = 0;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]!.role === "user") {
      seen += 1;
      if (seen === turns) return index;
    }
  }
  return 0;
}

function digestLine(message: Message, digestChars: number): string | null {
  const line = messageToLine(message);
  if (!line) return null;
  return line.length <= digestChars ? line : `${line.slice(0, digestChars)}…`;
}

function messageToLine(message: Message): string | null {
  if (message.role === "system") {
    // Pi 的系统提示里是 AgentUp 的工具清单与路径，喂给外部 agent 只会误导它
    return null;
  }
  if (message.role === "user") {
    return `用户：${contentToText(message.content)}`;
  }
  if (message.role === "assistant") {
    const parts = message.content.map((block) => {
      if (block.type === "text") return block.text;
      if (block.type === "toolCall") return `[调用工具 ${block.name}]`;
      return "";
    });
    const text = parts.filter((item) => item.length > 0).join("");
    return text ? `助手：${text}` : null;
  }
  return `工具结果（${message.toolName}）：${contentToText(message.content)}`;
}

function contentToText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((block) => {
      const row = block as { type?: string; text?: string };
      if (row?.type === "text") return row.text ?? "";
      if (row?.type === "image") return "[图片]";
      return "";
    })
    .filter((item) => item.length > 0)
    .join("\n");
}
