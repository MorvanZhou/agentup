import type { RuntimeHttp } from "./http";
import {
  parseAttentionPayload,
  parseBackgroundJob,
  parseDelegationTask,
  type AttentionSnapshot,
  type BackgroundJobDto,
  type DelegationTaskDto,
} from "./chat";
import { parseGroupsPayload, type GroupRoom } from "./groups";
import { DesktopApiError } from "./error";

export type DesktopPulseSnapshot = {
  attention: AttentionSnapshot;
  runningDelegations: DelegationTaskDto[];
  unseenDelegations: DelegationTaskDto[];
  runningJobs: BackgroundJobDto[];
  unseenJobs: BackgroundJobDto[];
  groups: GroupRoom[];
};

function readTaskBucket(value: unknown, key: "running" | "unseen"): unknown[] {
  if (!value || typeof value !== "object") return [];
  const bucket = (value as Record<string, unknown>)[key];
  return Array.isArray(bucket) ? bucket : [];
}

/** 一次拉齐 attention + fleets + 本机群列表（无云 backfill）。 */
export async function desktopPulse(
  http: RuntimeHttp,
  token: string,
  userId: string,
): Promise<DesktopPulseSnapshot> {
  const payload = await http.request(
    `/desktop-pulse?user_id=${encodeURIComponent(userId)}`,
    token,
  );
  const attentionRaw = payload.attention;
  if (!attentionRaw || typeof attentionRaw !== "object" || Array.isArray(attentionRaw)) {
    throw new DesktopApiError("桌面脉冲无效");
  }
  return {
    attention: parseAttentionPayload(attentionRaw as Record<string, unknown>),
    runningDelegations: readTaskBucket(payload.delegations, "running").map(parseDelegationTask),
    unseenDelegations: readTaskBucket(payload.delegations, "unseen").map(parseDelegationTask),
    runningJobs: readTaskBucket(payload.background_jobs, "running").map(parseBackgroundJob),
    unseenJobs: readTaskBucket(payload.background_jobs, "unseen").map(parseBackgroundJob),
    groups: parseGroupsPayload(payload.groups),
  };
}
