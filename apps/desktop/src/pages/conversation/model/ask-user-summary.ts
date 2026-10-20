/** 从 ask_user 工具 args + result 文本还原可展示的答题摘要。 */

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

  const byIndex = parseAnswerLines(text);
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
