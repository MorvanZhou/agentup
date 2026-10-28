<script setup lang="ts">
import { computed, ref } from "vue";
import { useRouter } from "vue-router";
import { PlusIcon, SearchIcon } from "@lucide/vue";

import { useDesktop } from "../../../../app/desktop";
import type { GroupRoom } from "../../../../shared/api/runtime/groups";
import type { AgentCard } from "../../../../shared/model/runtime/runtime";
import { t } from "../../../../shared/model/ui/ui-locale";
import type { ConversationRow } from "../../model/sidebar/conversation-row";
import {
  mergeSidebarSlots,
  type GroupSidebarAttention,
} from "../../model/sidebar/group-sidebar";
import AgentSidebarItem from "./AgentSidebarItem.vue";
import GroupSidebarItem from "./GroupSidebarItem.vue";

const props = defineProps<{
  rows: ConversationRow[];
  groups?: GroupRoom[];
  selectedGroupId?: string | null;
  /** 群 HITL：有 groupId 的审批 / 提问，点亮群侧栏角标。 */
  groupAttention?: GroupSidebarAttention;
  /** 正在主区建群时，单聊不再显示选中。 */
  creatingGroup?: boolean;
  /** 尚无第三方已招募 Agent 时为 true。 */
  showRecruitNudge?: boolean;
}>();

const { unread } = useDesktop();

const emit = defineEmits<{
  select: [agent: AgentCard];
  start: [agent: AgentCard];
  selectGroup: [groupId: string];
  createGroup: [];
}>();

const router = useRouter();
const query = ref("");

const slots = computed(() =>
  mergeSidebarSlots(props.rows, props.groups ?? [], query.value, {
    selectedGroupId: props.selectedGroupId,
    attention: props.groupAttention,
    unread: unread.value,
  }),
);
const avatarByAgent = computed(() => {
  const map: Record<string, string> = {};
  for (const row of props.rows) {
    const url = row.agent.avatarUrl;
    if (url) map[row.agent.agentId] = url;
  }
  return map;
});
const searching = computed(() => Boolean(query.value.trim()));
const listEmpty = computed(() => props.rows.length === 0 && (props.groups ?? []).length === 0);
/** 有搜索词时不抢 sideNoMatch；仅在空列表+无搜索时展示引导。 */
const recruitNudgeVisible = computed(
  () => Boolean(props.showRecruitNudge) && !searching.value,
);
const groupSurface = computed(() => Boolean(props.selectedGroupId) || Boolean(props.creatingGroup));

function goMarket(): void {
  void router.push({ name: "market" });
}

function goLocalCreate(): void {
  void router.push({ name: "agents-local-new" });
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
      <button
        type="button"
        class="app-no-drag grid size-8 shrink-0 cursor-pointer place-items-center rounded-lg border border-rule bg-paper text-foreground transition duration-200 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/30"
        :class="{ 'border-accent/40 bg-accent/10 text-accent': creatingGroup }"
        :aria-label="t('groupNew')"
        :aria-pressed="creatingGroup"
        @click="emit('createGroup')"
      >
        <PlusIcon class="size-4" />
      </button>
    </div>

    <!-- 消息列表：单聊和群混在一列 -->
    <nav class="flex min-h-0 flex-1 flex-col overflow-x-auto overflow-y-auto min-[730px]:overflow-x-hidden">
      <p v-if="listEmpty" class="px-3 py-4 text-sm text-muted-foreground">{{ t("sideEmpty") }}</p>
      <p v-else-if="slots.length === 0" class="px-3 py-4 text-sm text-muted-foreground">{{ t("sideNoMatch") }}</p>
      <template
        v-for="slot in slots"
        :key="slot.kind === 'agent' ? slot.row.agent.agentId : `group:${slot.row.room.id}`"
      >
        <AgentSidebarItem
          v-if="slot.kind === 'agent'"
          :row="groupSurface ? { ...slot.row, selected: false } : slot.row"
          @select="emit('select', slot.row.agent)"
          @start="emit('start', slot.row.agent)"
        />
        <GroupSidebarItem
          v-else
          :row="creatingGroup ? { ...slot.row, selected: false } : slot.row"
          :avatars="avatarByAgent"
          @select="emit('selectGroup', slot.row.room.id)"
        />
      </template>
      <!-- 无第三方招募：居中空态，与会话列表行区分 -->
      <div
        v-if="recruitNudgeVisible"
        class="app-no-drag flex min-h-40 flex-1 flex-col items-center justify-center px-5 py-8 text-center"
      >
        <p class="m-0 max-w-44 text-sm font-medium text-foreground">{{ t("sideRecruitNudgeTitle") }}</p>
        <p class="mt-1.5 m-0 max-w-44 text-sm leading-snug text-muted-foreground">
          {{ t("sideRecruitNudgeBody") }}
        </p>
        <div class="mt-4 flex w-full max-w-44 flex-col items-stretch gap-2">
          <button
            type="button"
            class="inline-flex min-h-8 cursor-pointer items-center justify-center rounded-lg border-0 bg-accent px-3 text-sm font-semibold text-white transition duration-200 hover:bg-accent-deep focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
            @click="goMarket"
          >
            {{ t("sideRecruitNudgeCta") }}
          </button>
          <button
            type="button"
            class="inline-flex min-h-8 cursor-pointer items-center justify-center rounded-lg border border-rule bg-paper px-3 text-sm font-semibold text-foreground transition duration-200 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/15"
            @click="goLocalCreate"
          >
            {{ t("sideRecruitNudgeLocalCta") }}
          </button>
        </div>
      </div>
    </nav>
  </div>
</template>
