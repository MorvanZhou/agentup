<script setup lang="ts">
import {
  ActionBarPrimitiveCopy,
  ActionBarPrimitiveReload,
  PartByIndexProvider,
  useAuiState,
} from "@assistant-ui/vue";
import type {} from "@assistant-ui/core/store";
import {
  CheckIcon,
  CopyIcon,
  LoaderCircleIcon,
  RefreshCwIcon,
} from "@lucide/vue";
import { TabsContent, TabsList, TabsRoot, TabsTrigger } from "reka-ui";
import { computed, ref, watch } from "vue";

import AgentAvatar from "../../../../../../shared/components/AgentAvatar.vue";
import { t } from "../../../../../../shared/model/ui-locale";
import {
  buildAssistantByproducts,
  type ByproductTabId,
} from "../../../../model/message-byproducts";
import { injectPendingAskUserToolCallId } from "../../../../model/thread-ask-user";
import { injectThreadExtras } from "../../../../model/thread-extras";
import AssistAgentsPanel from "./byproducts/AssistAgentsPanel.vue";
import AssistantProcessTimeline from "./byproducts/AssistantProcessTimeline.vue";
import TodoPanel from "./byproducts/TodoPanel.vue";
import MarkdownText from "./parts/MarkdownText.vue";

const extras = injectThreadExtras();
const pendingAskUserToolCallId = injectPendingAskUserToolCallId();
const copied = useAuiState((s) => s.message.isCopied);
const agentName = computed(() => extras.value.name);
const agentAvatar = computed(() => extras.value.avatarUrl ?? "");
const error = useAuiState((s) => {
  const message = s.message;
  if (
    message.role !== "assistant" ||
    message.status.type !== "incomplete" ||
    message.status.reason !== "error"
  ) {
    return null;
  }
  const value = message.status.error;
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && "message" in value) {
    return String(value.message);
  }
  return t("msgError");
});

const streaming = useAuiState((s) => s.message.status?.type === "running");
const parts = useAuiState((s) => s.message.parts);
const metadata = useAuiState((s) => s.message.metadata);
const messageCancelStatus = useAuiState((s) => {
  const message = s.message;
  if (message.role !== "assistant") return false;
  return message.status?.type === "incomplete" && message.status.reason === "cancelled";
});
const hasOpenAskUser = useAuiState(
  (s) =>
    s.message.role === "assistant" &&
    s.message.status?.type !== "running" &&
    s.message.parts.some(
      (part) =>
        part.type === "tool-call" &&
        part.toolName === "ask_user" &&
        part.result === undefined,
    ),
);
/** 停止后：消息被标 cancelled，或 AskUser 浮层已撤但工具仍无结果。 */
const terminated = computed(
  () =>
    messageCancelStatus.value || (hasOpenAskUser.value && !pendingAskUserToolCallId.value),
);
/** 气泡左下角：本条仍在生成时给稳定反馈（步骤折叠/正文静止时也看得见）。 */
const showWorking = computed(() => streaming.value && !terminated.value);

const byproducts = computed(() =>
  buildAssistantByproducts({
    parts: parts.value,
    metadata: metadata.value,
    streaming: streaming.value,
  }),
);

const activeTab = ref<ByproductTabId>("process");
watch(
  () => byproducts.value.defaultTabId,
  (id) => {
    activeTab.value = id;
  },
  { immediate: true },
);
watch(
  () => byproducts.value.tabs.map((tab) => tab.id).join(","),
  () => {
    if (!byproducts.value.tabs.some((tab) => tab.id === activeTab.value)) {
      activeTab.value = byproducts.value.defaultTabId;
    }
  },
);

const hasProcessTab = computed(() =>
  byproducts.value.tabs.some((tab) => tab.id === "process"),
);
const hasSummaryTab = computed(() =>
  byproducts.value.tabs.some((tab) => tab.id === "summary"),
);
</script>

