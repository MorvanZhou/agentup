import { computed, onScopeDispose, ref, watch, type Ref } from "vue";

import type { DesktopApi } from "../../../shared/api/runtime/client";
import type { BackgroundJobDto, DelegationTaskDto } from "../../../shared/api/runtime/chat";

const FLEET_POLL_MS = 2500;

export type AsyncFleetKind = "delegation" | "background";

export type AsyncFleetItem = {
  kind: AsyncFleetKind;
  id: string;
  /** 展示名：专家名或作业名 */
  title: string;
  subtitle: string;
  status: string;
  createdAt: number;
  updatedAt: number;
  /** 委托专用 */
  toAgentId?: string;
  toAgentName?: string;
  brief?: string;
  /** 后台作业专用 */
  command?: string;
};

/** @deprecated 用 AsyncFleetItem */
export type DelegationFleetItem = AsyncFleetItem;

/**
 * 当前会话进行中的异步工作：委托 + 后台作业（轻量 Fleet）。
 */
export function useDelegationFleet(options: {
  api: DesktopApi;
  agentId: Ref<string>;
  token: Ref<string>;
  userId: Ref<string>;
  active?: Ref<boolean>;
}) {
  const items = ref<AsyncFleetItem[]>([]);
  let timer: ReturnType<typeof setInterval> | undefined;
  let pollKey = "";

  function stop(): void {
    if (timer) clearInterval(timer);
    timer = undefined;
    pollKey = "";
  }

  function fromDelegation(task: DelegationTaskDto): AsyncFleetItem {
    return {
      kind: "delegation",
      id: task.id,
      title: task.toAgentName || task.toAgentId,
      subtitle: task.brief,
      status: task.status,
      createdAt: task.createdAt,
      updatedAt: task.updatedAt,
      toAgentId: task.toAgentId,
      toAgentName: task.toAgentName,
      brief: task.brief,
    };
  }

  function fromBackground(job: BackgroundJobDto): AsyncFleetItem {
    return {
      kind: "background",
      id: job.id,
      title: job.name || job.id.slice(0, 8),
      subtitle: job.command,
      status: job.status,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
      command: job.command,
    };
  }

  async function tick(): Promise<void> {
    const agentId = options.agentId.value;
    const token = options.token.value;
    const userId = options.userId.value;
    if (!agentId || !token || !userId) {
      items.value = [];
      return;
    }
    try {
      const [delegations, jobs] = await Promise.all([
        options.api.listDelegations(token, userId, {
          status: "running",
          fromAgentId: agentId,
        }),
        options.api.listBackgroundJobs(token, userId, {
          status: "running",
          agentId,
        }),
      ]);
      const next: AsyncFleetItem[] = [
        ...delegations.filter((task) => !task.wait).map(fromDelegation),
        ...jobs.map(fromBackground),
      ];
      next.sort((a, b) => b.updatedAt - a.updatedAt);
      items.value = next;
    } catch {
      // 轮询失败静默
    }
  }

  function start(): void {
    const agentId = options.agentId.value;
    const token = options.token.value;
    const userId = options.userId.value;
    const active = options.active?.value ?? true;
    const key = `${userId}/${agentId}`;
    if (!active || !agentId || !token || !userId) {
      stop();
      items.value = [];
      return;
    }
    if (timer && pollKey === key) return;
    stop();
    pollKey = key;
    void tick();
    timer = setInterval(() => {
      void tick();
    }, FLEET_POLL_MS);
  }

  function noteStarted(data: {
    taskId: string;
    toAgentId: string;
    toAgentName: string;
    brief: string;
    wait: boolean;
  }): void {
    if (data.wait) return;
    if (items.value.some((item) => item.kind === "delegation" && item.id === data.taskId)) {
      return;
    }
    items.value = [
      {
        kind: "delegation",
        id: data.taskId,
        title: data.toAgentName,
        subtitle: data.brief,
        status: "running",
        createdAt: Date.now(),
        updatedAt: Date.now(),
        toAgentId: data.toAgentId,
        toAgentName: data.toAgentName,
        brief: data.brief,
      },
      ...items.value,
    ];
  }

  function noteBackgroundStarted(data: {
    jobId: string;
    name: string;
    command: string;
  }): void {
    if (items.value.some((item) => item.kind === "background" && item.id === data.jobId)) {
      return;
    }
    items.value = [
      {
        kind: "background",
        id: data.jobId,
        title: data.name,
        subtitle: data.command,
        status: "running",
        createdAt: Date.now(),
        updatedAt: Date.now(),
        command: data.command,
      },
      ...items.value,
    ];
  }

  function noteCancelled(id: string): void {
    items.value = items.value.filter((item) => item.id !== id);
  }

  watch(
    () =>
      [
        options.agentId.value,
        options.token.value,
        options.userId.value,
        options.active?.value ?? true,
      ].join("\0"),
    () => start(),
    { immediate: true },
  );

  onScopeDispose(stop);

  return {
    items: computed(() => items.value),
    count: computed(() => items.value.length),
    noteStarted,
    noteBackgroundStarted,
    noteCancelled,
    refresh: tick,
    stop,
  };
}
