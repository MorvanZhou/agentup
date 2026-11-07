import type { ModelConfig } from "../../../config/load.js";
import type { Visit } from "../../../package/sync.js";
import type { ApprovalBroker } from "../../hitl/approval/index.js";
import type { ShellHangBroker } from "../../hitl/shell-hang/index.js";
import type { AskUserBroker } from "../../tools/ask-user.js";
import type { AsyncWakeItem } from "../../wake/index.js";
import type { DelegationSteerBlock } from "../steer.js";
import type { DelegationTask } from "../types.js";

export type DelegationServiceOptions = {
  userDataRoot: string;
  backendUrl: string;
  /** 有 pin 时按工单解析；旧工单不传 task，回落设备最近使用。 */
  getModel: (task?: DelegationTask, visit?: Visit) => ModelConfig;
  approvals: ApprovalBroker;
  askUser: AskUserBroker;
  shellHang?: ShellHangBroker;
  /**
   * 异步完成：排队空闲唤醒（不写可见历史气泡）。
   * list/ack 若尚未 notified 会再调 notifyParent 做恢复。
   */
  enqueueWake?: (item: AsyncWakeItem) => void;
};

export type DelegationSteerOutcome =
  | { queued: true; task: DelegationTask }
  | { queued: false; reason: DelegationSteerBlock; task: DelegationTask };
