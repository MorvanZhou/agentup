<script setup lang="ts">
import {
  ArrowRightIcon,
  ArrowUpRightIcon,
  ChevronDownIcon,
} from "@lucide/vue";
import { computed, onUnmounted, ref, watch } from "vue";

import AgentAvatar from "../../../../../../../shared/components/avatar/AgentAvatar.vue";
import { showToast } from "../../../../../../../shared/model/ui/toast";
import { t, tf } from "../../../../../../../shared/model/ui/ui-locale";
import { formatElapsedMs } from "../../../../../model/message/elapsed";
import type { AssistAgentRef } from "../../../../../model/message/message-assistants";
import { injectThreadDelegation } from "../../../../../model/thread/thread-delegation";
import {
  injectThreadRoster,
  resolveRosterAgent,
} from "../../../../../model/thread/thread-roster";

const props = withDefaults(
  defineProps<{
    assists: AssistAgentRef[];
    /** trigger：叠放头像（tab 栏）；panel：列表详情 */
    variant?: "trigger" | "panel";
    /** trigger 最多叠放个数 */
    maxStack?: number;
  }>(),
  {
    variant: "panel",
    maxStack: 3,
  },
);

const roster = injectThreadRoster();
const delegation = injectThreadDelegation();
/** 默认展开首个，降低「点开才能懂归属」的成本。 */
const expandedId = ref<string | null>(props.assists[0]?.agentId ?? null);
/** 驱动进行中耗时刷新；无 running 时不跑定时器。 */
const nowMs = ref(Date.now());
/** part.timing 缺失时，按 toolCallId 本地兜底起点。 */
const localStartedAt = new Map<string, number>();
let elapsedTimer: ReturnType<typeof setInterval> | undefined;

watch(
  () => props.assists.map((item) => item.agentId).join("\0"),
  () => {
    const ids = new Set(props.assists.map((item) => item.agentId));
    if (expandedId.value && ids.has(expandedId.value)) return;
    expandedId.value = props.assists[0]?.agentId ?? null;
  },
);

const hasRunning = computed(() =>
  props.assists.some((item) => item.status === "running"),
);

watch(
  hasRunning,
  (running) => {
    if (elapsedTimer !== undefined) {
      clearInterval(elapsedTimer);
      elapsedTimer = undefined;
    }
    if (!running) return;
    nowMs.value = Date.now();
    elapsedTimer = setInterval(() => {
      nowMs.value = Date.now();
    }, 1000);
  },
  { immediate: true },
);

onUnmounted(() => {
  if (elapsedTimer !== undefined) clearInterval(elapsedTimer);
});

const stacked = computed(() => props.assists.slice(0, props.maxStack));
const overflow = computed(() => Math.max(0, props.assists.length - props.maxStack));

function displayName(assist: AssistAgentRef): string {
  const agent = resolveRosterAgent(roster.value, assist.agentId, assist.nameHint);
  return agent.remark || agent.name || assist.nameHint || assist.agentId;
}

function avatarUrl(assist: AssistAgentRef): string | undefined {
  return resolveRosterAgent(roster.value, assist.agentId, assist.nameHint).avatarUrl;
}

function statusLabel(assist: AssistAgentRef): string {
  if (assist.status === "running") return t("assistStatusRunning");
  if (assist.status === "failed") return t("assistStatusFailed");
  // 异步派发：父回合工具已结束，但专家可能仍在跑 → 勿标「已完成」。
  if (assist.asyncDispatched) return t("assistStatusDispatched");
  return t("assistStatusDone");
}

function statusTone(assist: AssistAgentRef): string {
  if (assist.status === "running" || assist.asyncDispatched) {
    return "bg-accent/10 text-accent";
  }
  if (assist.status === "failed") {
    return "bg-danger-soft text-destructive";
  }
  return "bg-paper-deep text-muted-foreground";
}

/** 同步协助中，或异步已派发（对方可能仍在执行）。 */
function isAssisting(assist: AssistAgentRef): boolean {
  return assist.status === "running" || Boolean(assist.asyncDispatched);
}

function assistStartMs(assist: AssistAgentRef): number | undefined {
  if (typeof assist.startedAt === "number") return assist.startedAt;
  if (assist.status !== "running") return undefined;
  const key = assist.toolCallId || assist.agentId;
  if (!key) return undefined;
  const cached = localStartedAt.get(key);
  if (cached !== undefined) return cached;
  const start = Date.now();
  localStartedAt.set(key, start);
  return start;
}

