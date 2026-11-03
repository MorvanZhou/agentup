/** 群基础信息 ↔ 控制面；游客 401 时跳过，会话仍只在本机。 */

import {
  deleteCloudGroup,
  isCloudAuthSkip,
  listCloudGroups,
  setCloudGroupTitle,
  upsertCloudGroup,
  type CloudGroup,
} from "../control/client.js";
import { BackendClientError } from "../control/errors.js";
import type { GroupRoom } from "../session/group/types.js";

export async function pushGroupMeta(
  backendUrl: string,
  token: string,
  room: Pick<GroupRoom, "id" | "title" | "members">,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  try {
    await upsertCloudGroup(
      backendUrl,
      token,
      {
        groupId: room.id,
        title: room.title,
        members: room.members.map((member) => member.agentId),
      },
      fetchImpl,
    );
  } catch (error) {
    if (isCloudAuthSkip(error)) return;
    throw error;
  }
}

/** 改群名；云端尚无该群时改走补传（带成员）。 */
export async function pushGroupTitle(
  backendUrl: string,
  token: string,
  room: Pick<GroupRoom, "id" | "title" | "members">,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  try {
    await setCloudGroupTitle(backendUrl, token, room.id, room.title, fetchImpl);
  } catch (error) {
    if (isCloudAuthSkip(error)) return;
    if (error instanceof BackendClientError && error.status === 404) {
      await pushGroupMeta(backendUrl, token, room, fetchImpl);
      return;
    }
    throw error;
  }
}

export async function pushGroupDelete(
  backendUrl: string,
  token: string,
  groupId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  try {
    await deleteCloudGroup(backendUrl, token, groupId, fetchImpl);
  } catch (error) {
    if (isCloudAuthSkip(error)) return;
    // 云端已无此群时仍允许删本机
    if (error instanceof BackendClientError && error.status === 404) return;
    throw error;
  }
}

/**
 * 双向 reconcile（会话不上云）：
 * - 云端有、本机无 → pull 建空群壳
 * - 本机有、云端无 → 补传元数据
 * - 同 id 本机已有 → 不覆盖（本机优先）
 * 游客 401 / 列云失败不挡列表。
 */
export async function reconcileGroups(
  backendUrl: string,
  token: string,
  rooms: ReadonlyArray<Pick<GroupRoom, "id" | "title" | "members">>,
  pull: (cloud: CloudGroup) => void | Promise<void>,
  fetchImpl: typeof fetch = fetch,
): Promise<{ pulled: number }> {
  let cloud: CloudGroup[];
  try {
    cloud = await listCloudGroups(backendUrl, token, fetchImpl);
  } catch (error) {
    if (isCloudAuthSkip(error)) return { pulled: 0 };
    return { pulled: 0 };
  }

  const localIds = new Set(rooms.map((room) => room.id));
  let pulled = 0;
  for (const item of cloud) {
    if (localIds.has(item.groupId)) continue;
    try {
      await pull(item);
      pulled += 1;
    } catch {
      // 单群恢复失败不影响其余；下次列表再试
    }
  }

  const cloudIds = new Set(cloud.map((item) => item.groupId));
  for (const room of rooms) {
    if (cloudIds.has(room.id)) continue;
    try {
      await pushGroupMeta(backendUrl, token, room, fetchImpl);
    } catch {
      // 单群补传失败不影响其余；下次列表再试
    }
  }
  return { pulled };
}
