import type { HitlExtensionContext, HitlOrigin } from "../origin.js";

export type ApprovalScope = "once" | "session" | "agent";

export interface ApprovalRequest {
  id: string;
  userId: string;
  agentId: string;
  toolCallId: string;
  toolName: string;
  args: Record<string, unknown>;
  /** visit=直聊；delegation=被委托子会话。缺省按 visit（旧盘孤儿）。 */
  origin?: HitlOrigin;
  taskId?: string;
  parentAgentId?: string;
  groupId?: string;
}

export type ProjectMountContext = {
  cwd: string;
  visitRoot: string;
  kind: "personal" | "agent";
  userDataRoot: string;
  /** 会话已绑定的内部工作区；可直接访问，但绝不作为用户项目挂载落盘。 */
  trustedRoots?: readonly string[];
};

export type ApprovalExtensionOptions = {
  /** 委托审批时解析专家展示名（备注名 / 名片名），写入 args.agent_name。 */
  resolveDelegationLabel?: (toAgentId: string) => Promise<string | undefined>;
  /** 直聊 / 委托子会话身份；缺省 visit。 */
  hitl?: HitlExtensionContext;
  /** 文件工具越界时触发挂载审批。 */
  projectMount?: ProjectMountContext;
};

export type MountGateResult = "continue" | undefined | { block: true; reason: string };
