import { DesktopApiError } from "./error";
import type { RuntimeHttp } from "./http";
import { readStagedPayload, type StagedAttachment } from "./attachments";

export type GroupMember = { agentId: string; name: string };

export type GroupAssistantCustom = {
  agentUpSummary?: unknown;
  agentUpArtifacts?: unknown;
};

export type GroupDelegationActivity = "queued" | "running";
export type GroupDelegationOutcome = "completed" | "failed" | "cancelled";
export type GroupHandoff = "pending" | "consumed";

export type GroupPendingDelegation = {
  id: string;
  at: number;
  taskId: string;
  authorId: string;
  authorName: string;
  brief: string;
  activity: GroupDelegationActivity;
  handoff: GroupHandoff;
  outcome?: GroupDelegationOutcome;
  summary?: string;
};

export type GroupLine = {
  id: string;
  role: "user" | "agent" | "system" | "handback" | "tool" | "delegation";
  authorId: string;
  text: string;
  at: number;
  /** 执掌者气泡完整 parts；旧行没有。 */
  parts?: unknown[];
  assistantCustom?: GroupAssistantCustom;
  authorName?: string;
  brief?: string;
  activity?: GroupDelegationActivity;
  handoff?: GroupHandoff;
  outcome?: GroupDelegationOutcome;
  summary?: string;
  taskId?: string;
};

export type GroupQueueItem = {
  id: string;
  agentId: string;
  text: string;
  messageId: string;
};

export type GroupRoom = {
  id: string;
  title: string;
  members: GroupMember[];
  lines: GroupLine[];
  phase: "idle" | "holding" | "task";
  holderId: string | null;
  /** 尚无执掌者且未 @ 时首启此人；须为成员。 */
  defaultHolderId: string;
  holderSpeaking: boolean;
  taskIds: string[];
  pendingDelegations: GroupPendingDelegation[];
  queue: GroupQueueItem[];
  updatedAt: number;
  /** 这条记录之前还有更早的消息。 */
  linesHasMore?: boolean;
  /** 缺省当统一。单配时成员各自用一对一里选的模型。 */
  modelMode?: "unified" | "perAgent";
  /** 本群统一模型。没有时界面先显示开口者的模型，选定后才写入。 */
  model?: { templateId: string; modelId: string } | null;
  /** 市场团队一键成群来源；仅本机。 */
  sourceTeamId?: string | null;
};

export async function groupLines(
  http: RuntimeHttp,
  token: string,
  userId: string,
  groupId: string,
  options: { limit: number; before?: string },
): Promise<{ lines: GroupLine[]; hasMore: boolean }> {
  const query = [`user_id=${encodeURIComponent(userId)}`, `limit=${options.limit}`];
  if (options.before) query.push(`before=${encodeURIComponent(options.before)}`);
  const payload = await http.request(
    `/groups/${encodeURIComponent(groupId)}/lines?${query.join("&")}`,
    token,
  );
  if (!Array.isArray(payload.lines)) throw new DesktopApiError("群记录无效");
  return { lines: payload.lines.map(readLine), hasMore: payload.hasMore === true };
}

export function parseGroupsPayload(groups: unknown): GroupRoom[] {
  if (!Array.isArray(groups)) throw new DesktopApiError("群列表无效");
  return groups.map(readRoom);
}

export async function listGroups(http: RuntimeHttp, token: string, userId: string): Promise<GroupRoom[]> {
  const payload = await http.request(`/groups?user_id=${encodeURIComponent(userId)}`, token);
  return parseGroupsPayload(payload.groups);
}

export async function createGroup(
  http: RuntimeHttp,
  token: string,
  userId: string,
  title: string,
  members: GroupMember[],
  defaultHolderId?: string,
): Promise<GroupRoom> {
  const payload = await http.request("/groups", token, {
    user_id: userId,
    title,
    members,
    ...(defaultHolderId ? { defaultHolderId } : {}),
  });
  return readRoom(payload.group);
}

/** 改群名；响应里的 lines 可能为空，调用方应只取 title。 */
export async function renameGroup(
  http: RuntimeHttp,
  token: string,
  userId: string,
  groupId: string,
  title: string,
): Promise<GroupRoom> {
  const payload = await http.request(
    `/groups/${encodeURIComponent(groupId)}`,
    token,
    { user_id: userId, title },
    "PUT",
  );
  return readRoom(payload.group);
}

