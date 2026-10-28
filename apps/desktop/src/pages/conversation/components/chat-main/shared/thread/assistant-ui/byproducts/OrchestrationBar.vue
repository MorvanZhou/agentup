<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from "vue";

import { DesktopApi } from "../../../../../../../../shared/api/runtime";
import type { BusyTurn } from "../../../../../../../../shared/api/runtime/chat";
import { showToast } from "../../../../../../../../shared/model/ui/toast";
import { t, tf } from "../../../../../../../../shared/model/ui/ui-locale";
import type { AsyncFleetItem } from "../../../../../../composables/useDelegationFleet";
import { delegationElapsedLabel } from "../../../../../../model/sidebar/delegation-presence";
import { injectThreadDelegation } from "../../../../../../model/thread/thread-delegation";
import {
  injectThreadRoster,
  resolveRosterAgent,
} from "../../../../../../model/thread/thread-roster";
import ProcessStrip, { type ProcessRow } from "../../../ProcessStrip.vue";

const props = defineProps<{
  items: AsyncFleetItem[];
  /** attention 里本会话的 busy turn；wake 时显性「正在整理」。 */
  busyTurn?: BusyTurn | null;
  token: string;
  userId: string;
}>();

const emit = defineEmits<{
  cancelled: [id: string];
  /** 停止主 agent 当前编排回合（含 wake）。 */
  "stop-turn": [];
}>();

const roster = injectThreadRoster();
const delegation = injectThreadDelegation();
const api = new DesktopApi();
const expanded = ref(false);
const cancellingId = ref<string | null>(null);
const now = ref(Date.now());
const elapsedTimer = setInterval(() => {
  now.value = Date.now();
}, 30_000);
onBeforeUnmount(() => clearInterval(elapsedTimer));

const isWake = computed(() => props.busyTurn?.phase === "wake");
const wakeSources = computed(() => props.busyTurn?.sources ?? []);
const visible = computed(
  () => props.items.length > 0 || isWake.value,
);

const headline = computed(() => {
  if (isWake.value) {
    const names = wakeSources.value.map((s) => s.name).filter(Boolean);
    if (names.length === 1) return tf("orchSynthesizingOne", { name: names[0]! });
    if (names.length > 1) return tf("orchSynthesizingMany", { count: names.length });
    return t("orchSynthesizing");
  }
  if (props.items.length > 0) {
    return tf("fleetRunning", { count: props.items.length });
  }
  return t("orchWorking");
});

const preview = computed(() => {
  if (isWake.value && wakeSources.value.length > 0) {
    return wakeSources.value.slice(0, 3).map((source, index) => ({
      key: `wake-${source.agentId || source.name}-${index}`,
      kind: source.kind === "background" ? ("background" as const) : ("delegation" as const),
      name: source.name,
      agentId: source.agentId || "",
    }));
  }
  return props.items.slice(0, 3).map((item) => ({
    key: `${item.kind}-${item.id}`,
    kind: item.kind,
    name: displayName(item),
    agentId: item.toAgentId || "",
    item,
  }));
});

const overflow = computed(() => {
  if (isWake.value) return Math.max(0, wakeSources.value.length - 3);
  return Math.max(0, props.items.length - 3);
});

const stripChips = computed(() =>
  preview.value.map((chip) => ({
    key: chip.key,
    kind: chip.kind,
    name: chip.name,
    avatarUrl: avatarUrlFor(chip.agentId, chip.name),
  })),
);

const stripRows = computed<ProcessRow[]>(() =>
  props.items.map((item) => ({
    key: `${item.kind}-${item.id}`,
    kind: item.kind,
    name: displayName(item),
    avatarUrl: avatarUrl(item),
    elapsed: elapsedLabel(item),
    kindLabel: kindLabel(item),
    subtitle: shortSubtitle(item),
    cancelling: cancellingId.value === item.id,
    canOpen: item.kind === "delegation",
    canCancel: true,
  })),
);

function rowItem(key: string): AsyncFleetItem | undefined {
  return props.items.find((item) => `${item.kind}-${item.id}` === key);
}

function openRow(key: string): void {
  const item = rowItem(key);
  if (item) openProcess(item);
}

function cancelRow(key: string): void {
  const item = rowItem(key);
  if (item) void cancelTask(item);
}

function displayName(item: AsyncFleetItem): string {
  if (item.kind === "background") return item.title;
  const agentId = item.toAgentId || "";
  const agent = resolveRosterAgent(roster.value, agentId, item.toAgentName || item.title);
  return agent.remark || agent.name || item.toAgentName || item.title;
}

function avatarUrlFor(agentId: string, nameHint: string): string | undefined {
  if (!agentId) return undefined;
  return resolveRosterAgent(roster.value, agentId, nameHint).avatarUrl;
}

function avatarUrl(item: AsyncFleetItem): string | undefined {
  if (item.kind === "background") return undefined;
  return avatarUrlFor(item.toAgentId || "", item.toAgentName || item.title);
}

function shortSubtitle(item: AsyncFleetItem): string {
  const text = (item.subtitle || "").trim();
  if (!text) return item.kind === "background" ? t("fleetNoCommand") : t("fleetNoBrief");
  return text.length > 64 ? `${text.slice(0, 63)}…` : text;
}

function kindLabel(item: AsyncFleetItem): string {
  return item.kind === "background" ? t("fleetKindBackground") : t("fleetKindDelegation");
}

function elapsedLabel(item: AsyncFleetItem): string {
  return delegationElapsedLabel(item.createdAt, now.value);
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
  <ProcessStrip
    v-if="visible"
    :headline="headline"
    :chips="stripChips"
    :overflow="overflow"
    :rows="stripRows"
    :expanded="expanded"
    :wake="isWake"
    :ariaLabel="isWake ? t('orchAria') : t('fleetAria')"
    :show-stop="isWake"
    @toggle="expanded = !expanded"
    @stop="emit('stop-turn')"
    @open="openRow"
    @cancel="cancelRow"
  />
</template>
