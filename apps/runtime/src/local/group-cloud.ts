/** 群基础信息 ↔ 控制面；游客 401 时跳过，会话仍只在本机。 */

import {
  deleteCloudGroup,
  isCloudAuthSkip,
  listCloudGroups,
  setCloudGroupTitle,
  upsertCloudGroup,
} from "../control/client.js";
import type { GroupRoom } from "../session/group/types.js";
import { BackendClientError } from "../control/errors.js";

export async function pushGroupMeta(
  backendUrl: string,
  token: string,
  room: Pick<GroupRoom, "id" | "title" | "members">,
): Promise<void> {
  try {
    await upsertCloudGroup(backendUrl, token, {
      groupId: room.id,
      title: room.title,
      members: room.members.map((member) => member.agentId),
    });
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
): Promise<void> {
  try {
    await setCloudGroupTitle(backendUrl, token, room.id, room.title);
  } catch (error) {
    if (isCloudAuthSkip(error)) return;
    if (error instanceof BackendClientError && error.status === 404) {
      await pushGroupMeta(backendUrl, token, room);
      return;
    }
    throw error;
  }
}

export async function pushGroupDelete(
  backendUrl: string,
  token: string,
  groupId: string,
): Promise<void> {
  try {
    await deleteCloudGroup(backendUrl, token, groupId);
  } catch (error) {
    if (isCloudAuthSkip(error)) return;
    // 云端已无此群时仍允许删本机
    if (error instanceof BackendClientError && error.status === 404) return;
    throw error;
  }
}

/** 本机有、云端没有的群补传；失败不挡列表。 */
export async function backfillMissingGroups(
  backendUrl: string,
  token: string,
  rooms: ReadonlyArray<Pick<GroupRoom, "id" | "title" | "members">>,
): Promise<void> {
  let cloudIds: Set<string>;
  try {
    const cloud = await listCloudGroups(backendUrl, token);
    cloudIds = new Set(cloud.map((item) => item.groupId));
  } catch (error) {
    if (isCloudAuthSkip(error)) return;
    return;
  }
  for (const room of rooms) {
    if (cloudIds.has(room.id)) continue;
    try {
      await pushGroupMeta(backendUrl, token, room);
    } catch {
      // 单群补传失败不影响其余；下次列表再试
    }
  }
}
