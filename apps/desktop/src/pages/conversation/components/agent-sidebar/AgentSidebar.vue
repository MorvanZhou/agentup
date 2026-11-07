<script setup lang="ts">
import { computed, ref } from "vue";
import { useRouter } from "vue-router";
import { PlusIcon, SearchIcon } from "@lucide/vue";

import { useDesktop } from "../../../../app/desktop";
import type { GroupRoom } from "../../../../shared/api/runtime/groups";
import { SEARCH_QUERY_MAX } from "../../../../shared/model/input-limits";
import type { AgentCard } from "../../../../shared/model/runtime/runtime";
import { t } from "../../../../shared/model/ui/ui-locale";
import type { ConversationRow } from "../../model/sidebar/conversation-row";
import {
  buildSidebarSections,
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

/** 群 / 私聊两区；区内自排，不再混时间线。 */
const sections = computed(() =>
  buildSidebarSections(props.rows, props.groups ?? [], query.value, {
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
const hasFiltered = computed(
  () => sections.value.groups.length > 0 || sections.value.agents.length > 0,
);
const listEmpty = computed(() => props.rows.length === 0 && (props.groups ?? []).length === 0);
/** 有搜索词时不抢 sideNoMatch；仅在空列表+无搜索时展示引导。 */
const recruitNudgeVisible = computed(
  () => Boolean(props.showRecruitNudge) && !searching.value,
);
const groupSurface = computed(() => Boolean(props.selectedGroupId) || Boolean(props.creatingGroup));
/** 搜索无群命中时藏空分区；平时群区常驻，强调一等公民。 */
const showGroupsSection = computed(() => !searching.value || sections.value.groups.length > 0);
/** 私聊区：有行才出标题，避免空壳。 */
const showDirectSection = computed(() => sections.value.agents.length > 0);

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
    <!-- 搜索（Electron 顶栏可拖拽 / 双击缩放）；建群入口改挂群分区头 -->
    <div class="app-drag flex shrink-0 items-center gap-1.5 px-2.5 py-4">
      <label class="app-no-drag relative min-w-0 flex-1">
        <span class="sr-only">{{ t("sideSearchSessions") }}</span>
        <SearchIcon class="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground" />
        <input
          v-model="query"
          type="search"
          :maxlength="SEARCH_QUERY_MAX"
          :placeholder="t('sideSearchPlaceholder')"
          class="min-h-8 w-full rounded-md border-0 bg-background py-1.5 pr-2 pl-7 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:bg-muted focus:ring-2 focus:ring-accent/30"
        />
      </label>
    </div>

    <!-- 消息列表：群组区 → 私聊区 -->
    <nav class="flex min-h-0 flex-1 flex-col overflow-x-auto overflow-y-auto min-[730px]:overflow-x-hidden">
      <p
        v-if="searching && !hasFiltered"
        class="px-3 py-4 text-sm text-muted-foreground"
      >
        {{ t("sideNoMatch") }}
      </p>
      <template v-else>
        <!-- 群组分区：有群时标题旁新建；无群时列表位换成建群引导卡 -->
        <section v-if="showGroupsSection" class="app-no-drag shrink-0">
          <div class="flex items-center gap-2 px-3 pt-1 pb-1.5">
            <h2 class="m-0 min-w-0 flex-1 text-xs font-semibold text-muted-foreground">
              {{ t("sideSectionGroups") }}
            </h2>
            <button
              v-if="sections.groups.length > 0"
              type="button"
              class="inline-flex min-h-7 shrink-0 cursor-pointer items-center gap-1 rounded-lg border border-rule bg-paper px-2 text-xs font-semibold text-foreground transition duration-200 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/15"
              :class="{ 'border-accent/40 bg-accent/10 text-accent': creatingGroup }"
              :aria-label="t('groupNew')"
              :aria-pressed="creatingGroup"
              @click="emit('createGroup')"
            >
              <PlusIcon class="size-3.5" aria-hidden="true" />
              {{ t("groupNew") }}
            </button>
          </div>
          <!-- 无群引导：短文案 + 次钮，少占位 -->
          <div
            v-if="sections.groups.length === 0"
            class="flex flex-col items-center text-center"
          >
            <p class="m-0 text-sm text-muted-foreground">{{ t("sideGroupEmptyTitle") }}</p>
            <button
              type="button"
              class="mt-1 inline-flex min-h-8 w-full max-w-44 cursor-pointer items-center justify-center rounded-lg border border-rule bg-paper px-3 text-sm font-semibold text-foreground transition duration-200 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/15"
              :class="{ 'border-accent/40 bg-accent/10 text-accent': creatingGroup }"
              :aria-pressed="creatingGroup"
              @click="emit('createGroup')"
            >
              {{ t("sideGroupEmptyCta") }}
            </button>
          </div>
          <GroupSidebarItem
            v-for="row in sections.groups"
            :key="`group:${row.room.id}`"
            :row="creatingGroup ? { ...row, selected: false } : row"
            :avatars="avatarByAgent"
            @select="emit('selectGroup', row.room.id)"
          />
        </section>

        <!-- 私聊分区：私人助理 + 单聊 -->
        <section v-if="showDirectSection" class="app-no-drag shrink-0">
          <div class="flex items-center px-3 pt-3 pb-1.5">
            <h2 class="m-0 text-xs font-semibold text-muted-foreground">
              {{ t("sideSectionDirect") }}
            </h2>
          </div>
          <AgentSidebarItem
            v-for="row in sections.agents"
            :key="row.agent.agentId"
            :row="groupSurface ? { ...row, selected: false } : row"
            @select="emit('select', row.agent)"
            @start="emit('start', row.agent)"
          />
        </section>

        <p
          v-else-if="listEmpty && !recruitNudgeVisible"
          class="px-3 py-4 text-sm text-muted-foreground"
        >
          {{ t("sideEmpty") }}
        </p>
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
