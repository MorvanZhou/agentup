import {
  parseJsonEventStream,
  readUIMessageStream,
  uiMessageChunkSchema,
  type UIMessage,
} from "ai";
import { onBeforeUnmount, ref, shallowRef } from "vue";

import { DesktopApiError } from "../../../shared/api/runtime/error";
import { runtimeBaseUrl } from "../../../shared/api/runtime/base-url";
import {
  delegationHistory,
  delegationStreamUrl,
  type DelegationHistoryDto,
} from "../../../shared/api/runtime/chat";
import { RuntimeHttp } from "../../../shared/api/runtime/http";
import { attachConfirmedArtifactsToMessages } from "../model/message/message-artifacts";
import {
  assistantPartCount,
  shouldApplyStreamMessage,
} from "../model/thread/delegation-process-stream";

export type DelegationProcessState = {
  loading: boolean;
  streaming: boolean;
  error: string;
  messages: UIMessage[];
  task: DelegationHistoryDto["task"] | null;
};

/**
 * 旁路消费委托过程：优先 SSE 流式；流空/已结束则拉 history。
 * 不写入父线程 messages。
 * 任务确认清单统一投影成 agentUpArtifacts，群/单聊产物 tab 共用。
 */
export function useDelegationProcess() {
  const loading = ref(false);
  const streaming = ref(false);
  const error = ref("");
  const messages = shallowRef<UIMessage[]>([]);
  const task = shallowRef<DelegationHistoryDto["task"] | null>(null);
  let abort: AbortController | undefined;

  /** 清空视图；单独函数避免 TS 把同作用域的 `task.value = null` 窄化成 never。 */
  function resetView(): void {
    messages.value = [];
    task.value = null;
  }

  /** history / 流收口：task 与 messages 对齐后再挂确认产物。 */
  function applySnapshot(snap: DelegationHistoryDto, preferHistoryMessages: boolean): void {
    task.value = snap.task;
    if (preferHistoryMessages && snap.messages.length > 0) {
      messages.value = attachConfirmedArtifactsToMessages(snap.messages, snap.task.artifacts);
      return;
    }
    if (messages.value.length > 0) {
      messages.value = attachConfirmedArtifactsToMessages(messages.value, snap.task.artifacts);
    } else if (snap.messages.length > 0) {
      messages.value = attachConfirmedArtifactsToMessages(snap.messages, snap.task.artifacts);
    }
  }

  async function open(options: {
    token: string;
    userId: string;
    taskId: string;
    baseUrl?: string;
  }): Promise<void> {
    stop();
    loading.value = true;
    streaming.value = false;
    error.value = "";
    resetView();
    abort = new AbortController();
    const signal = abort.signal;
    const base = options.baseUrl ?? runtimeBaseUrl();
    const http = new RuntimeHttp(base);

    try {
      // 先拉一次 history（可能已有部分会话文件；完成后也能立刻展示）
      try {
        const snap = await delegationHistory(http, options.token, options.userId, options.taskId);
        if (signal.aborted) return;
        applySnapshot(snap, true);
      } catch {
        // history 暂不可用时继续尝试 stream
      }

      const status = task.value?.status;
      const done = status === "completed" || status === "failed" || status === "cancelled";

      if (done && messages.value.length > 0) {
        loading.value = false;
        return;
      }

      streaming.value = true;
      loading.value = false;
      // history 已展示时，SSE 回放未追上前不覆盖，避免时间线闪缩
      const historyFloor = assistantPartCount(messages.value);
      const appliedStream = await consumeStream({
        baseUrl: base,
        token: options.token,
        userId: options.userId,
        taskId: options.taskId,
        signal,
        historyFloor,
      });

      // 流结束后对齐 task 终态；已接上流则保留流式 messages，再挂确认产物
      if (!signal.aborted) {
        try {
          const snap = await delegationHistory(http, options.token, options.userId, options.taskId);
          applySnapshot(snap, !appliedStream);
        } catch {
          // 保留流式结果
        }
      }
    } catch (err) {
      if (signal.aborted) return;
      error.value =
        err instanceof DesktopApiError
          ? err.message
          : err instanceof Error && err.message
            ? err.message
            : "无法加载委托过程";
      // 流失败时尽量展示 history
      if (messages.value.length === 0) {
        try {
          const snap = await delegationHistory(http, options.token, options.userId, options.taskId);
          applySnapshot(snap, true);
          error.value = "";
        } catch {
          // keep error
        }
      }
    } finally {
      if (!signal.aborted) {
        loading.value = false;
        streaming.value = false;
      }
    }
  }

  async function consumeStream(options: {
    baseUrl: string;
    token: string;
    userId: string;
    taskId: string;
    signal: AbortSignal;
    historyFloor: number;
  }): Promise<boolean> {
    const url = delegationStreamUrl(options.baseUrl, options.userId, options.taskId);
    let response: Response;
    try {
      response = await fetch(url, {
        method: "GET",
        headers: { authorization: `Bearer ${options.token}` },
        signal: options.signal,
      });
    } catch (err) {
      if (options.signal.aborted) return false;
      throw err instanceof Error ? err : new Error("本机 runtime 没有启动");
    }
    if (!response.ok) {
      let message = "委托流失败";
      try {
        const payload = (await response.json()) as { error?: string };
        if (typeof payload.error === "string") message = payload.error;
      } catch {
        // ignore
      }
      throw new DesktopApiError(message, response.status);
    }
    if (!response.body) return false;

    const chunkStream = parseJsonEventStream({
      stream: response.body,
      schema: uiMessageChunkSchema,
    }).pipeThrough(
      new TransformStream({
        transform(part, controller) {
          if (!part.success) throw part.error;
          controller.enqueue(part.value);
        },
      }),
    );

    let applied = false;
    for await (const message of readUIMessageStream({ stream: chunkStream })) {
      if (options.signal.aborted) return applied;
      // 流式累积为单条 assistant；与 history 的 user+assistant 不同，弹窗只关心过程 parts
      if (!shouldApplyStreamMessage(message, options.historyFloor)) continue;
      messages.value = [message];
      applied = true;
    }
    return applied;
  }

  function stop(): void {
    abort?.abort();
    abort = undefined;
    streaming.value = false;
    loading.value = false;
  }

  onBeforeUnmount(stop);

  return {
    loading,
    streaming,
    error,
    messages,
    task,
    open,
    stop,
  };
}
