/** present_artifacts 工具卡：从 args / result 抽出 action、路径与错误。 */

export type PresentArtifactsView = {
  action: string;
  paths: string[];
  error: string;
  /** set + 空网格：明确清空交付附件。 */
  cleared: boolean;
};

const ACTIONS = new Set(["set", "add", "remove"]);

/** 整理 present_artifacts 展示：成功列路径，Error: 进 error，清空有 cleared。 */
export function presentArtifactsView(args: unknown, resultText: string): PresentArtifactsView {
  const action = actionFromArgs(args);
  const requested = pathsFromArgs(args);
  const text = resultText.trim();
  if (!text) {
    return { action, paths: requested, error: "", cleared: false };
  }
  if (text.startsWith("Error:")) {
    return {
      action,
      paths: requested,
      error: text.slice("Error:".length).trim(),
      cleared: false,
    };
  }
  if (/Deliverables grid cleared/i.test(text)) {
    return { action, paths: [], error: "", cleared: true };
  }
  const listed = text
    .split("\n")
    .map((line) => /^-\s+(\S.*)$/.exec(line)?.[1]?.trim() ?? "")
    .filter((line) => line.length > 0);
  if (listed.length > 0) {
    return { action, paths: listed, error: "", cleared: false };
  }
  return { action, paths: requested, error: "", cleared: false };
}

function actionFromArgs(args: unknown): string {
  if (!args || typeof args !== "object") return "";
  const raw = (args as { action?: unknown }).action;
  if (typeof raw !== "string") return "";
  const trimmed = raw.trim();
  return ACTIONS.has(trimmed) ? trimmed : "";
}

function pathsFromArgs(args: unknown): string[] {
  if (!args || typeof args !== "object") return [];
  const paths = (args as { paths?: unknown }).paths;
  if (!Array.isArray(paths)) return [];
  return paths.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
}
