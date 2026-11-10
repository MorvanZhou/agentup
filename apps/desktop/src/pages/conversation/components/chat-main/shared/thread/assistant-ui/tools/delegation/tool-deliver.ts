export type DeliverArtifactView = {
  paths: string[];
  error: string;
  empty: boolean;
};

export type CompleteGroupTaskView = DeliverArtifactView & {
  nextStep: string;
};

/** 从 deliver_artifacts 的参数和结果整理出要展示的路径。 */
export function deliverArtifactView(args: unknown, resultText: string): DeliverArtifactView {
  const requested = pathsFromArgs(args);
  const text = resultText.trim();
  if (!text) return { paths: requested, error: "", empty: false };
  if (text.startsWith("Error:")) {
    return {
      paths: requested,
      error: text.slice("Error:".length).trim(),
      empty: false,
    };
  }
  const listed = text
    .split("\n")
    .map((line) => /^-\s+(\S.*)$/.exec(line)?.[1]?.trim() ?? "")
    .filter((line) => line.length > 0);
  if (listed.length > 0) return { paths: listed, error: "", empty: false };
  if (text.startsWith("Confirmed:")) return { paths: [], error: "", empty: true };
  return { paths: requested, error: "", empty: false };
}

/**
 * 群 complete_group_task：共享 WORK/ARTIFACT 路径 + next_step。
 * 结果行形如 `Next step: …` / `Next step: none.`。
 */
export function completeGroupTaskView(
  args: unknown,
  resultText: string,
): CompleteGroupTaskView {
  const base = deliverArtifactView(args, resultText);
  return { ...base, nextStep: nextStepFromComplete(args, resultText) };
}

function nextStepFromComplete(args: unknown, resultText: string): string {
  const text = resultText.trim();
  if (text) {
    const match = /^Next step:\s*(.*)$/im.exec(text);
    if (match) {
      const value = (match[1] ?? "").trim();
      if (!value || /^none\.?$/i.test(value)) return "";
      return value;
    }
  }
  if (!args || typeof args !== "object") return "";
  const raw = (args as { next_step?: unknown }).next_step;
  return typeof raw === "string" ? raw.trim() : "";
}

function pathsFromArgs(args: unknown): string[] {
  if (!args || typeof args !== "object") return [];
  const paths = (args as { paths?: unknown }).paths;
  if (!Array.isArray(paths)) return [];
  return paths.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
}
