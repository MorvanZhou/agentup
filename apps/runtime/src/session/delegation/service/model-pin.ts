import type { ModelConfig } from "../../../config/load.js";
import type { ModelRef } from "../../../config/provider/index.js";
import type { Visit } from "../../../package/sync.js";
import {
  replyModelFromConfig,
  replyModelFromRef,
  type AgentUpReplyModel,
} from "../../history/reply-model.js";
import {
  agentSessionDir,
  readVisitModelMode,
  type DelegationModelPin,
} from "../../model/assignment.js";
import { peekVisitModelRef } from "../../model/session-model.js";
import type { DelegationTask } from "../types.js";

/** 群统一抄本群模型；单配让调用方不写具体模型。 */
export type GroupSpeakerModelPlan = (input: {
  userId: string;
  groupId: string;
  speaker: ModelRef | null;
}) => { kind: "visit" } | { kind: "room"; ref: ModelRef };

/**
 * 一对一统一：记下开口者此刻的一对一模型。
 * 群统一：记下这间群自己的模型。单配：工单上不写具体模型。
 * 显式传入的 pin（嵌套）原样沿用，不经此函数。
 */
export function pinForDelegation(input: {
  userDataRoot: string;
  userId: string;
  fromAgentId: string;
  groupId?: string;
  groupSpeakerModel?: GroupSpeakerModelPlan;
}): DelegationModelPin {
  const speaker = peekVisitModelRef(
    input.userDataRoot,
    agentSessionDir(input.userDataRoot, input.userId, input.fromAgentId),
  );
  if (input.groupId) {
    const plan = input.groupSpeakerModel?.({
      userId: input.userId,
      groupId: input.groupId,
      speaker,
    });
    if (!plan || plan.kind === "visit") return { mode: "perAgent" };
    return { mode: "unified", templateId: plan.ref.templateId, modelId: plan.ref.modelId };
  }
  const mode = readVisitModelMode(
    agentSessionDir(input.userDataRoot, input.userId, input.fromAgentId),
  );
  if (mode === "perAgent" || !speaker) return { mode: "perAgent" };
  return { mode: "unified", templateId: speaker.templateId, modelId: speaker.modelId };
}

/**
 * 协助面板要在工具返回前就看到模型：visit 就绪后走 getModel（与 execute 同路）。
 * getModel 失败再回落 peek / pin 快照。
 */
export function liveReplyModel(input: {
  userDataRoot: string;
  getModel: (task?: DelegationTask, visit?: Visit) => ModelConfig;
  task: DelegationTask;
  visit: Visit;
  pin: DelegationModelPin;
  userId: string;
  toAgentId: string;
}): AgentUpReplyModel | undefined {
  try {
    return replyModelFromConfig(
      input.getModel(input.task, input.visit),
      input.userDataRoot,
    );
  } catch {
    return snapshotReplyModel({
      userDataRoot: input.userDataRoot,
      pin: input.pin,
      userId: input.userId,
      toAgentId: input.toAgentId,
    });
  }
}

/** 派出时尽量快照模型；统一用 pin，单配先读专员一对一 sidecar。 */
export function snapshotReplyModel(input: {
  userDataRoot: string;
  pin: DelegationModelPin;
  userId: string;
  toAgentId: string;
}): AgentUpReplyModel | undefined {
  if (input.pin.mode === "unified") {
    return replyModelFromRef(
      { templateId: input.pin.templateId, modelId: input.pin.modelId },
      input.userDataRoot,
    );
  }
  const specialist = peekVisitModelRef(
    input.userDataRoot,
    agentSessionDir(input.userDataRoot, input.userId, input.toAgentId),
  );
  if (!specialist) return undefined;
  return replyModelFromRef(specialist, input.userDataRoot);
}
