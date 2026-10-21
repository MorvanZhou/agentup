<script setup lang="ts">
import { computed, ref } from "vue";
import { useRouter } from "vue-router";
import { SearchIcon } from "@lucide/vue";

import type { AgentCard } from "../../../../shared/model/runtime";
import { t } from "../../../../shared/model/ui-locale";
import {
  filterConversationRows,
  type ConversationRow,
} from "../../model/conversation-row";
import AgentSidebarItem from "./AgentSidebarItem.vue";

const props = defineProps<{
  rows: ConversationRow[];
  /** 尚无第三方已招募 Agent 时为 true。 */
  showRecruitNudge?: boolean;
}>();

const emit = defineEmits<{ select: [agent: AgentCard]; start: [agent: AgentCard] }>();

const router = useRouter();
const query = ref("");

const visible = computed(() => filterConversationRows(props.rows, query.value));
const searching = computed(() => Boolean(query.value.trim()));
/** 有搜索词时不抢 sideNoMatch；仅在空列表+无搜索时展示引导。 */
const recruitNudgeVisible = computed(
  () => Boolean(props.showRecruitNudge) && !searching.value,
);

function goMarket(): void {
  void router.push({ name: "market" });
}
</script>

<template>
  <div class="flex min-h-0 flex-1 flex-col">
    <!-- 会话侧栏 -->
    <!-- 搜索（Electron 顶栏可拖拽 / 双击缩放） -->
    <div class="app-drag flex shrink-0 items-center gap-1.5 px-2.5 py-4">
      <label class="app-no-drag relative min-w-0 flex-1">
        <span class="sr-only">{{ t("sideSearchSessions") }}</span>
        <SearchIcon class="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground" />
        <input
          v-model="query"
          type="search"
          :placeholder="t('sideSearchPlaceholder')"
          class="min-h-8 w-full rounded-md border-0 bg-background py-1.5 pr-2 pl-7 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:bg-muted focus:ring-2 focus:ring-accent/30"
        />
      </label>
    </div>

    <!-- 消息列表 -->
    <nav class="flex min-h-0 flex-1 flex-col overflow-x-auto overflow-y-auto min-[730px]:overflow-x-hidden">
      <p v-if="rows.length === 0" class="px-3 py-4 text-sm text-muted-foreground">{{ t("sideEmpty") }}</p>
      <p v-else-if="visible.length === 0" class="px-3 py-4 text-sm text-muted-foreground">{{ t("sideNoMatch") }}</p>
      <AgentSidebarItem
        v-for="row in visible"
        :key="row.agent.agentId"
        :row="row"
        @select="emit('select', row.agent)"
        @start="emit('start', row.agent)"
      />
      <!-- 无第三方招募：居中空态，与会话列表行区分 -->
      <div
        v-if="recruitNudgeVisible"
        class="app-no-drag flex min-h-40 flex-1 flex-col items-center justify-center px-5 py-8 text-center"
      >
        <p class="m-0 max-w-44 text-sm font-medium text-foreground">{{ t("sideRecruitNudgeTitle") }}</p>
        <p class="mt-1.5 m-0 max-w-44 text-sm leading-snug text-muted-foreground">
          {{ t("sideRecruitNudgeBody") }}
        </p>
        <button
          type="button"
          class="mt-4 inline-flex min-h-8 cursor-pointer items-center justify-center rounded-lg border-0 bg-accent px-3 text-sm font-semibold text-white transition duration-200 hover:bg-accent-deep focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
          @click="goMarket"
        >
          {{ t("sideRecruitNudgeCta") }}
        </button>
      </div>
    </nav>
  </div>
</template>
