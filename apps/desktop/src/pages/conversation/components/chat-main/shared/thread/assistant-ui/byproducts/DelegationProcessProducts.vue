<script setup lang="ts">
import {
  AuiConfig,
  AuiProvider,
  MessageByIdProvider,
  useAuiState,
} from "@assistant-ui/vue";
import {
  ExternalThread,
  type ExternalThreadMessage,
} from "@assistant-ui/core/store";
import type { UIMessage } from "ai";
import { computed, defineComponent, h, provide, ref } from "vue";

import { t } from "../../../../../../../../shared/model/ui/ui-locale";
import type { ByproductTabId } from "../../../../../../model/message/message-byproducts";
import { threadActiveKey } from "../../../../../../model/thread/thread-active";
import { threadAgentIdKey } from "../../../../../../model/thread/thread-agent-id";
import {
  readonlyToolAutoExpandRef,
  toolAutoExpandKey,
} from "../../../../../../model/thread/tool-auto-expand";
import { AISDKMessageConverter } from "../../../../../../model/thread/ui-to-thread-messages";
import AssistantByproductContent from "./AssistantByproductContent.vue";

const props = withDefaults(
  defineProps<{
    messages: readonly UIMessage[];
    streaming?: boolean;
    loading?: boolean;
    error?: string;
    /** 任务失败原因；跟过程面板走，不单独占外层 tab。 */
    taskError?: string;
    agentId?: string;
    /** 标签栏属于宿主气泡；此组件只提供对应的只读内容。 */
    tab?: ByproductTabId;
  }>(),
  {
    streaming: false,
    loading: false,
    error: "",
    taskError: "",
    agentId: "delegation",
    tab: "process",
  },
);

provide(
  threadAgentIdKey,
  computed(() => props.agentId || "delegation"),
);
provide(threadActiveKey, ref(true));
/** 与 ReadonlyAssistantProcess 一致：旁路过程里的 tool 默认折叠。 */
provide(toolAutoExpandKey, readonlyToolAutoExpandRef());

const threadMessages = computed(
  () =>
    AISDKMessageConverter.toThreadMessages(
      [...props.messages],
      props.streaming,
    ) as ExternalThreadMessage[],
);

const providerKey = computed(() => props.agentId || "delegation");

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

/**
 * 挂到最后一条 assistant。标签栏由上层唯一持有，
 * 避免群委派卡在「过程」下再出现一层 tabs。
 */
const AssistantScope = defineComponent({
  name: "DelegationProductScope",
  setup() {
    const id = useAuiState((s) => {
      const list = s.thread.messages;
      for (let i = list.length - 1; i >= 0; i -= 1) {
        if (list[i]?.role === "assistant") return list[i]!.id;
      }
      return undefined as string | undefined;
    });
    return () => {
      if (!id.value) {
        return h(
          "p",
          { class: "mb-0 text-sm text-muted-foreground" },
          props.streaming ? t("assistRunningShort") : t("assistNoProcess"),
        );
      }
      return h(MessageByIdProvider, { key: id.value, id: id.value }, () =>
        h(AssistantByproductContent, {
          tab: props.tab,
          showProcessStatus: true,
        }),
      );
    };
  },
});
</script>

<template>
  <!-- 旁路任务：加载态与失败原因留在这一层，正文只渲染宿主所选副产物 -->
  <div class="flex min-w-0 flex-col gap-1.5" data-testid="delegation-process-panel">
    <p v-if="taskError" class="m-0 text-xs text-destructive">{{ taskError }}</p>
    <p v-if="loading && messages.length === 0" class="m-0 text-xs text-muted-foreground">
      {{ t("assistLoading") }}
    </p>
    <p v-else-if="error && messages.length === 0" class="m-0 text-xs text-destructive" role="alert">
      {{ error }}
    </p>
    <AuiProvider v-else :key="providerKey" :config="config" :extends="null">
      <AssistantScope />
    </AuiProvider>
  </div>
</template>
