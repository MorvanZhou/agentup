import { getCurrentScope, onScopeDispose, watch, type Ref } from "vue";

import { readUiLocale } from "../../../shared/model/ui-locale";

/**
 * 订阅 runtime `/turn-progress` SSE：
 * wake / 编排回合无主 prompt 流时，靠 dirty 刷新历史、done 收尾。
 */
export function useTurnProgress(options: {
  baseUrl: Ref<string>;
  token: Ref<string>;
  userId: Ref<string>;
  agentId: Ref<string>;
  /** 为 true 时保持连接（通常：本会话 busyTurn.phase === wake）。 */
  enabled: Ref<boolean>;
  onDirty: () => void;
  onDone?: () => void;
}) {
  let abort: AbortController | undefined;
  let generation = 0;

  function stop(): void {
    abort?.abort();
    abort = undefined;
  }

  async function run(gen: number): Promise<void> {
    const base = options.baseUrl.value.replace(/\/$/, "");
    const token = options.token.value;
    const userId = options.userId.value;
    const agentId = options.agentId.value;
    if (!base || !token || !userId || !agentId) return;

    const url =
      `${base}/turn-progress` +
      `?user_id=${encodeURIComponent(userId)}` +
      `&agent_id=${encodeURIComponent(agentId)}`;

    abort = new AbortController();
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
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (gen === generation) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split("\n\n");
        buffer = parts.pop() ?? "";
        for (const block of parts) {
          if (gen !== generation) return;
          handleBlock(block);
        }
      }
    } catch (error) {
      if (abort?.signal.aborted) return;
      // 断线静默；enabled 仍 true 时由 watch 重连
      void error;
    }
  }

  function handleBlock(block: string): void {
    let event = "message";
    const dataLines: string[] = [];
    for (const line of block.split("\n")) {
      if (line.startsWith("event:")) event = line.slice(6).trim();
      else if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
      else if (line.startsWith(":")) continue;
    }
    if (dataLines.length === 0) return;
    let payload: { agent_id?: string } = {};
    try {
      payload = JSON.parse(dataLines.join("\n")) as { agent_id?: string };
    } catch {
      return;
    }
    if (payload.agent_id && payload.agent_id !== options.agentId.value) return;
    if (event === "dirty") options.onDirty();
    else if (event === "done") options.onDone?.();
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
      if (!enabled) return;
      void run(gen).then(() => {
        // 非主动 stop 且仍 enabled：短暂后重连
        if (gen !== generation || !options.enabled.value) return;
        window.setTimeout(() => {
          if (gen === generation && options.enabled.value) void run(generation);
        }, 800);
      });
    },
    { immediate: true },
  );

  if (getCurrentScope()) {
    onScopeDispose(() => {
      generation += 1;
      stop();
    });
  }
}
