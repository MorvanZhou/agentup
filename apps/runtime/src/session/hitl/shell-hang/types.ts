import type { HitlOrigin } from "../origin.js";

/** 用户对「命令跑太久」提示的选择。 */
export type ShellHangDecision = "kill" | "wait";

export type ShellHangRequest = {
  id: string;
  userId: string;
  agentId: string;
  toolCallId: string;
  toolName: string;
  /** 截断后的命令摘要，供 UI 展示。 */
  command: string;
  /** 触发提示时已等待的毫秒数。 */
  elapsedMs: number;
  origin?: HitlOrigin;
  taskId?: string;
  parentAgentId?: string;
};
