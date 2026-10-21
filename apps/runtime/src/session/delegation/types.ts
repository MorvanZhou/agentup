/** 本机跨 Agent 委托任务状态。 */

/** 写入私人助理会话的异步完成通知 customType。 */
export const DELEGATION_RESULT_CUSTOM_TYPE = "agentup.delegation_result";

/** 每轮注入的相关专家卡片（Pi nextTurn custom message）。 */
export const RELEVANT_AGENTS_CUSTOM_TYPE = "agentup.relevant_agents";

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

/** 已招募（或本机离线回退）专家名片；检索用语料。 */
export type RecruitedAgentInfo = {
  agentId: string;
  name: string;
  /** 职业 / 岗位。 */
  role: string;
  /** 人物背景（旧 summary）。 */
  background: string;
  remark: string;
  /** 派生 SYSTEM.md 全文；离线或打分用。 */
  systemText?: string;
};

export type DelegateRunResult = {
  task: DelegationTask;
  /** 同步完成时的正文；异步启动时为空。 */
  text?: string;
};
