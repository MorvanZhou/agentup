<script setup lang="ts">
import { ArrowUpToLineIcon, PencilIcon, Trash2Icon, XIcon } from "@lucide/vue";
import { onBeforeUnmount, onMounted, ref, watch } from "vue";

import { DesktopApi } from "../../../../../shared/api/runtime";
import type { FollowUpItem } from "../../../../../shared/api/runtime/follow-ups";
import { t } from "../../../../../shared/model/ui/ui-locale";

/**
 * followUp 队列：本地 Agent App（SDK）接入下，回合进行中用户新发的消息会进 runtime 队列，
 * 本轮结束后合并成一条再开一轮（docs/agent_cli §12.8 / §12.8.1）。
 * 只在队列非空时占位：不占历史、不进消息流。
 */
const props = defineProps<{
  token: string;
  userId: string;
  agentId: string;
  /** 回合是否在进行中；结束时再刷一次，确认队列已被消费。 */
  busy: boolean;
}>();

const api = new DesktopApi();
const items = ref<FollowUpItem[]>([]);
const editingId = ref("");
const draft = ref("");
const max = 5;
let revision = 0;
let mutating = false;

/** 词条里是 `{n}` 占位：走 vue-i18n 命名插值，别自己 replace（会被编译成插值槽）。 */
function withCount(key: string, count: number): string {
  return t(key, { n: count });
}

/** 内容没变就别换引用：轮询每秒一次，换引用会让整块重渲染（按钮抖动、点不中）。 */
function sameQueue(next: FollowUpItem[], current: FollowUpItem[]): boolean {
  if (next.length !== current.length) return false;
  return next.every((item, index) => {
    const old = current[index]!;
    return item.id === old.id && item.text === old.text;
  });
}

async function refresh(): Promise<void> {
  if (!props.token || !props.userId || !props.agentId) return;
  if (mutating) return;
  const currentRevision = revision;
  const currentAgentId = props.agentId;
  try {
    const next = await api.listFollowUps(props.token, props.userId, props.agentId);
    if (mutating || currentRevision !== revision || currentAgentId !== props.agentId) return;
    if (sameQueue(next, items.value)) return;
    items.value = next;
  } catch {
    if (currentRevision !== revision || currentAgentId !== props.agentId) return;
    // 拉不到队列就不显示：不打扰正在进行的对话
    if (items.value.length > 0) items.value = [];
  }
}

async function run(action: () => Promise<FollowUpItem[] | number>): Promise<void> {
  if (mutating) return;
  mutating = true;
  revision += 1;
  const currentRevision = revision;
  try {
    const next = await action();
    if (currentRevision === revision) items.value = Array.isArray(next) ? next : [];
  } catch {
    // 操作失败保留当前快照；下一次轮询会重新收敛。
  } finally {
    mutating = false;
  }
}

function startEdit(item: FollowUpItem): void {
  editingId.value = item.id;
  draft.value = item.text;
}

async function saveEdit(id: string): Promise<void> {
  const text = draft.value.trim();
  if (!text) return;
  editingId.value = "";
  await run(() => api.updateFollowUp(props.token, props.userId, props.agentId, id, text));
}

// 入队发生在 runtime 侧，客户端拿不到推送事件：回合中轮询是收敛成本最低的做法
const timer = setInterval(() => {
  if (props.busy || items.value.length > 0) void refresh();
}, 1_000);

onMounted(refresh);
onBeforeUnmount(() => clearInterval(timer));
watch(
  () => [props.agentId, props.busy],
  () => {
    revision += 1;
    void refresh();
  },
);
</script>

<template>
  <!-- 已排队消息：回合进行中用户新发的消息，本轮结束后合并发送 -->
  <section
    v-if="items.length > 0"
    class="border-t border-rule bg-paper px-3 py-2"
    role="status"
    :aria-label="withCount('followUpQueued', items.length)"
  >
    <div class="flex items-center justify-between gap-2">
      <p class="text-xs text-muted-foreground">
        {{ withCount("followUpQueued", items.length) }} · {{ t("followUpHint") }}
      </p>
      <button
        type="button"
        class="min-h-8 rounded-lg border border-rule bg-paper px-2 text-xs text-muted-foreground transition hover:text-foreground focus-visible:ring-2 focus-visible:ring-accent/15 focus-visible:outline-none"
        @click="run(() => api.clearFollowUps(token, userId, agentId))"
      >
        {{ t("followUpClearAll") }}
      </button>
    </div>

    <ul class="mt-1.5 space-y-1">
      <li
        v-for="item in items"
        :key="item.id"
        class="flex items-center gap-2 rounded-lg border border-rule bg-background px-2 py-1.5"
      >
        <!-- 编辑中的条目：内联输入，回车保存 -->
        <input
          v-if="editingId === item.id"
          v-model="draft"
          class="min-h-8 flex-1 rounded-lg border border-rule bg-paper px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-accent/15"
          @keydown.enter="saveEdit(item.id)"
        />
        <p v-else class="flex-1 truncate text-sm">{{ item.text }}</p>

        <button
          v-if="editingId !== item.id"
          type="button"
          class="rounded-md p-1 text-muted-foreground transition hover:text-accent focus-visible:ring-2 focus-visible:ring-accent/15 focus-visible:outline-none"
          :aria-label="t('followUpPromote')"
          @click="run(() => api.promoteFollowUp(token, userId, agentId, item.id))"
        >
          <ArrowUpToLineIcon class="size-3.5" />
        </button>
        <button
          v-if="editingId !== item.id"
          type="button"
          class="rounded-md p-1 text-muted-foreground transition hover:text-accent focus-visible:ring-2 focus-visible:ring-accent/15 focus-visible:outline-none"
          :aria-label="t('followUpEdit')"
          @click="startEdit(item)"
        >
          <PencilIcon class="size-3.5" />
        </button>
        <button
          type="button"
          class="rounded-md p-1 text-muted-foreground transition hover:text-accent focus-visible:ring-2 focus-visible:ring-accent/15 focus-visible:outline-none"
          :aria-label="editingId === item.id ? t('followUpCancelEdit') : t('followUpRemove')"
          @click="editingId === item.id ? (editingId = '') : run(() => api.removeFollowUp(token, userId, agentId, item.id))"
        >
          <XIcon v-if="editingId === item.id" class="size-3.5" />
          <Trash2Icon v-else class="size-3.5" />
        </button>
      </li>
    </ul>

    <p v-if="items.length >= max" class="mt-1 text-xs text-muted-foreground">{{ t("followUpFull") }}</p>
  </section>
</template>
