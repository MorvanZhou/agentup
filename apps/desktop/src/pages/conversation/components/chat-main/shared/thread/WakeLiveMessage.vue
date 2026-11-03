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

import { useDesktop } from "../../../../../../app/desktop";
import UserAvatar from "../../../../../../shared/components/avatar/UserAvatar.vue";
import { sessionDisplayNickname } from "../../../../../../shared/model/session/session";
import { AISDKMessageConverter } from "../../../../model/thread/ui-to-thread-messages";
import ChatBubble from "../ChatBubble.vue";
import AssistantMessage from "./assistant-ui/AssistantMessage.vue";

const props = withDefaults(
  defineProps<{
    /** 助手直播；仅乐观用户气泡时可为 null。 */
    message?: UIMessage | null;
    streaming?: boolean;
    /** followUp / 群发送乐观：用户那条先亮，排在助手气泡之上。 */
    userText?: string;
  }>(),
  { message: null, streaming: true, userText: "" },
);

const { session } = useDesktop();

const threadMessages = computed(() => {
  if (!props.message) return [] as ExternalThreadMessage[];
  return AISDKMessageConverter.toThreadMessages(
    [props.message],
    props.streaming,
  ) as ExternalThreadMessage[];
});

const providerKey = computed(() => props.message?.id || "wake-live-user");

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
    <div
      class="mb-4 flex min-w-0 flex-col gap-y-4"
      data-testid="wake-live-message"
      aria-live="polite"
    >
      <!-- 队列消费 / 群乐观发送：用户这条先出，助手气泡在它下面流式输出 -->
      <div v-if="props.userText" data-testid="wake-live-user">
        <ChatBubble side="user">
          <template #avatar>
            <UserAvatar
              :name="sessionDisplayNickname(session)"
              :avatar-url="session?.avatarUrl"
              size="lg"
            />
          </template>
          <span class="inline whitespace-pre-wrap">{{ props.userText }}</span>
        </ChatBubble>
      </div>
      <AssistantScope v-if="props.message" />
    </div>
  </AuiProvider>
</template>
