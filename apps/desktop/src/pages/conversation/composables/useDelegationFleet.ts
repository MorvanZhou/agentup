import { computed, onScopeDispose, ref, watch, type Ref } from "vue";

import type { BackgroundJobDto, DelegationTaskDto } from "../../../shared/api/runtime/chat";

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

/**
 * 当前会话进行中的异步工作：委托 + 后台作业（轻量 Fleet）。
 * 数据来自页级 pulse running 桶；本地 note* 只做乐观补丁。
 */
export function useDelegationFleet(options: {
  agentId: Ref<string>;
  active?: Ref<boolean>;
  runningDelegations: Ref<readonly DelegationTaskDto[]>;
  runningJobs: Ref<readonly BackgroundJobDto[]>;
}) {
  /** 流事件乐观插入；pulse 对齐后清掉已出现在权威列表里的项。 */
  const optimistic = ref<AsyncFleetItem[]>([]);

  const items = computed(() => {
    const agentId = options.agentId.value;
    const active = options.active?.value ?? true;
    if (!active || !agentId) return [];

    const fromPulse: AsyncFleetItem[] = [
      ...options.runningDelegations.value
        .filter((task) => task.fromAgentId === agentId && !task.wait)
        .map(fromDelegation),
      ...options.runningJobs.value
        .filter((job) => job.agentId === agentId)
        .map(fromBackground),
    ];
    const seen = new Set(fromPulse.map((item) => `${item.kind}:${item.id}`));
    const extras = optimistic.value.filter((item) => !seen.has(`${item.kind}:${item.id}`));
    const next = [...fromPulse, ...extras];
    next.sort((a, b) => b.updatedAt - a.updatedAt);
    return next;
  });

  watch(
    () =>
      [
        options.agentId.value,
        options.runningDelegations.value.map((task) => task.id).join(","),
        options.runningJobs.value.map((job) => job.id).join(","),
      ].join("\0"),
    () => {
      const seen = new Set([
        ...options.runningDelegations.value.map((task) => `delegation:${task.id}`),
        ...options.runningJobs.value.map((job) => `background:${job.id}`),
      ]);
      // pulse 已见到的乐观项可以丢掉，避免完成后还挂着。
      optimistic.value = optimistic.value.filter((item) => !seen.has(`${item.kind}:${item.id}`));
    },
  );

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
    if (optimistic.value.some((item) => item.kind === "delegation" && item.id === data.taskId)) {
      return;
    }
    optimistic.value = [
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
      ...optimistic.value,
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
    if (optimistic.value.some((item) => item.kind === "background" && item.id === data.jobId)) {
      return;
    }
    optimistic.value = [
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
      ...optimistic.value,
    ];
  }

  function noteCancelled(id: string): void {
    optimistic.value = optimistic.value.filter((item) => item.id !== id);
  }

  function clearOptimistic(): void {
    optimistic.value = [];
  }

  watch(
    () => options.agentId.value,
    () => clearOptimistic(),
  );

  onScopeDispose(clearOptimistic);

  return {
    items,
    count: computed(() => items.value.length),
    noteStarted,
    noteBackgroundStarted,
    noteCancelled,
  };
}