/** 改成员（可顺带改默认执掌者）；响应可能不带会话行，合并 members / holderId / defaultHolderId / queue。 */
export async function setGroupMembers(
  http: RuntimeHttp,
  token: string,
  userId: string,
  groupId: string,
  members: GroupMember[],
  defaultHolderId?: string,
): Promise<GroupRoom> {
  const payload = await http.request(
    `/groups/${encodeURIComponent(groupId)}/members`,
    token,
    {
      user_id: userId,
      members,
      ...(defaultHolderId ? { defaultHolderId } : {}),
    },
    "PUT",
  );
  return readRoom(payload.group);
}

/** 改这间群的统一 / 单配。响应可能不带会话行，调用方只取 modelMode。 */
export async function setGroupModelMode(
  http: RuntimeHttp,
  token: string,
  userId: string,
  groupId: string,
  mode: "unified" | "perAgent",
): Promise<GroupRoom> {
  const payload = await http.request(
    `/groups/${encodeURIComponent(groupId)}/model-mode`,
    token,
    { user_id: userId, mode: mode === "perAgent" ? "per_agent" : "unified" },
    "PUT",
  );
  return readRoom(payload.group);
}

/** 只改这间群的统一模型，不改成员私聊。 */
export async function setGroupModel(
  http: RuntimeHttp,
  token: string,
  userId: string,
  groupId: string,
  ref: { templateId: string; modelId: string },
): Promise<GroupRoom> {
  const payload = await http.request(
    `/groups/${encodeURIComponent(groupId)}/model`,
    token,
    { user_id: userId, template_id: ref.templateId, model_id: ref.modelId },
    "PUT",
  );
  return readRoom(payload.group);
}

export type GroupLive = { room: GroupRoom; liveTurnId: string | null };

export async function getGroup(
  http: RuntimeHttp,
  token: string,
  userId: string,
  groupId: string,
): Promise<GroupLive> {
  const payload = await http.request(
    `/groups/${encodeURIComponent(groupId)}?user_id=${encodeURIComponent(userId)}`,
    token,
  );
  return { room: readRoom(payload.group), liveTurnId: readLiveTurnId(payload.liveTurnId) };
}

export async function postGroupMessage(
  http: RuntimeHttp,
  token: string,
  userId: string,
  groupId: string,
  text: string,
): Promise<GroupLive> {
  const payload = await http.request(`/groups/${encodeURIComponent(groupId)}/messages`, token, {
    user_id: userId,
    text,
  });
  return { room: readRoom(payload.room), liveTurnId: readLiveTurnId(payload.liveTurnId) };
}

export async function editGroupMessage(
  http: RuntimeHttp,
  token: string,
  userId: string,
  groupId: string,
  messageId: string,
  text: string,
): Promise<GroupLive> {
  const payload = await http.request(
    `/groups/${encodeURIComponent(groupId)}/messages/${encodeURIComponent(messageId)}`,
    token,
    { user_id: userId, text },
  );
  return { room: readRoom(payload.room), liveTurnId: readLiveTurnId(payload.liveTurnId) };
}

export async function cancelGroupQueue(
  http: RuntimeHttp,
  token: string,
  userId: string,
  groupId: string,
  queueId: string,
): Promise<GroupRoom> {
  const payload = await http.request(
    `/groups/${encodeURIComponent(groupId)}/queue/${encodeURIComponent(queueId)}/cancel`,
    token,
    { user_id: userId },
  );
  return readRoom(payload.group);
}

export async function stopGroup(
  http: RuntimeHttp,
  token: string,
  userId: string,
  groupId: string,
): Promise<GroupLive> {
  const payload = await http.request(`/groups/${encodeURIComponent(groupId)}/stop`, token, {
    user_id: userId,
  });
  return { room: readRoom(payload.group), liveTurnId: readLiveTurnId(payload.liveTurnId) };
}

