/** 本机跨 Agent 委托任务状态。 */

/** 写入私人助理会话的异步完成通知 customType。 */
export const DELEGATION_RESULT_CUSTOM_TYPE = "agentup.delegation_result";

/** 每轮注入的相关专家卡片（Pi nextTurn custom message）。 */
export const RELEVANT_AGENTS_CUSTOM_TYPE = "agentup.relevant_agents";

/** 每轮注入的进行中委托摘要（Pi nextTurn custom message）。 */
export const ACTIVE_DELEGATIONS_CUSTOM_TYPE = "agentup.active_delegations";

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
  /**
   * 子会话经 deliver_artifacts 确认的附件（相对专家 cwd，含 `ARTIFACT/` 前缀）。
   * 未确认则缺省/空：协议不投递。
   */
  artifacts?: { path: string; size?: number }[];
  /** 是否已拷入父 visit 的 ARTIFACT/from-<name>-<id>/。 */
  artifactsDelivered?: boolean;
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
  /** AGENTS.md 工作规则；只参与检索打分，不注入候选名片。 */
  agentsText?: string;
};

export type DelegateRunResult = {
  task: DelegationTask;
  /** 同步完成时的正文；异步启动时为空。 */
  text?: string;
  /** 没有新开任务，而是插入了已在跑的同一专员任务。 */
  steered?: boolean;
};

/** 单次 fan-out 里的一项（agent_id + brief）。 */
export type DelegateFanoutItem = {
  toAgentId: string;
  brief: string;
};

/** 批量扇出结果：多项任务；wait=true 时 texts 与 tasks 对齐。 */
export type DelegateFanoutResult = {
  tasks: DelegationTask[];
  texts?: string[];
  /** 这些 task_id 是插入已有任务，不是新开的。 */
  steeredTaskIds?: string[];
};

/** 同用户并发执行中的委托上限（扇出排队，不拒收）。 */
export const MAX_DELEGATION_CONCURRENT = 4;

/** 单次 delegate_to_agent 的 tasks[] 上限。 */
export const MAX_DELEGATION_FANOUT = 8;
