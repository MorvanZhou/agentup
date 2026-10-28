import { argString } from "../shared/tool-args";

export type ShellHangDecideAction = "kill" | "wait" | "bg" | "";

export type ShellHangDecideOutcome =
  | "pending"
  | "kill"
  | "bg"
  | "wait_exited"
  | "wait_idle"
  | "wait_aborted"
  | "error"
  | "unknown";

export type ShellHangDecideView = {
  hangId: string;
  action: ShellHangDecideAction;
  outcome: ShellHangDecideOutcome;
  resultText: string;
};

function parseAction(value: unknown): ShellHangDecideAction {
  return value === "kill" || value === "wait" || value === "bg" ? value : "";
}

/** 从 runtime 返回文案推断裁决结果（details 不会进气泡）。 */
function outcomeFromResult(
  action: ShellHangDecideAction,
  resultText: string,
): ShellHangDecideOutcome {
  const text = resultText.trim();
  if (/^error\s*:/i.test(text)) return "error";
  if (/stopped hung shell/i.test(text)) return "kill";
  if (/left process running in the background/i.test(text)) return "bg";
  if (/process exited with code/i.test(text)) return "wait_exited";
  if (/\[shell_hang\]/i.test(text) || /process still running after idle/i.test(text)) {
    return "wait_idle";
  }
  if (/wait aborted/i.test(text)) return "wait_aborted";
  if (action === "kill" || action === "bg") return action;
  if (action === "wait") return "unknown";
  return "unknown";
}

/** 整理 shell_hang_decide 在消息流里要展示的 hang / 动作 / 结果。 */
export function shellHangDecideView(
  args: unknown,
  resultText: string,
  hasResult: boolean,
): ShellHangDecideView {
  const hangId = argString(args, "hang_id").trim();
  const action = parseAction(
    args && typeof args === "object"
      ? (args as Record<string, unknown>).action
      : undefined,
  );
  const trimmed = resultText.trim();
  if (!hasResult) {
    return { hangId, action, outcome: "pending", resultText: "" };
  }
  return {
    hangId,
    action,
    outcome: outcomeFromResult(action, trimmed),
    resultText: trimmed,
  };
}
