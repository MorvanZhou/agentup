/** 四种执行场景。工具、技能、工作区和提示都按这张表取配置，不在拼装处分支。 */
export const EXECUTION_MODES = ["single", "group-holder", "single-delegation", "group-delegation"] as const;

export type ExecutionMode = (typeof EXECUTION_MODES)[number];

export function executionModeOf(input: {
  kind: "interactive" | "group-holder" | "delegation";
  groupId?: string;
}): ExecutionMode {
  if (input.kind === "group-holder") return "group-holder";
  if (input.kind === "delegation") return input.groupId ? "group-delegation" : "single-delegation";
  return "single";
}
