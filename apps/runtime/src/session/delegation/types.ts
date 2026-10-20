/** 本机跨 Agent 委托任务状态。 */

/** 写入私人助理会话的异步完成通知 customType。 */
export const DELEGATION_RESULT_CUSTOM_TYPE = "agentup.delegation_result";

export type DelegationStatus =
  | "pending_auth"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

export type DelegationTask = {
  id: string;
  userId: string;
  fromAgentId: string;
  toAgentId: string;
  toAgentName: string;
  brief: string;
  status: DelegationStatus;
  createdAt: number;
  updatedAt: number;
  /** 同步等待时为 true；异步完成后靠通知回注助理。 */
  wait: boolean;
  resultSummary?: string;
  error?: string;
  /** 完成后是否已由桌面/助理确认看见。 */
  seen: boolean;
  /** 结果是否已写入私人助理会话。 */
  notified: boolean;
};

export type RecruitedAgentInfo = {
  agentId: string;
  name: string;
  summary: string;
  remark: string;
};

export type DelegateRunResult = {
  task: DelegationTask;
  /** 同步完成时的正文；异步启动时为空。 */
  text?: string;
};
