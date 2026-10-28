import { isToolProgressActive } from "../../components/chat-main/shared/thread/assistant-ui/tools/shared/tool-args";

/** 判定步骤间隙用的最小 part 形状。 */
export type TurnProgressPart = {
  type: string;
  status?: { type: string; reason?: string };
  result?: unknown;
  isError?: boolean;
  isPreliminary?: boolean;
};

/** 该 part 是否仍在产出进度（打字 / 思考 / 工具进行中）。 */
export function isPartProgressActive(part: TurnProgressPart): boolean {
  if (part.type === "text" || part.type === "reasoning") {
    return part.status?.type === "running";
  }
  if (part.type !== "tool-call") return false;

  const statusType = part.status?.type ?? "complete";
  const cancelled =
    part.status?.type === "incomplete" && part.status.reason === "cancelled";
  const error =
    part.isError === true ||
    (part.status?.type === "incomplete" && part.status.reason === "error");
  return isToolProgressActive(statusType, {
    cancelled,
    error,
    hasResult: part.result !== undefined,
    isPreliminary: part.isPreliminary === true,
  });
}

/**
 * turn 仍在 running，但当前没有任何 part 在推进时，视为等待下一步
 *（空消息、工具刚完成等下一 token 等）。
 */
export function isAwaitingNextStep(
  parts: readonly TurnProgressPart[],
  messageRunning: boolean,
): boolean {
  if (!messageRunning) return false;
  return !parts.some(isPartProgressActive);
}
