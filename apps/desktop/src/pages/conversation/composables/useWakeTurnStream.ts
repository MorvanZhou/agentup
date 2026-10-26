import {
  parseJsonEventStream,
  readUIMessageStream,
  uiMessageChunkSchema,
  type UIMessage,
  type UIMessageChunk,
} from "ai";
import { getCurrentScope, onScopeDispose, ref, shallowRef, watch, type Ref } from "vue";

import { turnStreamUrl } from "../../../shared/api/runtime/chat";
import {
  isAgentUpApproval,
  isAgentUpAskUser,
  isAgentUpDelegationStarted,
  isAgentUpModelUnavailable,
  isAgentUpShellHang,
  type AgentUpApprovalData,
  type AgentUpAskUserData,
  type AgentUpDelegationStartedData,
  type AgentUpShellHangData,
} from "../../../shared/model/chat/chat";
import { showToast } from "../../../shared/model/ui/toast";
import { readUiLocale, t } from "../../../shared/model/ui/ui-locale";

export type WakeTurnStreamHandlers = {
  onApproval?: (data: AgentUpApprovalData) => void;
  onAskUser?: (data: AgentUpAskUserData) => void;
  onShellHang?: (data: AgentUpShellHangData) => void;
  onDelegationStarted?: (data: AgentUpDelegationStartedData) => void;
  /** 流结束：调用方拉一次权威历史，并入 AISDKChat。 */
  onDone?: () => void;
};

/**
 * wake 旁路 UIMessage 流：phase===wake 时连接 `/turn-stream`，
 * 累积助手消息供直播气泡；transient data 走与 prompt onData 相同的回调。
 */
export function useWakeTurnStream(options: {
  baseUrl: Ref<string>;
  token: Ref<string>;
  userId: Ref<string>;
  agentId: Ref<string>;
  enabled: Ref<boolean>;
  handlers: WakeTurnStreamHandlers;
}) {
  const streaming = ref(false);
  const liveMessage = shallowRef<UIMessage | null>(null);
  let abort: AbortController | undefined;
  let generation = 0;

  function stop(): void {
    abort?.abort();
    abort = undefined;
    streaming.value = false;
  }

  function handleChunk(chunk: UIMessageChunk): void {
    const type = (chunk as { type?: string }).type ?? "";
    const data = (chunk as { data?: unknown }).data;
    if (type === "data-agentup-approval" && isAgentUpApproval(data)) {
      options.handlers.onApproval?.(data);
      return;
    }
    if (type === "data-agentup-ask-user" && isAgentUpAskUser(data)) {
      options.handlers.onAskUser?.(data);
      return;
    }
    if (type === "data-agentup-shell-hang" && isAgentUpShellHang(data)) {
      options.handlers.onShellHang?.(data);
      return;
    }
    if (type === "data-agentup-delegation-started" && isAgentUpDelegationStarted(data)) {
      options.handlers.onDelegationStarted?.(data);
      return;
    }
    if (type === "data-agentup-model-unavailable" && isAgentUpModelUnavailable(data)) {
      showToast(data.message || t("modelUnavailable"), "error");
    }
  }

  async function run(gen: number): Promise<void> {
    const base = options.baseUrl.value.replace(/\/$/, "");
    const token = options.token.value;
    const userId = options.userId.value;
    const agentId = options.agentId.value;
    if (!base || !token || !userId || !agentId) return;

    const url = turnStreamUrl(base, userId, agentId);

    abort = new AbortController();
    streaming.value = true;
    liveMessage.value = null;
    try {
      const response = await fetch(url, {
        method: "GET",
        headers: {
          authorization: `Bearer ${token}`,
          accept: "text/event-stream",
          "x-ui-locale": readUiLocale(),
        },
        signal: abort.signal,
      });
      if (!response.ok || !response.body) return;
      if (gen !== generation) return;

      const chunkStream = parseJsonEventStream({
        stream: response.body,
        schema: uiMessageChunkSchema,
      }).pipeThrough(
        new TransformStream({
          transform(part, controller) {
            if (!part.success) throw part.error;
            handleChunk(part.value);
            controller.enqueue(part.value);
          },
        }),
      );

      for await (const message of readUIMessageStream({ stream: chunkStream })) {
        if (gen !== generation || abort?.signal.aborted) return;
        liveMessage.value = message;
      }
    } catch (error) {
      if (abort?.signal.aborted) return;
      void error;
    } finally {
      if (gen === generation) {
        streaming.value = false;
        options.handlers.onDone?.();
      }
    }
  }

  watch(
    () =>
      [
        options.enabled.value,
        options.baseUrl.value,
        options.token.value,
        options.userId.value,
        options.agentId.value,
      ] as const,
    ([enabled]) => {
      stop();
      generation += 1;
      const gen = generation;
      liveMessage.value = null;
      if (!enabled) return;
      void run(gen);
    },
    { immediate: true },
  );

  if (getCurrentScope()) {
    onScopeDispose(() => {
      generation += 1;
      stop();
      liveMessage.value = null;
    });
  }

  return { streaming, liveMessage };
}
