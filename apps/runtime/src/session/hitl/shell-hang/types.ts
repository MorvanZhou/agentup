import type { HitlOrigin } from "../origin.js";

/** 对挂起命令的裁决：终止 / 再等 / 转后台留下。 */
export type ShellHangDecision = "kill" | "wait" | "bg";

/** 人审弹窗（agent 未决时的兜底）。 */
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

/** 空闲后从 blocking shell 拆出、仍存活的进程。 */
export type ParkedShellHang = {
  id: string;
  userId: string;
  agentId: string;
  toolCallId: string;
  toolName: string;
  command: string;
  pid: number;
  cwd: string;
  startedAt: number;
  parkedAt: number;
  /** 拆出后继续追加的输出尾部。 */
  outputTail: string;
  waitCount: number;
  origin?: HitlOrigin;
  taskId?: string;
  parentAgentId?: string;
};