export async function clearGroupWorkspace(
  http: RuntimeHttp,
  token: string,
  userId: string,
  groupId: string,
  includeWork: boolean,
): Promise<void> {
  await http.request(`/groups/${encodeURIComponent(groupId)}/workspace/clear`, token, {
    user_id: userId,
    include_work: includeWork,
  });
}

export async function deleteGroup(
  http: RuntimeHttp,
  token: string,
  userId: string,
  groupId: string,
): Promise<void> {
  await http.request(
    `/groups/${encodeURIComponent(groupId)}?user_id=${encodeURIComponent(userId)}`,
    token,
    undefined,
    "DELETE",
  );
}

export async function clearGroupContext(
  http: RuntimeHttp,
  token: string,
  userId: string,
  groupId: string,
): Promise<GroupLive> {
  const payload = await http.request(`/groups/${encodeURIComponent(groupId)}/context`, token, {
    user_id: userId,
  });
  return { room: readRoom(payload.room), liveTurnId: readLiveTurnId(payload.liveTurnId) };
}

export async function stageGroupAttachment(
  http: RuntimeHttp,
  token: string,
  userId: string,
  groupId: string,
  file: { name: string; mediaType: string; dataBase64: string },
): Promise<StagedAttachment> {
  const payload = await http.request(`/groups/${encodeURIComponent(groupId)}/attachments`, token, {
    user_id: userId,
    name: file.name,
    media_type: file.mediaType,
    data_base64: file.dataBase64,
  });
  return readStagedPayload(payload, file);
}

/** 群聊大文件直连：按本机路径让 runtime 复制，免 base64 转码。 */
export async function stageGroupAttachmentFromPath(
  http: RuntimeHttp,
  token: string,
  userId: string,
  groupId: string,
  file: { name: string; mediaType: string; path: string },
): Promise<StagedAttachment> {
  const payload = await http.request(
    `/groups/${encodeURIComponent(groupId)}/attachments/from-path`,
    token,
    {
      user_id: userId,
      name: file.name,
      media_type: file.mediaType,
      path: file.path,
    },
  );
  return readStagedPayload(payload, file);
}

export async function deleteGroupAttachment(
  http: RuntimeHttp,
  token: string,
  userId: string,
  groupId: string,
  relativePath: string,
): Promise<void> {
  const params = new URLSearchParams({ user_id: userId, path: relativePath });
  await http.request(
    `/groups/${encodeURIComponent(groupId)}/attachments?${params}`,
    token,
    undefined,
    "DELETE",
  );
}

/** 执掌者这一轮的 UIMessage SSE（与一对一 /turn-stream 同形）。 */
export function groupTurnStreamUrl(baseUrl: string, userId: string, groupId: string): string {
  const params = new URLSearchParams({ user_id: userId });
  return `${baseUrl.replace(/\/$/, "")}/groups/${encodeURIComponent(groupId)}/turn-stream?${params}`;
}

