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
 */
export function useDelegationProcess() {
  const loading = ref(false);
  const streaming = ref(false);
  const error = ref("");
  const messages = shallowRef<UIMessage[]>([]);
  const task = shallowRef<DelegationHistoryDto["task"] | null>(null);
  let abort: AbortController | undefined;

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
    messages.value = [];
    task.value = null;
    abort = new AbortController();
    const signal = abort.signal;
    const base = options.baseUrl ?? runtimeBaseUrl();
    const http = new RuntimeHttp(base);

    try {
      // 先拉一次 history（可能已有部分会话文件；完成后也能立刻展示）
      try {
        const snap = await delegationHistory(http, options.token, options.userId, options.taskId);
        if (signal.aborted) return;
        task.value = snap.task;
        if (snap.messages.length > 0) messages.value = snap.messages;
      } catch {
        // history 暂不可用时继续尝试 stream
      }

      const done =
        task.value?.status === "completed" ||
        task.value?.status === "failed" ||
        task.value?.status === "cancelled";

      if (done && messages.value.length > 0) {
        loading.value = false;
        return;
      }

      streaming.value = true;
      loading.value = false;
      await consumeStream({
        baseUrl: base,
        token: options.token,
        userId: options.userId,
        taskId: options.taskId,
        signal,
      });

      // 流结束后再拉一次 history 对齐终态
      if (!signal.aborted) {
        try {
          const snap = await delegationHistory(http, options.token, options.userId, options.taskId);
          task.value = snap.task;
          if (snap.messages.length > 0) messages.value = snap.messages;
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
          task.value = snap.task;
          messages.value = snap.messages;
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
  }): Promise<void> {
    const url = delegationStreamUrl(options.baseUrl, options.userId, options.taskId);
    let response: Response;
    try {
      response = await fetch(url, {
        method: "GET",
        headers: { authorization: `Bearer ${options.token}` },
        signal: options.signal,
      });
    } catch (err) {
      if (options.signal.aborted) return;
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
    if (!response.body) return;

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

    let sawChunk = false;
    for await (const message of readUIMessageStream({ stream: chunkStream })) {
      if (options.signal.aborted) return;
      sawChunk = true;
      // 流式累积为单条 assistant；与 history 的 user+assistant 不同，弹窗只关心过程 parts
      messages.value = [message];
    }
    if (!sawChunk && messages.value.length === 0) {
      // 空流：调用方会再拉 history
    }
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
