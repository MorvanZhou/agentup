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
import { computed, defineComponent, h } from "vue";

import { AISDKMessageConverter } from "../../../model/thread/ui-to-thread-messages";
import AssistantMessage from "./assistant-ui/AssistantMessage.vue";

const props = withDefaults(
  defineProps<{
    message: UIMessage;
    streaming?: boolean;
  }>(),
  { streaming: true },
);

const threadMessages = computed(
  () =>
    AISDKMessageConverter.toThreadMessages(
      [props.message],
      props.streaming,
    ) as ExternalThreadMessage[],
);

const providerKey = computed(() => props.message.id || "wake-live");

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

/** 隔离作用域内挂最后一条 assistant，复用主线程气泡。 */
const AssistantScope = defineComponent({
  name: "WakeLiveAssistantScope",
  setup() {
    const id = useAuiState((s) => {
      const list = s.thread.messages;
      for (let i = list.length - 1; i >= 0; i -= 1) {
        if (list[i]?.role === "assistant") return list[i]!.id;
      }
      return undefined as string | undefined;
    });
    return () => {
      if (!id.value) return null;
      return h(MessageByIdProvider, { id: id.value }, () => h(AssistantMessage));
    };
  },
});
</script>

<template>
  <!-- wake 直播：与主线程同形气泡，不写入 AISDKChat（结束后再刷历史） -->
  <AuiProvider :key="providerKey" :config="config" :extends="null">
    <div class="mb-4 min-w-0" data-testid="wake-live-message" aria-live="polite">
      <AssistantScope />
    </div>
  </AuiProvider>
</template>
