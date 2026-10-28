import {
  parseJsonEventStream,
  readUIMessageStream,
  uiMessageChunkSchema,
  type UIMessage,
  type UIMessageChunk,
} from "ai";
import { getCurrentScope, onScopeDispose, ref, shallowRef, watch, type Ref } from "vue";

import { groupTurnStreamUrl } from "../../../shared/api/runtime/groups";
import {
  isAgentUpApproval,
  isAgentUpAskUser,
  isAgentUpModelUnavailable,
  isAgentUpShellHang,
  type AgentUpApprovalData,
  type AgentUpAskUserData,
  type AgentUpShellHangData,
} from "../../../shared/model/chat/chat";
import { showToast } from "../../../shared/model/ui/toast";
import { readUiLocale, t } from "../../../shared/model/ui/ui-locale";

export type GroupHolderStreamHandlers = {
  onApproval?: (data: AgentUpApprovalData) => void;
  onAskUser?: (data: AgentUpAskUserData) => void;
  onShellHang?: (data: AgentUpShellHangData) => void;
};

/**
 * 群执掌者这一轮的直播。过程块和一对一相同，结束后由 onDone 把落盘的发言拉回来。
 * transient HITL（ask_user / 审批 / shell hang）走与 wake 流相同的 data-* 回调。
 * 已经结束的回放不再自动重连，避免空转。
 */
export function useGroupHolderStream(options: {
  baseUrl: Ref<string>;
  token: Ref<string>;
  userId: Ref<string>;
  groupId: Ref<string>;
  turnId: Ref<string>;
  enabled: Ref<boolean>;
  handlers?: GroupHolderStreamHandlers;
  onDone?: () => Promise<void> | void;
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
      options.handlers?.onApproval?.(data);
      return;
    }
    if (type === "data-agentup-ask-user" && isAgentUpAskUser(data)) {
      options.handlers?.onAskUser?.(data);
      return;
    }
    if (type === "data-agentup-shell-hang" && isAgentUpShellHang(data)) {
      options.handlers?.onShellHang?.(data);
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
    const groupId = options.groupId.value;
    if (!base || !token || !userId || !groupId) return;

    abort = new AbortController();
    streaming.value = true;
    liveMessage.value = null;
    let turnOpen = false;
    try {
      const response = await fetch(groupTurnStreamUrl(base, userId, groupId), {
        method: "GET",
        headers: {
          authorization: `Bearer ${token}`,
          accept: "text/event-stream",
          "x-ui-locale": readUiLocale(),
        },
        signal: abort.signal,
      });
      if (!response.ok || !response.body || gen !== generation) return;
      turnOpen = response.headers.get("x-group-turn-open") === "1";
      const chunkStream = parseJsonEventStream({
        stream: response.body,
        schema: uiMessageChunkSchema,
      }).pipeThrough(
        new TransformStream<
          { success: true; value: UIMessageChunk } | { success: false; error: unknown },
          UIMessageChunk
        >({
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
    } catch {
      if (abort?.signal.aborted || gen !== generation) return;
    } finally {
      if (gen !== generation) return;
      streaming.value = false;
      const turnBefore = options.turnId.value;
      try {
        await options.onDone?.();
      } catch {
        // 刷新失败时保留刚看到的过程，下一轮再拉。
      }
      // 回合 id 变了会由 watch 重连。这里只补「连接断了但同一轮还在跑」。
      if (gen !== generation || !options.enabled.value || !turnOpen) return;
      if (options.turnId.value !== turnBefore) return;
      generation += 1;
      void run(generation);
    }
  }

  watch(
    () =>
      [
        options.enabled.value,
        options.baseUrl.value,
        options.token.value,
        options.userId.value,
        options.groupId.value,
        options.turnId.value,
      ] as const,
    ([enabled]) => {
      stop();
      generation += 1;
      const gen = generation;
      if (!enabled) {
        liveMessage.value = null;
        return;
      }
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