/** 身份层耗时：进行中实时刷新；结束态仅在有墙钟 timing 时展示。 */
function elapsedLabel(assist: AssistAgentRef): string | undefined {
  const start = assistStartMs(assist);
  if (start === undefined) return undefined;
  if (assist.status === "running") {
    return formatElapsedMs(nowMs.value - start);
  }
  if (typeof assist.completedAt !== "number") return undefined;
  return formatElapsedMs(assist.completedAt - start);
}

const elapsedByAgentId = computed(() => {
  const out: Record<string, string> = {};
  for (const assist of props.assists) {
    const label = elapsedLabel(assist);
    if (label) out[assist.agentId] = label;
  }
  return out;
});

function toggle(assist: AssistAgentRef): void {
  expandedId.value = expandedId.value === assist.agentId ? null : assist.agentId;
}

function goToAgent(assist: AssistAgentRef): void {
  const result = roster.value.openAgent(assist.agentId);
  if (result === "dismissed") {
    showToast(t("assistDismissed"), "error");
  }
}

function processTaskId(assist: AssistAgentRef): string {
  if (assist.toolCallId) {
    const fromStarted = delegation.value.resolveTaskId(assist.toolCallId);
    if (fromStarted) return fromStarted;
  }
  return assist.taskId || "";
}

function canOpenProcess(assist: AssistAgentRef): boolean {
  return Boolean(processTaskId(assist));
}

function openProcess(assist: AssistAgentRef): void {
  const taskId = processTaskId(assist);
  if (!taskId) {
    showToast(t("assistNoTaskId"), "error");
    return;
  }
  delegation.value.openProcess({
    taskId,
    toAgentId: assist.agentId,
    toAgentName: displayName(assist),
    brief: assist.brief,
    toolCallId: assist.toolCallId || undefined,
    toAgentAvatarUrl: avatarUrl(assist),
  });
}
</script>

