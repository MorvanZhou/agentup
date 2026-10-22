<script setup lang="ts">
import {
  ChevronDownIcon,
  ListTreeIcon,
  LoaderCircleIcon,
  SquareIcon,
  TerminalIcon,
} from "@lucide/vue";
import { computed, ref } from "vue";

import { DesktopApi } from "../../../../../../../shared/api/runtime";
import AgentAvatar from "../../../../../../../shared/components/AgentAvatar.vue";
import { showToast } from "../../../../../../../shared/model/toast";
import { t, tf } from "../../../../../../../shared/model/ui-locale";
import type { AsyncFleetItem } from "../../../../../composables/useDelegationFleet";
import { injectThreadDelegation } from "../../../../../model/thread/thread-delegation";
import {
  injectThreadRoster,
  resolveRosterAgent,
} from "../../../../../model/thread/thread-roster";

const props = defineProps<{
  items: AsyncFleetItem[];
  token: string;
  userId: string;
}>();

const emit = defineEmits<{
  cancelled: [id: string];
}>();

const roster = injectThreadRoster();
const delegation = injectThreadDelegation();
const api = new DesktopApi();
const expanded = ref(false);
const cancellingId = ref<string | null>(null);

const visible = computed(() => props.items.length > 0);
const preview = computed(() => props.items.slice(0, 3));
const overflow = computed(() => Math.max(0, props.items.length - 3));

function displayName(item: AsyncFleetItem): string {
  if (item.kind === "background") return item.title;
  const agentId = item.toAgentId || "";
  const agent = resolveRosterAgent(roster.value, agentId, item.toAgentName || item.title);
  return agent.remark || agent.name || item.toAgentName || item.title;
}

function avatarUrl(item: AsyncFleetItem): string | undefined {
  if (item.kind === "background") return undefined;
  return resolveRosterAgent(roster.value, item.toAgentId || "", item.toAgentName).avatarUrl;
}

function shortSubtitle(item: AsyncFleetItem): string {
  const text = (item.subtitle || "").trim();
  if (!text) return item.kind === "background" ? t("fleetNoCommand") : t("fleetNoBrief");
  return text.length > 64 ? `${text.slice(0, 63)}…` : text;
}

function kindLabel(item: AsyncFleetItem): string {
  return item.kind === "background" ? t("fleetKindBackground") : t("fleetKindDelegation");
}

function openProcess(item: AsyncFleetItem): void {
  if (item.kind !== "delegation") return;
  delegation.value.openProcess({
    taskId: item.id,
    toAgentId: item.toAgentId || "",
    toAgentName: displayName(item),
    brief: item.brief || item.subtitle,
    toAgentAvatarUrl: avatarUrl(item),
  });
}

async function cancelTask(item: AsyncFleetItem): Promise<void> {
  if (cancellingId.value) return;
  cancellingId.value = item.id;
  try {
    if (item.kind === "background") {
      await api.cancelBackgroundJob(props.token, props.userId, item.id);
      showToast(tf("fleetBgCancelled", { name: displayName(item) }), "success");
    } else {
      await api.cancelDelegation(props.token, props.userId, item.id);
      showToast(tf("fleetCancelled", { name: displayName(item) }), "success");
    }
    emit("cancelled", item.id);
  } catch (error) {
    showToast(
      error instanceof Error && error.message ? error.message : t("fleetCancelFailed"),
      "error",
    );
  } finally {
    cancellingId.value = null;
  }
}
</script>