function readLiveTurnId(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function readRoom(value: unknown): GroupRoom {
  if (!value || typeof value !== "object") throw new DesktopApiError("群记录无效");
  const room = value as Partial<GroupRoom>;
  if (typeof room.id !== "string") throw new DesktopApiError("群记录无效");
  const members = Array.isArray(room.members) ? room.members : [];
  const fallbackDefault =
    typeof room.defaultHolderId === "string" && room.defaultHolderId
      ? room.defaultHolderId
      : typeof members[0]?.agentId === "string"
        ? members[0].agentId
        : "";
  return {
    id: room.id,
    title: typeof room.title === "string" ? room.title : "",
    members,
    lines: Array.isArray(room.lines) ? room.lines.map(readLine) : [],
    phase: room.phase === "holding" || room.phase === "task" ? room.phase : "idle",
    holderId: typeof room.holderId === "string" ? room.holderId : null,
    defaultHolderId: fallbackDefault,
    holderSpeaking: room.holderSpeaking === true,
    taskIds: Array.isArray(room.taskIds) ? room.taskIds.filter((id) => typeof id === "string") : [],
    pendingDelegations: Array.isArray(room.pendingDelegations)
      ? room.pendingDelegations.map(readPending)
      : [],
    queue: Array.isArray(room.queue) ? room.queue : [],
    updatedAt: typeof room.updatedAt === "number" ? room.updatedAt : 0,
    linesHasMore: room.linesHasMore === true,
    modelMode: room.modelMode === "perAgent" ? "perAgent" : "unified",
    model: readRoomModel(room.model),
    ...(typeof room.sourceTeamId === "string" && room.sourceTeamId
      ? { sourceTeamId: room.sourceTeamId }
      : {}),
  };
}

function readRoomModel(value: unknown): { templateId: string; modelId: string } | null {
  if (!value || typeof value !== "object") return null;
  const ref = value as { templateId?: unknown; modelId?: unknown };
  if (typeof ref.templateId !== "string" || typeof ref.modelId !== "string") return null;
  if (!ref.templateId.trim() || !ref.modelId.trim()) return null;
  return { templateId: ref.templateId, modelId: ref.modelId };
}

function readLine(value: unknown): GroupLine {
  if (!value || typeof value !== "object") {
    return { id: "", role: "system", authorId: "", text: "", at: 0 };
  }
  const line = value as Partial<GroupLine>;
  const role =
    line.role === "user" ||
    line.role === "agent" ||
    line.role === "system" ||
    line.role === "handback" ||
    line.role === "tool" ||
    line.role === "delegation"
      ? line.role
      : "system";
  const base: GroupLine = {
    id: typeof line.id === "string" ? line.id : "",
    role,
    authorId: typeof line.authorId === "string" ? line.authorId : "",
    text: typeof line.text === "string" ? line.text : "",
    at: typeof line.at === "number" ? line.at : 0,
    ...readDelegationFields(line),
  };
  if (Array.isArray(line.parts) && line.parts.length > 0) base.parts = line.parts;
  const custom = readAssistantCustom(line.assistantCustom);
  if (custom) base.assistantCustom = custom;
  return base;
}

function readPending(value: unknown): GroupPendingDelegation {
  const line = value && typeof value === "object" ? (value as Partial<GroupPendingDelegation>) : {};
  const fields = readDelegationFields(line);
  return {
    id: typeof line.id === "string" ? line.id : "",
    at: typeof line.at === "number" ? line.at : 0,
    taskId: fields.taskId ?? "",
    authorId: typeof line.authorId === "string" ? line.authorId : "",
    authorName: fields.authorName ?? "",
    brief: fields.brief ?? "",
    activity: fields.activity ?? "running",
    handoff: fields.handoff ?? "pending",
    ...(fields.outcome ? { outcome: fields.outcome } : {}),
    ...(fields.summary ? { summary: fields.summary } : {}),
  };
}

function readDelegationFields(line: {
  authorName?: unknown;
  brief?: unknown;
  activity?: unknown;
  handoff?: unknown;
  outcome?: unknown;
  summary?: unknown;
  taskId?: unknown;
}): Pick<GroupLine, "authorName" | "brief" | "activity" | "handoff" | "outcome" | "summary" | "taskId"> {
  const fields: Pick<GroupLine, "authorName" | "brief" | "activity" | "handoff" | "outcome" | "summary" | "taskId"> =
    {};
  if (typeof line.authorName === "string" && line.authorName) fields.authorName = line.authorName;
  if (typeof line.brief === "string") fields.brief = line.brief;
  if (line.activity === "queued" || line.activity === "running") fields.activity = line.activity;
  if (line.handoff === "pending" || line.handoff === "consumed") fields.handoff = line.handoff;
  if (line.outcome === "completed" || line.outcome === "failed" || line.outcome === "cancelled") {
    fields.outcome = line.outcome;
  }
  if (typeof line.summary === "string" && line.summary) fields.summary = line.summary;
  if (typeof line.taskId === "string" && line.taskId) fields.taskId = line.taskId;
  return fields;
}

function readAssistantCustom(value: unknown): GroupAssistantCustom | undefined {
  if (!value || typeof value !== "object") return undefined;
  const raw = value as Record<string, unknown>;
  const custom: GroupAssistantCustom = {};
  if ("agentUpSummary" in raw) custom.agentUpSummary = raw.agentUpSummary;
  if ("agentUpArtifacts" in raw) custom.agentUpArtifacts = raw.agentUpArtifacts;
  return Object.keys(custom).length > 0 ? custom : undefined;
}