<template>
  <!-- Tab 触发：最多 N 个头像叠放 -->
  <div
    v-if="variant === 'trigger' && assists.length > 0"
    class="flex items-center"
    role="group"
    :aria-label="t('msgAssistAgents')"
  >
    <div class="flex items-center">
      <span
        v-for="(assist, index) in stacked"
        :key="assist.agentId"
        class="relative inline-flex rounded-full ring-2 ring-background"
        :class="[
          index > 0 ? '-ml-1.5' : '',
          isAssisting(assist) ? 'animate-pulse motion-reduce:animate-none' : '',
        ]"
        :style="{ zIndex: index + 1 }"
        :title="displayName(assist)"
      >
        <AgentAvatar
          :name="displayName(assist)"
          :avatar-url="avatarUrl(assist)"
          size="xs"
          round
        />
      </span>
      <span
        v-if="overflow > 0"
        class="bg-muted text-muted-foreground relative -ml-1.5 inline-flex size-5 items-center justify-center rounded-full text-[10px] font-medium ring-2 ring-background"
        :style="{ zIndex: stacked.length + 1 }"
      >
        +{{ overflow }}
      </span>
    </div>
  </div>

  <!-- Tab 面板：谁在协助 → 你发出的任务 / 对方的回复 → 过程 -->
  <div
    v-else-if="variant === 'panel' && assists.length > 0"
    class="flex flex-col gap-2"
    role="list"
    :aria-label="t('assistPanel')"
  >
    <article
      v-for="assist in assists"
      :key="assist.agentId"
      class="overflow-hidden rounded-xl border border-rule bg-background shadow-sm"
      role="listitem"
    >
      <!-- 身份层：协助方是谁 + 已执行多久 -->
      <header class="flex min-w-0 items-center gap-2.5 px-3 py-2.5">
        <AgentAvatar
          :name="displayName(assist)"
          :avatar-url="avatarUrl(assist)"
          size="md"
          round
        />
        <div class="min-w-0 flex-1">
          <div class="flex min-w-0 flex-wrap items-center gap-2">
            <p class="mb-0 min-w-0 truncate text-sm font-semibold text-foreground">
              {{ displayName(assist) }}
            </p>
            <span
              class="inline-flex shrink-0 items-center rounded-md px-1.5 py-0.5 text-xs font-medium"
              :class="statusTone(assist)"
            >
              {{ statusLabel(assist) }}
            </span>
            <span
              v-if="elapsedByAgentId[assist.agentId]"
              class="shrink-0 text-xs tabular-nums text-muted-foreground"
              :aria-label="
                assist.status === 'running'
                  ? tf('assistElapsedRunningAria', {
                      duration: elapsedByAgentId[assist.agentId]!,
                    })
                  : tf('assistElapsedDoneAria', {
                      duration: elapsedByAgentId[assist.agentId]!,
                    })
              "
            >
              {{ elapsedByAgentId[assist.agentId] }}
            </span>
          </div>
          <p class="mb-0 text-xs text-muted-foreground">{{ t("assistLabel") }}</p>
        </div>
        <div class="flex shrink-0 items-center gap-1.5">
          <button
            v-if="canOpenProcess(assist)"
            type="button"
            class="inline-flex min-h-7 cursor-pointer items-center gap-1 rounded-lg px-2 text-xs font-medium text-foreground transition duration-200 hover:bg-paper-deep focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/30"
            :aria-label="tf('assistSeeProcessAria', { name: displayName(assist) })"
            :title="t('assistSeeProcessTitle')"
            @click="openProcess(assist)"
          >
            {{ t("assistSeeProcess") }}
            <ArrowRightIcon class="size-3.5 shrink-0" aria-hidden="true" />
          </button>
          <button
            type="button"
            class="inline-flex min-h-7 cursor-pointer items-center gap-1 rounded-lg px-2 text-xs font-medium text-foreground transition duration-200 hover:bg-paper-deep focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/30"
            :aria-label="tf('assistGoChatAria', { name: displayName(assist) })"
            :title="t('assistGoChatTitle')"
            @click="goToAgent(assist)"
          >
            {{ t("assistGoChat") }}
            <ArrowUpRightIcon class="size-3.5" aria-hidden="true" />
          </button>
          <button
            type="button"
            class="inline-flex size-7 cursor-pointer items-center justify-center rounded-lg text-muted-foreground transition duration-200 hover:bg-paper-deep hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/30"
            :aria-expanded="expandedId === assist.agentId"
            :aria-label="
              expandedId === assist.agentId
                ? tf('assistCollapse', { name: displayName(assist) })
                : tf('assistExpand', { name: displayName(assist) })
            "
            @click="toggle(assist)"
          >
            <ChevronDownIcon
              class="size-3.5 transition-transform duration-200 motion-reduce:transition-none"
              :class="expandedId === assist.agentId ? 'rotate-180' : ''"
              aria-hidden="true"
            />
          </button>
        </div>
      </header>

      <!-- 内容层：按归属分栏（你发出 / 对方回复） -->
      <div
        v-if="expandedId === assist.agentId"
        class="flex flex-col gap-2 border-t border-rule bg-paper px-3 py-2.5"
      >
        <section
          v-if="assist.brief"
          class="rounded-lg border border-rule border-l-4 border-l-primary bg-background px-2.5 py-2"
          :aria-label="t('assistYourTask')"
        >
          <p class="mb-1 text-xs font-medium tracking-wider text-primary">
            {{ t("assistYourTask") }}
          </p>
          <p class="mb-0 whitespace-pre-wrap break-words text-sm leading-relaxed text-foreground">
            {{ assist.brief }}
          </p>
        </section>

        <section
          class="rounded-lg border border-rule border-l-4 border-l-accent bg-background px-2.5 py-2"
          :aria-label="t('assistTheirReply')"
        >
          <p
            class="mb-1 text-xs font-medium tracking-wider"
            :class="assist.status === 'failed' ? 'text-destructive' : 'text-accent'"
          >
            {{ t("assistTheirReply") }}
          </p>
          <p
            v-if="assist.status === 'running'"
            class="mb-0 text-sm text-muted-foreground"
          >
            {{ t("assistRunning") }}
          </p>
          <!-- 异步派发：无同步回复，提示正在执行并可点开过程 -->
          <div
            v-else-if="assist.asyncDispatched"
            class="flex min-w-0 flex-col gap-2"
          >
            <p class="mb-0 text-sm text-muted-foreground">
              {{ t("assistAsyncRunning") }}
            </p>
            <button
              v-if="canOpenProcess(assist)"
              type="button"
              class="inline-flex min-h-7 w-fit cursor-pointer items-center gap-1 rounded-lg border border-rule bg-background px-2.5 text-xs font-medium text-foreground transition duration-200 hover:bg-paper-deep focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/30"
              :aria-label="tf('assistSeeProcessAria', { name: displayName(assist) })"
              @click="openProcess(assist)"
            >
              {{ t("assistSeeProcess") }}
              <ArrowRightIcon class="size-3.5 shrink-0" aria-hidden="true" />
            </button>
          </div>
          <p
            v-else-if="assist.reply"
            class="mb-0 whitespace-pre-wrap break-words text-sm leading-relaxed text-foreground"
          >
            {{ assist.reply }}
          </p>
          <p v-else class="mb-0 text-sm text-muted-foreground">{{ t("assistNoReply") }}</p>
        </section>
      </div>
    </article>
  </div>
</template>
