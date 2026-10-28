import type { Hono } from "hono";

import type { BackgroundJob } from "../../session/background/index.js";
import type { DelegationTask } from "../../session/delegation/index.js";
import { TRANSCRIPT_PAGE_SIZE } from "../../session/transcript-page.js";
import {
  bearer,
  json,
  requireUserId,
  type LocalAppDeps,
  type LocalAppEnv,
} from "../http.js";
import { buildAttentionPayload } from "./attention-payload.js";

function serializeDelegation(task: DelegationTask): Record<string, unknown> {
  return {
    id: task.id,
    from_agent_id: task.fromAgentId,
    to_agent_id: task.toAgentId,
    to_agent_name: task.toAgentName,
    brief: task.brief,
    status: task.status,
    wait: task.wait,
    result_summary: task.resultSummary ?? null,
    error: task.error ?? null,
    seen: task.seen,
    notified: task.notified,
    created_at: task.createdAt,
    updated_at: task.updatedAt,
    ...(task.groupId ? { group_id: task.groupId } : {}),
  };
}

function serializeBackgroundJob(job: BackgroundJob): Record<string, unknown> {
  return {
    id: job.id,
    agent_id: job.agentId,
    name: job.name,
    command: job.command,
    status: job.status,
    exit_code: job.exitCode ?? null,
    output_tail: job.outputTail ?? null,
    error: job.error ?? null,
    seen: job.seen,
    notified: job.notified,
    created_at: job.createdAt,
    updated_at: job.updatedAt,
  };
}

/**
 * 桌面会话页脉冲：一次拿齐 attention + running/unseen fleets + 本机群列表。
 * 群列表不做控制面 backfill（仍走显式 GET /groups），避免轮询打云。
 */
export function registerDesktopPulseRoutes(app: Hono<LocalAppEnv>, deps: LocalAppDeps): void {
  const { delegation, backgroundJobs, groupTurns } = deps;

  app.get("/desktop-pulse", (c) => {
    bearer(c);
    const userId = requireUserId(c.req.query("user_id") ?? "");

    const runningDelegations = delegation.listTasks(userId, { status: "running" });
    const unseenDelegations = delegation.listTasks(userId, { unseenOnly: true });
    for (const task of unseenDelegations) {
      if (
        !task.wait &&
        !task.notified &&
        (task.status === "completed" || task.status === "failed" || task.status === "cancelled")
      ) {
        delegation.notifyParent(task);
      }
    }

    const runningJobs = backgroundJobs.list(userId, { status: "running" });
    const unseenJobs = backgroundJobs.list(userId, { unseenOnly: true });
    for (const job of unseenJobs) {
      if (
        !job.notified &&
        (job.status === "completed" || job.status === "failed" || job.status === "cancelled")
      ) {
        backgroundJobs.notifyOwner(job);
      }
    }

    const rooms = groupTurns.list(userId);
    const groups = rooms.map((room) => {
      const page = groupTurns.linePage(userId, room.id, { limit: TRANSCRIPT_PAGE_SIZE });
      return { ...room, lines: page.lines, linesHasMore: page.hasMore };
    });

    return json(c, 200, {
      attention: buildAttentionPayload(deps, userId),
      delegations: {
        running: runningDelegations.map(serializeDelegation),
        unseen: unseenDelegations.map(serializeDelegation),
      },
      background_jobs: {
        running: runningJobs.map(serializeBackgroundJob),
        unseen: unseenJobs.map(serializeBackgroundJob),
      },
      groups,
    });
  });
}