<template>
  <div
    v-if="visible"
    class="shrink-0 border-b border-rule bg-paper-deep/60 px-3 py-1.5"
    role="region"
    :aria-label="t('fleetAria')"
  >
    <div class="flex min-w-0 items-center gap-2">
      <LoaderCircleIcon
        class="size-3.5 shrink-0 animate-spin text-accent motion-reduce:animate-none"
        aria-hidden="true"
      />
      <p class="mb-0 min-w-0 flex-1 truncate text-xs text-muted-foreground">
        {{ tf("fleetRunning", { count: items.length }) }}
      </p>
      <div class="flex items-center">
        <span
          v-for="(item, index) in preview"
          :key="`${item.kind}-${item.id}`"
          class="relative inline-flex rounded-full ring-2 ring-paper-deep"
          :class="index > 0 ? '-ml-1.5' : ''"
          :style="{ zIndex: index + 1 }"
          :title="displayName(item)"
        >
          <span
            v-if="item.kind === 'background'"
            class="inline-flex size-5 items-center justify-center rounded-full bg-paper text-muted-foreground"
          >
            <TerminalIcon class="size-3" aria-hidden="true" />
          </span>
          <AgentAvatar
            v-else
            :name="displayName(item)"
            :avatar-url="avatarUrl(item)"
            size="xs"
            round
          />
        </span>
        <span
          v-if="overflow > 0"
          class="bg-muted text-muted-foreground relative -ml-1.5 inline-flex size-5 items-center justify-center rounded-full text-[10px] font-medium ring-2 ring-paper-deep"
          :style="{ zIndex: preview.length + 1 }"
        >
          +{{ overflow }}
        </span>
      </div>
      <button
        type="button"
        class="inline-flex size-7 cursor-pointer items-center justify-center rounded-lg text-muted-foreground transition duration-200 hover:bg-paper hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/30"
        :aria-expanded="expanded"
        :aria-label="expanded ? t('fleetCollapse') : t('fleetExpand')"
        @click="expanded = !expanded"
      >
        <ChevronDownIcon
          class="size-3.5 transition-transform duration-200 motion-reduce:transition-none"
          :class="expanded ? 'rotate-180' : ''"
          aria-hidden="true"
        />
      </button>
    </div>

    <ul v-if="expanded" class="mt-1.5 flex flex-col gap-1" role="list">
      <li
        v-for="item in items"
        :key="`${item.kind}-${item.id}`"
        class="flex min-w-0 items-center gap-2 rounded-lg border border-rule bg-background px-2 py-1.5"
      >
        <span
          v-if="item.kind === 'background'"
          class="inline-flex size-5 shrink-0 items-center justify-center rounded-full bg-paper-deep text-muted-foreground"
        >
          <TerminalIcon class="size-3" aria-hidden="true" />
        </span>
        <AgentAvatar
          v-else
          :name="displayName(item)"
          :avatar-url="avatarUrl(item)"
          size="xs"
          round
        />
        <div class="min-w-0 flex-1">
          <div class="flex min-w-0 items-center gap-1.5">
            <p class="mb-0 truncate text-xs font-medium text-foreground">
              {{ displayName(item) }}
            </p>
            <span class="shrink-0 rounded-md bg-paper-deep px-1 py-0.5 text-[10px] text-muted-foreground">
              {{ kindLabel(item) }}
            </span>
          </div>
          <p class="mb-0 truncate text-[11px] text-muted-foreground">
            {{ shortSubtitle(item) }}
          </p>
        </div>
        <button
          v-if="item.kind === 'delegation'"
          type="button"
          class="inline-flex min-h-7 cursor-pointer items-center gap-1 rounded-lg px-2 text-xs font-medium text-foreground transition duration-200 hover:bg-paper-deep focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/30"
          :aria-label="tf('assistSeeProcessAria', { name: displayName(item) })"
          @click="openProcess(item)"
        >
          {{ t("assistSeeProcess") }}
          <ListTreeIcon class="size-3.5 shrink-0" aria-hidden="true" />
        </button>
        <button
          type="button"
          class="inline-flex min-h-7 cursor-pointer items-center gap-1 rounded-lg px-2 text-xs font-medium text-destructive transition duration-200 hover:bg-danger-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/30 disabled:opacity-50"
          :disabled="cancellingId === item.id"
          :aria-label="tf('fleetCancelAria', { name: displayName(item) })"
          :title="t('fleetCancel')"
          @click="cancelTask(item)"
        >
          <SquareIcon class="size-3.5 shrink-0 fill-current" aria-hidden="true" />
          {{ cancellingId === item.id ? t("fleetCancelling") : t("fleetCancel") }}
        </button>
      </li>
    </ul>
  </div>
</template>
