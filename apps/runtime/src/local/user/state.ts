import fs from "node:fs";
import path from "node:path";

export type CommandAllowScope = "session" | "agent";

export type UserState = {
  unread: Record<string, number>;
  /** 侧栏最新消息预览；正文真相仍在 sessions/。 */
  previews: Record<string, string>;
  /** 侧栏排序用：各 Agent 最近一轮对话结束时间（毫秒）。 */
  lastActiveAt: Record<string, number>;
  commandAllow: Record<string, CommandAllowScope>;
  /**
   * 会诊授权：
   * - `session`：key = toAgentId（本对话仅此专家）
   * - `agent`：key = fromAgentId（该助手可调任何人，跨对话保留）
   */
  delegationAllow: Record<string, CommandAllowScope>;
  /**
   * MCP 等工具授权：agentId → toolName → scope。
   * `session` 随新对话清掉；`agent` 跨对话 / 重启保留。
   */
  toolAllow: Record<string, Record<string, CommandAllowScope>>;
  /**
   * 项目目录挂载自动审批：越界路径审批通过后，
   * `session`/`agent` 级可在后续越界访问时自动挂载（仍走 validateCandidateRoot）。
   */
  pathMountAllow: Record<string, CommandAllowScope>;
};

const AGENT_ID = /^[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*$/;
const PREVIEW_MAX = 200;

export class StateError extends Error {}

/** 读取用户级本机状态；文件不存在时返回空状态。 */
export function readState(userDataRoot: string, userId: string): UserState {
  validateUserId(userId);
  const file = statePath(userDataRoot, userId);
  if (!fs.existsSync(file)) return emptyState();
  try {
    return validate(JSON.parse(fs.readFileSync(file, "utf8")) as unknown);
  } catch (error) {
    if (error instanceof StateError) throw error;
    throw new StateError("本机状态无法读取");
  }
}

/** 原子写入用户级本机状态。 */
export function writeState(userDataRoot: string, userId: string, value: UserState): UserState {
  validateUserId(userId);
  const state = validate(value);
  const file = statePath(userDataRoot, userId);
  const temporary = `${file}.tmp`;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(temporary, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temporary, file);
  return state;
}

/** 更新未读、侧栏预览与最近活跃时间，保留命令授权。 */
export function writeUiState(
  userDataRoot: string,
  userId: string,
  unread: Record<string, number>,
  previews: Record<string, string>,
  lastActiveAt: Record<string, number>,
): UserState {
  const current = readState(userDataRoot, userId);
  return writeState(userDataRoot, userId, { ...current, unread, previews, lastActiveAt });
}

export function getCommandAllow(
  userDataRoot: string,
  userId: string,
  agentId: string,
): CommandAllowScope | undefined {
  return readState(userDataRoot, userId).commandAllow[agentId];
}

/** 授予命令授权；已有 agent 级时不会被 session 降级。 */
export function setCommandAllow(
  userDataRoot: string,
  userId: string,
  agentId: string,
  scope: CommandAllowScope,
): UserState {
  if (!AGENT_ID.test(agentId)) throw new StateError("本机状态无效");
  const current = readState(userDataRoot, userId);
  const previous = current.commandAllow[agentId];
  if (previous === "agent" && scope === "session") return current;
  if (previous === scope) return current;
  return writeState(userDataRoot, userId, {
    ...current,
    commandAllow: { ...current.commandAllow, [agentId]: scope },
  });
}

/** 开始新对话时去掉 session 级授权，保留 agent 级。 */
export function clearSessionCommandAllow(
  userDataRoot: string,
  userId: string,
  agentId: string,
): UserState {
  const current = readState(userDataRoot, userId);
  if (current.commandAllow[agentId] !== "session") return current;
  const commandAllow = { ...current.commandAllow };
  delete commandAllow[agentId];
  return writeState(userDataRoot, userId, { ...current, commandAllow });
}

/** 去掉该 Agent 的命令授权（任意 scope；对话配置选「每次询问」）。 */
export function clearCommandAllow(
  userDataRoot: string,
  userId: string,
  agentId: string,
): UserState {
  const current = readState(userDataRoot, userId);
  if (!(agentId in current.commandAllow)) return current;
  const commandAllow = { ...current.commandAllow };
  delete commandAllow[agentId];
  return writeState(userDataRoot, userId, { ...current, commandAllow });
}

/** 解雇时清掉该 Agent 的未读、预览、最近活跃、命令/会诊/工具授权（含以其为 from 的可调任何人）。 */
export function forgetAgent(userDataRoot: string, userId: string, agentId: string): UserState {
  if (!AGENT_ID.test(agentId)) throw new StateError("本机状态无效");
  const current = readState(userDataRoot, userId);
  const unread = { ...current.unread };
  const previews = { ...current.previews };
  const lastActiveAt = { ...current.lastActiveAt };
  const commandAllow = { ...current.commandAllow };
  const delegationAllow = { ...current.delegationAllow };
  const toolAllow = { ...current.toolAllow };
  const pathMountAllow = { ...current.pathMountAllow };
  delete unread[agentId];
  delete previews[agentId];
  delete lastActiveAt[agentId];
  delete commandAllow[agentId];
  delete delegationAllow[agentId];
  delete toolAllow[agentId];
  delete pathMountAllow[agentId];
  return writeState(userDataRoot, userId, {
    unread,
    previews,
    lastActiveAt,
    commandAllow,
    delegationAllow,
    toolAllow,
    pathMountAllow,
  });
}

export function getPathMountAllow(
  userDataRoot: string,
  userId: string,
  agentId: string,
): CommandAllowScope | undefined {
  return readState(userDataRoot, userId).pathMountAllow[agentId];
}

/** 授予项目挂载自动审批；已有 agent 级时不会被 session 降级。 */
export function setPathMountAllow(
  userDataRoot: string,
  userId: string,
  agentId: string,
  scope: CommandAllowScope,
): UserState {
  if (!AGENT_ID.test(agentId)) throw new StateError("本机状态无效");
  const current = readState(userDataRoot, userId);
  const previous = current.pathMountAllow[agentId];
  if (previous === "agent" && scope === "session") return current;
  if (previous === scope) return current;
  return writeState(userDataRoot, userId, {
    ...current,
    pathMountAllow: { ...current.pathMountAllow, [agentId]: scope },
  });
}

/** 开始新对话时去掉 session 级挂载自动审批，保留 agent 级。 */
export function clearSessionPathMountAllow(
  userDataRoot: string,
  userId: string,
  agentId: string,
): UserState {
  const current = readState(userDataRoot, userId);
  if (current.pathMountAllow[agentId] !== "session") return current;
  const pathMountAllow = { ...current.pathMountAllow };
  delete pathMountAllow[agentId];
  return writeState(userDataRoot, userId, { ...current, pathMountAllow });
}

export function getToolAllow(
  userDataRoot: string,
  userId: string,
  agentId: string,
  toolName: string,
): CommandAllowScope | undefined {
  return readState(userDataRoot, userId).toolAllow[agentId]?.[toolName];
}

/** 授予工具授权；已有 agent 级时不会被 session 降级。 */
export function setToolAllow(
  userDataRoot: string,
  userId: string,
  agentId: string,
  toolName: string,
  scope: CommandAllowScope,
): UserState {
  if (!AGENT_ID.test(agentId)) throw new StateError("本机状态无效");
  if (!isToolName(toolName)) throw new StateError("本机状态无效");
  const current = readState(userDataRoot, userId);
  const previous = current.toolAllow[agentId]?.[toolName];
  if (previous === "agent" && scope === "session") return current;
  if (previous === scope) return current;
  const forAgent = { ...current.toolAllow[agentId], [toolName]: scope };
  return writeState(userDataRoot, userId, {
    ...current,
    toolAllow: { ...current.toolAllow, [agentId]: forAgent },
  });
}

/** 开始新对话时去掉该 Agent 下全部 session 级工具授权，保留 agent 级。 */
export function clearSessionToolAllow(
  userDataRoot: string,
  userId: string,
  agentId: string,
): UserState {
  const current = readState(userDataRoot, userId);
  const forAgent = current.toolAllow[agentId];
  if (!forAgent) return current;
  let changed = false;
  const next: Record<string, CommandAllowScope> = {};
  for (const [toolName, scope] of Object.entries(forAgent)) {
    if (scope === "session") {
      changed = true;
      continue;
    }
    next[toolName] = scope;
  }
  if (!changed) return current;
  const toolAllow = { ...current.toolAllow };
  if (Object.keys(next).length === 0) delete toolAllow[agentId];
  else toolAllow[agentId] = next;
  return writeState(userDataRoot, userId, { ...current, toolAllow });
}

/** 去掉某工具授权（任意 scope）。`prefix` 为 true 时同时清掉同前缀的细项。 */
export function clearToolAllow(
  userDataRoot: string,
  userId: string,
  agentId: string,
  toolName: string,
  options: { prefix?: boolean } = {},
): UserState {
  const current = readState(userDataRoot, userId);
  const forAgent = current.toolAllow[agentId];
  if (!forAgent) return current;
  const prefix = options.prefix ? `${toolName}__` : undefined;
  let changed = false;
  const next: Record<string, CommandAllowScope> = {};
  for (const [name, scope] of Object.entries(forAgent)) {
    if (name === toolName || (prefix && name.startsWith(prefix))) {
      changed = true;
      continue;
    }
    next[name] = scope;
  }
  if (!changed) return current;
  const toolAllow = { ...current.toolAllow };
  if (Object.keys(next).length === 0) delete toolAllow[agentId];
  else toolAllow[agentId] = next;
  return writeState(userDataRoot, userId, { ...current, toolAllow });
}

export function getDelegationAllow(
  userDataRoot: string,
  userId: string,
  agentId: string,
): CommandAllowScope | undefined {
  return readState(userDataRoot, userId).delegationAllow[agentId];
}

/**
 * 授予会诊授权；已有 agent 级时不会被 session 降级。
 * session 的 key 为 toAgentId；agent 的 key 为 fromAgentId。
 */
export function setDelegationAllow(
  userDataRoot: string,
  userId: string,
  agentId: string,
  scope: CommandAllowScope,
): UserState {
  if (!AGENT_ID.test(agentId)) throw new StateError("本机状态无效");
  const current = readState(userDataRoot, userId);
  const previous = current.delegationAllow[agentId];
  if (previous === "agent" && scope === "session") return current;
  if (previous === scope) return current;
  return writeState(userDataRoot, userId, {
    ...current,
    delegationAllow: { ...current.delegationAllow, [agentId]: scope },
  });
}

/** 私人助理新对话：去掉全部 session 级会诊授权，保留 agent 级（可调任何人）。 */
export function clearSessionDelegationAllow(userDataRoot: string, userId: string): UserState {
  const current = readState(userDataRoot, userId);
  let changed = false;
  const delegationAllow: Record<string, CommandAllowScope> = {};
  for (const [agentId, scope] of Object.entries(current.delegationAllow)) {
    if (scope === "session") {
      changed = true;
      continue;
    }
    delegationAllow[agentId] = scope;
  }
  if (!changed) return current;
  return writeState(userDataRoot, userId, { ...current, delegationAllow });
}

export function clearSessionDelegationAllowForTarget(
  userDataRoot: string,
  userId: string,
  toAgentId: string,
): UserState {
  const current = readState(userDataRoot, userId);
  if (current.delegationAllow[toAgentId] !== "session") return current;
  const delegationAllow = { ...current.delegationAllow };
  delete delegationAllow[toAgentId];
  return writeState(userDataRoot, userId, { ...current, delegationAllow });
}

/** 去掉某 key 的会诊授权（任意 scope）。 */
export function clearDelegationAllow(
  userDataRoot: string,
  userId: string,
  agentId: string,
): UserState {
  const current = readState(userDataRoot, userId);
  if (!(agentId in current.delegationAllow)) return current;
  const delegationAllow = { ...current.delegationAllow };
  delete delegationAllow[agentId];
  return writeState(userDataRoot, userId, { ...current, delegationAllow });
}

/** 清空聊天时清掉侧栏未读 / 预览 / 最近活跃，保留命令授权。 */
export function clearAgentChatUi(userDataRoot: string, userId: string, agentId: string): UserState {
  if (!AGENT_ID.test(agentId)) throw new StateError("本机状态无效");
  const current = readState(userDataRoot, userId);
  const unread = { ...current.unread };
  const previews = { ...current.previews };
  const lastActiveAt = { ...current.lastActiveAt };
  delete unread[agentId];
  delete previews[agentId];
  delete lastActiveAt[agentId];
  return writeState(userDataRoot, userId, { ...current, unread, previews, lastActiveAt });
}

export function statePath(userDataRoot: string, userId: string): string {
  return path.join(userDataRoot, "users", userId, "state.json");
}

function emptyState(): UserState {
  return {
    unread: {},
    previews: {},
    lastActiveAt: {},
    commandAllow: {},
    delegationAllow: {},
    toolAllow: {},
    pathMountAllow: {},
  };
}

function validate(value: unknown): UserState {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new StateError("本机状态无效");
  const record = value as Record<string, unknown>;
  // 缺字段按空对象兼容旧 state.json（例如只有 commandAllow、没有 previews）。
  // 旧版若带 remarks 字段则忽略（备注名已迁到 backend 招募关系）。
  const unreadRaw = record.unread ?? {};
  if (!unreadRaw || typeof unreadRaw !== "object" || Array.isArray(unreadRaw)) {
    throw new StateError("本机状态无效");
  }
  const unread: Record<string, number> = {};
  for (const [agentId, count] of Object.entries(unreadRaw as Record<string, unknown>)) {
    if (!AGENT_ID.test(agentId)) throw new StateError("本机状态无效");
    if (typeof count !== "number" || !Number.isInteger(count) || count < 0 || count > 9999) {
      throw new StateError("本机状态无效");
    }
    if (count > 0) unread[agentId] = count;
  }
  const previewsRaw = record.previews ?? {};
  if (!previewsRaw || typeof previewsRaw !== "object" || Array.isArray(previewsRaw)) {
    throw new StateError("本机状态无效");
  }
  const previews: Record<string, string> = {};
  for (const [agentId, text] of Object.entries(previewsRaw as Record<string, unknown>)) {
    if (!AGENT_ID.test(agentId)) throw new StateError("本机状态无效");
    if (typeof text !== "string") throw new StateError("本机状态无效");
    const clipped = clipPreview(text);
    if (clipped) previews[agentId] = clipped;
  }
  const lastActiveRaw = record.lastActiveAt ?? {};
  if (!lastActiveRaw || typeof lastActiveRaw !== "object" || Array.isArray(lastActiveRaw)) {
    throw new StateError("本机状态无效");
  }
  const lastActiveAt: Record<string, number> = {};
  for (const [agentId, at] of Object.entries(lastActiveRaw as Record<string, unknown>)) {
    if (!AGENT_ID.test(agentId)) throw new StateError("本机状态无效");
    if (typeof at !== "number" || !Number.isFinite(at) || !Number.isInteger(at) || at < 0) {
      throw new StateError("本机状态无效");
    }
    if (at > 0) lastActiveAt[agentId] = at;
  }
  const commandAllowRaw = record.commandAllow ?? {};
  if (!commandAllowRaw || typeof commandAllowRaw !== "object" || Array.isArray(commandAllowRaw)) {
    throw new StateError("本机状态无效");
  }
  const commandAllow: Record<string, CommandAllowScope> = {};
  for (const [agentId, scope] of Object.entries(commandAllowRaw as Record<string, unknown>)) {
    if (!AGENT_ID.test(agentId)) throw new StateError("本机状态无效");
    if (scope !== "session" && scope !== "agent") throw new StateError("本机状态无效");
    commandAllow[agentId] = scope;
  }
  const delegationAllowRaw = record.delegationAllow ?? {};
  if (
    !delegationAllowRaw ||
    typeof delegationAllowRaw !== "object" ||
    Array.isArray(delegationAllowRaw)
  ) {
    throw new StateError("本机状态无效");
  }
  const delegationAllow: Record<string, CommandAllowScope> = {};
  for (const [agentId, scope] of Object.entries(delegationAllowRaw as Record<string, unknown>)) {
    if (!AGENT_ID.test(agentId)) throw new StateError("本机状态无效");
    if (scope !== "session" && scope !== "agent") throw new StateError("本机状态无效");
    delegationAllow[agentId] = scope;
  }
  const toolAllowRaw = record.toolAllow ?? {};
  if (!toolAllowRaw || typeof toolAllowRaw !== "object" || Array.isArray(toolAllowRaw)) {
    throw new StateError("本机状态无效");
  }
  const toolAllow: Record<string, Record<string, CommandAllowScope>> = {};
  for (const [agentId, toolsRaw] of Object.entries(toolAllowRaw as Record<string, unknown>)) {
    if (!AGENT_ID.test(agentId)) throw new StateError("本机状态无效");
    if (!toolsRaw || typeof toolsRaw !== "object" || Array.isArray(toolsRaw)) {
      throw new StateError("本机状态无效");
    }
    const tools: Record<string, CommandAllowScope> = {};
    for (const [toolName, scope] of Object.entries(toolsRaw as Record<string, unknown>)) {
      if (!isToolName(toolName)) throw new StateError("本机状态无效");
      if (scope !== "session" && scope !== "agent") throw new StateError("本机状态无效");
      tools[toolName] = scope;
    }
    if (Object.keys(tools).length > 0) toolAllow[agentId] = tools;
  }
  const pathMountAllowRaw = record.pathMountAllow ?? {};
  if (
    !pathMountAllowRaw ||
    typeof pathMountAllowRaw !== "object" ||
    Array.isArray(pathMountAllowRaw)
  ) {
    throw new StateError("本机状态无效");
  }
  const pathMountAllow: Record<string, CommandAllowScope> = {};
  for (const [agentId, scope] of Object.entries(pathMountAllowRaw as Record<string, unknown>)) {
    if (!AGENT_ID.test(agentId)) throw new StateError("本机状态无效");
    if (scope !== "session" && scope !== "agent") throw new StateError("本机状态无效");
    pathMountAllow[agentId] = scope;
  }
  return { unread, previews, lastActiveAt, commandAllow, delegationAllow, toolAllow, pathMountAllow };
}

function clipPreview(text: string): string {
  const normalized = text.trim().replace(/\s+/g, " ");
  if (!normalized) return "";
  if (normalized.length <= PREVIEW_MAX) return normalized;
  return `${normalized.slice(0, PREVIEW_MAX - 1)}…`;
}

/** MCP / 内置审批工具名：非空、无路径分隔，长度有上限。 */
function isToolName(toolName: string): boolean {
  return (
    typeof toolName === "string" &&
    toolName.length > 0 &&
    toolName.length <= 200 &&
    !/[/\\\u0000]/.test(toolName)
  );
}

function validateUserId(userId: string): void {
  if (!userId || userId === "." || userId === ".." || /[/\\\u0000]/.test(userId)) {
    throw new StateError("请求无效");
  }
}
