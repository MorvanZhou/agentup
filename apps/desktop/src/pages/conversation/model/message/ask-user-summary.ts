/** 从 ask_user 工具 args + result 文本还原可展示的答题摘要。 */

/**
 * 气泡里仍有未答完的 ask_user（浮层可能已撤）。
 * 不绑死 part.type：流式里可能是 `tool-call` / `dynamic-tool`，AUI 投影字段也不一。
 * 有 result/output 或已到 output-* 态才算答完。
 */
export function isOpenAskUserPart(part: {
  type?: string;
  toolName?: string;
  args?: unknown;
  result?: unknown;
  output?: unknown;
  state?: string;
}): boolean {
  if (!isAskUserToolName(part.toolName, part.args)) return false;
  if (part.result != null) return false;
  if (part.output != null) return false;
  if (part.state === "output-available" || part.state === "output-error") return false;
  return true;
}

/** Pi / CodeBuddy 原名；Cursor 旧壳 mcp + agentup_ask_user。 */
function isAskUserToolName(toolName: string | undefined, args: unknown): boolean {
  if (toolName === "ask_user" || toolName === "AskUserQuestion") return true;
  if (toolName !== "mcp" || !args || typeof args !== "object" || Array.isArray(args)) {
    return false;
  }
  const row = args as Record<string, unknown>;
  return row.toolName === "agentup_ask_user";
}

export type AskUserSummaryRow = {
  index: number;
  question: string;
  context?: string;
  mode: "单选" | "多选";
  status: "answered" | "skipped" | "pending";
  /** 展示用答案文案；跳过/等待时为固定文案。 */
  answerLabel: string;
  /** 多选时拆开的选项；单选/自由输入为一个元素。 */
  answers: string[];
};

export type AskUserSummary = {
  cancelled: boolean;
  rows: AskUserSummaryRow[];
};

type QuestionArg = {
  question: string;
  context?: string;
  allowMultiple: boolean;
};

type ParsedAnswer = { skipped: boolean; answers: string[] };

export function summarizeAskUserTool(args: unknown, result: unknown): AskUserSummary {
  const questions = readQuestions(args);
  const text = typeof result === "string" ? result : result === undefined ? "" : String(result);
  const cancelled =
    Boolean(text) &&
    /dismissed|cancelled|放弃|取消|interrupted|中断/i.test(text) &&
    !/^User answered:/m.test(text);

  if (cancelled) {
    const label = /interrupted|中断/i.test(text) ? "已中断" : "已放弃";
    return {
      cancelled: true,
      rows: questions.map((q, index) => row(index, q, "skipped", label, [])),
    };
  }

  // 优先 Host 标准行；再认 SDK 厂商 JSON（如 dsh onUserQuestion 回填）
  const byIndex = parseAnswerLines(text);
  if (byIndex.size === 0) {
    for (const [index, value] of parseVendorJsonAnswers(text, args)) {
      byIndex.set(index, value);
    }
  }
  const byQuestion = new Map<string, ParsedAnswer>();
  for (const [index, value] of byIndex) {
    const q = questions[index]?.question;
    if (q) byQuestion.set(q, value);
  }

  return {
    cancelled: false,
    rows: questions.map((q, index) => {
      const hit = byIndex.get(index) ?? byQuestion.get(q.question);
      if (!hit) {
        if (!text) return row(index, q, "pending", "等待回答", []);
        return row(index, q, "skipped", "已跳过", []);
      }
      if (hit.skipped) return row(index, q, "skipped", "已跳过", []);
      return row(index, q, "answered", hit.answers.join("；"), hit.answers);
    }),
  };
}

function row(
  index: number,
  q: QuestionArg,
  status: AskUserSummaryRow["status"],
  answerLabel: string,
  answers: string[],
): AskUserSummaryRow {
  return {
    index,
    question: q.question,
    context: q.context,
    mode: q.allowMultiple ? "多选" : "单选",
    status,
    answerLabel,
    answers,
  };
}

function readQuestions(args: unknown): QuestionArg[] {
  if (!args || typeof args !== "object") return [];
  const questions = (args as { questions?: unknown }).questions;
  if (!Array.isArray(questions)) return [];
  return questions.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const record = item as Record<string, unknown>;
    if (typeof record.question !== "string" || !record.question.trim()) return [];
    return [
      {
        question: record.question.trim(),
        context: typeof record.context === "string" ? record.context : undefined,
        allowMultiple: record.allowMultiple === true,
      },
    ];
  });
}

function parseAnswerLines(text: string): Map<number, ParsedAnswer> {
  const map = new Map<number, ParsedAnswer>();
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    const match = /^(\d+)\.\s*(.+?)\s*→\s*(.+)$/.exec(line);
    if (!match) continue;
    const index = Number(match[1]) - 1;
    if (!Number.isFinite(index) || index < 0) continue;
    const answer = match[3]!.trim();
    if (answer === "(skipped)" || answer === "已跳过") {
      map.set(index, { skipped: true, answers: [] });
      continue;
    }
    const answers = answer
      .split(/\s*;\s*/)
      .map((part) => part.trim())
      .filter(Boolean);
    map.set(index, { skipped: false, answers: answers.length > 0 ? answers : [answer] });
  }
  return map;
}

/**
 * dsh 等 SDK：toolResult 可能是 `{"answers":[{"id","selected","custom?"}]}`，
 * 不是 `User answered:` 行。按题 id / 下标对齐，避免整卡误标「已跳过」。
 */
function parseVendorJsonAnswers(text: string, args: unknown): Map<number, ParsedAnswer> {
  const map = new Map<number, ParsedAnswer>();
  const trimmed = text.trim();
  if (!trimmed.startsWith("{")) return map;
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return map;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return map;
  const answers = (parsed as { answers?: unknown }).answers;
  if (!Array.isArray(answers) || answers.length === 0) return map;

  const idToIndex = new Map<string, number>();
  if (args && typeof args === "object" && !Array.isArray(args)) {
    const questions = (args as { questions?: unknown }).questions;
    if (Array.isArray(questions)) {
      questions.forEach((item, index) => {
        if (!item || typeof item !== "object" || Array.isArray(item)) return;
        const id = (item as { id?: unknown }).id;
        if (typeof id === "string" && id.trim()) idToIndex.set(id.trim(), index);
      });
    }
  }

  answers.forEach((raw, fallbackIndex) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return;
    const row = raw as Record<string, unknown>;
    const id = typeof row.id === "string" ? row.id.trim() : "";
    const index = (id && idToIndex.has(id) ? idToIndex.get(id) : undefined) ?? fallbackIndex;
    if (!Number.isFinite(index) || index < 0) return;
    const custom = typeof row.custom === "string" ? row.custom.trim() : "";
    if (custom) {
      map.set(index, { skipped: false, answers: [custom] });
      return;
    }
    const selected = Array.isArray(row.selected)
      ? row.selected
          .filter((part): part is string => typeof part === "string")
          .map((part) => part.trim())
          .filter(Boolean)
      : [];
    if (selected.length === 0) {
      map.set(index, { skipped: true, answers: [] });
      return;
    }
    map.set(index, { skipped: false, answers: selected });
  });
  return map;
}
