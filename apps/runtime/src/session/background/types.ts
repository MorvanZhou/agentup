/** 非专家后台作业（对齐 pi-background-tasks 的 bg_run 契约，自研实现）。 */

export const BACKGROUND_RESULT_CUSTOM_TYPE = "agentup.background_result";

export type BackgroundJobStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

export type BackgroundJob = {
  id: string;
  userId: string;
  /** 发起方 visit（私人助理或专家会话）。 */
  agentId: string;
  /** 群执掌者发起时，结果回到这间群，不唤醒一对一。 */
  groupId?: string;
  /** 可选短名，便于 Fleet / 模型识别。 */
  name: string;
  command: string;
  /** 绝对 cwd；落盘时记录，执行时校验仍在约定根下。 */
  cwd: string;
  status: BackgroundJobStatus;
  createdAt: number;
  updatedAt: number;
  exitCode?: number | null;
  /** 末尾输出摘要（通知 / status）。 */
  outputTail?: string;
  error?: string;
  seen: boolean;
  notified: boolean;
};

export const MAX_BACKGROUND_CONCURRENT = 4;
export const MAX_BACKGROUND_OUTPUT_TAIL = 4000;
