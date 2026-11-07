import fs from "node:fs";
import path from "node:path";

import { ConfigError } from "../../config/load.js";
import type { ModelConfig } from "../../config/load.js";
import {
  firstEnabledModelRef,
  loadModelConfig,
  loadModelConfigFromRef,
  tryEnabledModelRef,
} from "../../config/provider/index.js";
import type { ModelRef } from "../../config/provider/index.js";
import { PERSONAL_ASSISTANT_ID } from "../../local/assistant/personal-assistant.js";
import type { Visit } from "../../package/sync.js";
import { peekVisitModelRef } from "./session-model.js";

/** 统一：这次开口的人和被派出的人用同一个模型。单配：每人用自己一对一里选的模型。 */
export type ModelAssignmentMode = "unified" | "perAgent";

/** 记在工单上。统一在派出时写下模型；单配开跑时再读被派者。 */
export type DelegationModelPin =
  | { mode: "unified"; templateId: string; modelId: string }
  | { mode: "perAgent" };

export function parseModelAssignmentMode(value: unknown): ModelAssignmentMode {
  return value === "perAgent" || value === "per_agent" ? "perAgent" : "unified";
}

export function modelModeFromBody(value: unknown): ModelAssignmentMode | null {
  if (value === "unified") return "unified";
  if (value === "per_agent" || value === "perAgent") return "perAgent";
  return null;
}

/** 对外 API 用 snake_case，和会话模型的 template_id 一致。 */
export function modelModeWire(mode: ModelAssignmentMode): "unified" | "per_agent" {
  return mode === "perAgent" ? "per_agent" : "unified";
}

export function modelModePath(sessionDir: string): string {
  return path.join(sessionDir, "model-mode.json");
}

/** 缺文件或损坏都当统一，现有会话不用迁移。 */
export function readVisitModelMode(sessionDir: string): ModelAssignmentMode {
  const file = modelModePath(sessionDir);
  if (!fs.existsSync(file)) return "unified";
  try {
    const raw = JSON.parse(fs.readFileSync(file, "utf8")) as { mode?: unknown };
    return parseModelAssignmentMode(raw.mode);
  } catch {
    return "unified";
  }
}

/**
 * 群里这一轮开口用谁的模型。
 * 统一用房间自己的那份；房间还没有、或那份已停用时，抄开口者当前模型并要求调用方落盘。
 * 单配仍走开口者自己的一对一会话。两种都不在这里改设备「最近使用」。
 */
export function planGroupSpeakerModel(
  userDataRoot: string,
  input: { mode: ModelAssignmentMode; roomModel: ModelRef | null; speaker: ModelRef | null },
): { kind: "visit" } | { kind: "room"; ref: ModelRef; persist: boolean } {
  if (input.mode === "perAgent") return { kind: "visit" };
  const usable = input.roomModel ? tryEnabledModelRef(userDataRoot, input.roomModel) : null;
  if (usable) return { kind: "room", ref: usable, persist: false };
  if (input.speaker) return { kind: "room", ref: input.speaker, persist: true };
  return { kind: "visit" };
}

/** 只写分配方式，不改会话模型，也不动设备「最近使用」。 */
export function writeVisitModelMode(sessionDir: string, mode: ModelAssignmentMode): void {
  fs.mkdirSync(sessionDir, { recursive: true });
  const file = modelModePath(sessionDir);
  const temporary = `${file}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify({ mode }, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temporary, file);
}

/** 一对一模型模式跟这个 Agent 的 sessions 目录走。私人助理不在 agents/ 下。 */
export function agentSessionDir(userDataRoot: string, userId: string, agentId: string): string {
  if (agentId === PERSONAL_ASSISTANT_ID) {
    return path.join(userDataRoot, "users", userId, "personal-assistant", "sessions");
  }
  return path.join(userDataRoot, "users", userId, "agents", agentId, "sessions");
}

/**
 * 统一用派出时记下的、且仍启用的模型；失效则回落已启用第一项。
 * 单配用被派者当前会话模型（peek 已经含第一项回落）。
 */
export function delegationModelRef(input: {
  pin: DelegationModelPin;
  delegatee: ModelRef | null;
  fallback: ModelRef | null;
  pinnedUsable: ModelRef | null;
}): ModelRef | null {
  if (input.pin.mode === "unified") return input.pinnedUsable ?? input.fallback;
  return input.delegatee ?? input.fallback;
}

/**
 * 工单开跑时的模型。有 pin 时不读、不写设备「最近使用」。
 * 没有 pin 的旧工单仍走设备最近使用。
 */
export function resolveDelegationModelConfig(
  userDataRoot: string,
  task: { modelPin?: DelegationModelPin },
  visit: Visit,
  env: NodeJS.ProcessEnv = process.env,
): ModelConfig {
  const pin = task.modelPin;
  if (!pin) return loadModelConfig(userDataRoot, env);
  const fallback = firstEnabledModelRef(userDataRoot);
  const delegatee =
    pin.mode === "perAgent" ? peekVisitModelRef(userDataRoot, path.join(visit.root, "sessions")) : null;
  const pinnedUsable =
    pin.mode === "unified"
      ? tryEnabledModelRef(userDataRoot, { templateId: pin.templateId, modelId: pin.modelId })
      : null;
  const ref = delegationModelRef({ pin, delegatee, fallback, pinnedUsable });
  if (!ref) throw new ConfigError("打开会话前请先在设置中连接服务商并启用一个模型");
  return loadModelConfigFromRef(userDataRoot, ref, env);
}
