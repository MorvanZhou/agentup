import type { UIMessage } from "ai";

export const CONTEXT_RESET_TEXT = "已开始新对话，之后不再带入此前上下文";

/** 与 ask_user 正常取消文案对齐，便于桌面摘要识别为「已放弃」。 */
export const INTERRUPTED_ASK_USER_RESULT =
  "User dismissed the questions. Session was interrupted before answers were received.";
export const INTERRUPTED_TOOL_RESULT =
  "Tool call interrupted: the app exited before the tool finished.";

export function contextResetMessage(id: string): UIMessage {
  return {
    id: `context-reset-${id}`,
    role: "system",
    parts: [{ type: "text", text: CONTEXT_RESET_TEXT }],
    metadata: { custom: { agentUpKind: "context-reset" } },
  };
}
