import { BackendClientError } from "./errors.js";
import { requestJson } from "./http.js";

export type CloudGroup = {
  groupId: string;
  title: string;
  members: string[];
  createdAt: string;
  updatedAt: string;
};

/** 建群或补传基础信息。 */
export async function upsertCloudGroup(
  backendUrl: string,
  token: string,
  input: { groupId: string; title: string; members: string[] },
  fetchImpl: typeof fetch = fetch,
): Promise<CloudGroup> {
  const payload = await requestJson(
    fetchImpl,
    backendUrl,
    "POST",
    "/v1/groups",
    {
      group_id: input.groupId,
      title: input.title,
      members: input.members,
    },
    token,
  );
  return readCloudGroup(payload);
}

export async function setCloudGroupTitle(
  backendUrl: string,
  token: string,
  groupId: string,
  title: string,
  fetchImpl: typeof fetch = fetch,
): Promise<CloudGroup> {
  const payload = await requestJson(
    fetchImpl,
    backendUrl,
    "PUT",
    `/v1/groups/${encodeURIComponent(groupId)}`,
    { title },
    token,
  );
  return readCloudGroup(payload);
}

export async function listCloudGroups(
  backendUrl: string,
  token: string,
  fetchImpl: typeof fetch = fetch,
): Promise<CloudGroup[]> {
  const payload = await requestJson(fetchImpl, backendUrl, "GET", "/v1/groups", undefined, token);
  if (!Array.isArray(payload.groups)) throw new BackendClientError("群列表无效", 200);
  return payload.groups.map(readCloudGroup);
}

export async function deleteCloudGroup(
  backendUrl: string,
  token: string,
  groupId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  await requestJson(
    fetchImpl,
    backendUrl,
    "DELETE",
    `/v1/groups/${encodeURIComponent(groupId)}`,
    undefined,
    token,
  );
}

/** 游客或未登录控制面时跳过同步。 */
export function isCloudAuthSkip(error: unknown): boolean {
  return error instanceof BackendClientError && error.status === 401;
}

function readCloudGroup(value: unknown): CloudGroup {
  if (!value || typeof value !== "object") throw new BackendClientError("群记录无效", 200);
  const row = value as Record<string, unknown>;
  if (typeof row.group_id !== "string" || !row.group_id) {
    throw new BackendClientError("群记录无效", 200);
  }
  return {
    groupId: row.group_id,
    title: typeof row.title === "string" ? row.title : "",
    members: Array.isArray(row.members)
      ? row.members.filter((item): item is string => typeof item === "string")
      : [],
    createdAt: typeof row.created_at === "string" ? row.created_at : "",
    updatedAt: typeof row.updated_at === "string" ? row.updated_at : "",
  };
}