<template>
  <li data-role="assistant" class="group flex min-w-0 max-w-[90%] flex-row gap-2.5">
    <!-- 助手头像 -->
    <div class="mt-0.5 flex shrink-0 flex-col items-end">
      <AgentAvatar
        :name="agentName || 'A'"
        :avatar-url="agentAvatar || undefined"
        size="lg"
      />
    </div>

    <div class="flex min-w-0 max-w-full flex-1 flex-col items-start gap-1">
      <!-- 助手气泡：主产物 + 副产物 tabs（顶栏近似浏览器标签） -->
      <div
        class="w-full max-w-full min-w-0 wrap-break-word overflow-x-hidden rounded-lg rounded-tl-sm bg-muted text-sm leading-relaxed text-foreground shadow-sm"
      >
        <TabsRoot
          v-model="activeTab"
          class="flex w-full min-w-0 flex-col"
        >
          <!-- 顶栏：Chrome 式标签条 -->
          <TabsList
            v-if="byproducts.showTabBar"
            class="flex min-w-0 flex-wrap items-end gap-0.5 border-b border-rule/70 bg-paper/70 px-2 pt-1.5"
            :aria-label="t('msgProducts')"
          >
            <template v-for="tab in byproducts.tabs" :key="tab.id">
              <TabsTrigger
                v-if="tab.id !== 'subagents'"
                :value="tab.id"
                class="relative -mb-px inline-flex min-h-8 max-w-[8rem] items-center truncate rounded-t-lg border border-transparent px-3 text-xs font-medium text-muted-foreground transition duration-200 hover:text-foreground data-[state=active]:border-rule/70 data-[state=active]:border-b-muted data-[state=active]:bg-muted data-[state=active]:text-foreground data-[state=inactive]:hover:bg-black/5 dark:data-[state=inactive]:hover:bg-white/5"
              >
                {{ tab.label }}
              </TabsTrigger>
              <TabsTrigger
                v-else
                :value="tab.id"
                class="relative -mb-px inline-flex min-h-8 items-center rounded-t-lg border border-transparent px-2 transition duration-200 data-[state=active]:border-rule/70 data-[state=active]:border-b-muted data-[state=active]:bg-muted data-[state=inactive]:hover:bg-black/5 dark:data-[state=inactive]:hover:bg-white/5"
                :aria-label="t('msgAssistAgents')"
              >
                <AssistAgentsPanel
                  :assists="byproducts.assists"
                  variant="trigger"
                />
              </TabsTrigger>
            </template>
          </TabsList>

          <div class="px-3 py-3">
          <!-- 总结：仅主产物 text -->
          <TabsContent
            v-if="hasSummaryTab && byproducts.summaryPartIndex !== undefined"
            value="summary"
            class="min-w-0 outline-none"
          >
            <PartByIndexProvider :index="byproducts.summaryPartIndex">
              <MarkdownText />
            </PartByIndexProvider>
          </TabsContent>

          <!-- 待办：完整 checklist（结束后） -->
          <TabsContent
            v-if="byproducts.todoItems.length > 0"
            value="todo"
            class="min-w-0 outline-none"
          >
            <TodoPanel
              :items="byproducts.todoItems"
              :default-open="true"
            />
          </TabsContent>

          <!-- 过程：完整时间线（可与总结重复最后一段 text） -->
          <TabsContent
            v-if="hasProcessTab"
            value="process"
            class="min-w-0 outline-none"
          >
            <AssistantProcessTimeline />
          </TabsContent>

          <!-- 协助 Agent -->
          <TabsContent
            v-if="byproducts.assists.length > 0"
            value="subagents"
            class="min-w-0 outline-none"
          >
            <AssistAgentsPanel
              :assists="byproducts.assists"
              variant="panel"
            />
          </TabsContent>

          <!-- 无过程 tab 时（仅总结等）仍展示终止/错误 -->
          <template v-if="!hasProcessTab">
            <p
              v-if="terminated"
              class="text-muted-foreground mb-0 mt-2 text-xs"
              role="status"
            >
              {{ t("msgCancelled") }}
            </p>
            <span v-if="error" class="text-destructive text-sm">{{ error }}</span>
          </template>

          <!-- 左下角：流式中提示仍在工作（步骤折叠/正文静止时也看得见） -->
          <div
            v-if="showWorking"
            class="mt-2 flex items-center gap-1.5"
            role="status"
            aria-live="polite"
          >
            <LoaderCircleIcon
              class="size-3 shrink-0 animate-spin text-muted-foreground motion-reduce:animate-none"
              aria-hidden="true"
            />
            <span class="text-xs text-muted-foreground">{{ t("msgWorking") }}</span>
          </div>
          </div>
        </TabsRoot>
      </div>

      <!-- 操作栏 -->
      <div
        class="text-muted-foreground flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100"
      >
        <ActionBarPrimitiveCopy class="hover:text-foreground rounded p-1" :aria-label="t('msgCopy')">
          <CheckIcon v-if="copied" class="size-3.5" />
          <CopyIcon v-else class="size-3.5" />
        </ActionBarPrimitiveCopy>
        <ActionBarPrimitiveReload class="hover:text-foreground rounded p-1" :aria-label="t('msgReload')">
          <RefreshCwIcon class="size-3.5" />
        </ActionBarPrimitiveReload>
      </div>
    </div>
  </li>
</template>
