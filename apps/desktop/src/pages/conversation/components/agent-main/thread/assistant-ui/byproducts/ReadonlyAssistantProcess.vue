<script setup lang="ts">
import {
  AuiConfig,
  AuiProvider,
  MessageByIdProvider,
  useAui,
} from "@assistant-ui/vue";
import {
  ExternalThread,
  type ExternalThreadMessage,
} from "@assistant-ui/core/store";
import type { UIMessage } from "ai";
import { computed, defineComponent, h, provide, ref } from "vue";

import { t } from "../../../../../../../shared/model/ui-locale";
import { threadActiveKey } from "../../../../../model/thread-active";
import { threadAgentIdKey } from "../../../../../model/thread-agent-id";
import { AISDKMessageConverter } from "../../../../../model/ui-to-thread-messages";
import AssistantProcessTimeline from "./AssistantProcessTimeline.vue";

const props = withDefaults(
  defineProps<{
    messages: readonly UIMessage[];
    streaming?: boolean;
    /** 过程折叠缓存用；旁路任务可用 toAgentId / taskId */
    agentId?: string;
  }>(),
  { streaming: false, agentId: "delegation" },
);

provide(
  threadAgentIdKey,
  computed(() => props.agentId || "delegation"),
);
provide(threadActiveKey, ref(true));

const threadMessages = computed(
  () =>
    AISDKMessageConverter.toThreadMessages(
      [...props.messages],
      props.streaming,
    ) as ExternalThreadMessage[],
);

const lastAssistantId = computed(() => {
  for (let i = threadMessages.value.length - 1; i >= 0; i -= 1) {
    const message = threadMessages.value[i];
    if (message?.role === "assistant") return message.id;
  }
  return undefined;
});

/**
 * ExternalThread 挂在 thread scope 上时，会经 transformScopes 自动挂上
 * SingleThreadList + Derived(thread / threadListItem)。
 * 不要只传 threads: SingleThreadList(...)，否则没有 thread 作用域。
 */
const config = computed(() =>
  AuiConfig({
    thread: ExternalThread({
      messages: threadMessages.value,
      isRunning: props.streaming,
      isSendDisabled: true,
      onNew: () => undefined,
    }),
  }),
);

/** 在隔离 Aui 作用域内挂到最后一条 assistant，再复用过程时间线。 */
const AssistantScope = defineComponent({
  name: "DelegationAssistantScope",
  setup() {
    const aui = useAui();
    const id = computed(() => {
      try {
        const list = aui.thread.getState().messages;
        for (let i = list.length - 1; i >= 0; i -= 1) {
          if (list[i]?.role === "assistant") return list[i]!.id;
        }
      } catch {
        // thread 尚未就绪
      }
      return lastAssistantId.value;
    });
    return () => {
      if (!id.value) {
        return h(
          "p",
          { class: "mb-0 text-sm text-muted-foreground" },
          props.streaming ? t("assistRunningShort") : t("assistNoProcess"),
        );
      }
      return h(MessageByIdProvider, { id: id.value }, () =>
        h(AssistantProcessTimeline, { showStatus: true }),
      );
    };
  },
});
</script>

<template>
  <!-- 旁路只读：隔离 AuiProvider + 主 Agent 同一套过程 parts UI -->
  <AuiProvider :config="config" :extends="null">
    <div
      class="min-w-0 rounded-lg bg-muted px-3 py-3 text-sm leading-relaxed text-foreground"
      data-testid="delegation-process-body"
    >
      <AssistantScope />
    </div>
  </AuiProvider>
</template>
