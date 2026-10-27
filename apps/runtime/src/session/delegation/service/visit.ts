import fs from "node:fs";
import path from "node:path";

import { HttpPackageSource } from "../../../control/client.js";
import {
  isLocalAgentId,
  localAgentVisit,
} from "../../../local/agents/local-agent.js";
import {
  PERSONAL_ASSISTANT_ID,
  personalAssistantRoot,
} from "../../../local/assistant/personal-assistant.js";
import { Runtime, type Visit } from "../../../package/sync.js";
import { DelegationError } from "./errors.js";

/** 为本机 / 已投影 / 可 sync 的专家装好 Visit。 */
export async function syncDelegationVisit(input: {
  userDataRoot: string;
  backendUrl: string;
  tokens: Map<string, string>;
  userId: string;
  agentId: string;
}): Promise<Visit> {
  const { userDataRoot, backendUrl, tokens, userId, agentId } = input;
  if (isLocalAgentId(agentId)) {
    try {
      return localAgentVisit(userDataRoot, userId, agentId);
    } catch {
      throw new DelegationError("找不到本机 Agent");
    }
  }
  const token = tokens.get(userId);
  if (token) {
    try {
      return await new Runtime(
        new HttpPackageSource(backendUrl, token),
        userDataRoot,
      ).sync(userId, agentId);
    } catch {
      const disk = Runtime.openDiskVisit(userDataRoot, userId, agentId);
      if (disk) return disk;
      throw new DelegationError("同步 Agent 失败，且本机无可用投影");
    }
  }
  // 无令牌时仅使用本机已投影的 visit（异步后台可能已解绑 token）。
  const disk = Runtime.openDiskVisit(userDataRoot, userId, agentId);
  if (!disk) {
    throw new DelegationError("尚未同步该 Agent，请先打开或同步后再委托");
  }
  return disk;
}

/** 解析 visit cwd：私人助理 / 本机 / 市场专家。 */
export function resolveAgentCwd(
  userDataRoot: string,
  userId: string,
  agentId: string,
): string | undefined {
  try {
    if (agentId === PERSONAL_ASSISTANT_ID) {
      const root = personalAssistantRoot(userDataRoot, userId);
      return path.join(root, "cwd");
    }
    if (isLocalAgentId(agentId)) {
      return path.join(localAgentVisit(userDataRoot, userId, agentId).root, "cwd");
    }
    const disk = Runtime.openDiskVisit(userDataRoot, userId, agentId);
    if (disk) return path.join(disk.root, "cwd");
    const fallback = path.join(userDataRoot, "users", userId, "agents", agentId, "cwd");
    return fs.existsSync(fallback) ? fallback : undefined;
  } catch {
    return undefined;
  }
}
