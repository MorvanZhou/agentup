<script setup lang="ts">
import { CircleDotIcon, ListTreeIcon } from "@lucide/vue";
import { computed, onBeforeUnmount, ref } from "vue";

import AgentAvatar from "../../../../shared/components/avatar/AgentAvatar.vue";
import { showToast } from "../../../../shared/model/ui/toast";
import { t, tf } from "../../../../shared/model/ui/ui-locale";
import {
  delegationBannerLines,
  type DelegationBannerLine,
  type IncomingDelegation,
} from "../../model/sidebar/delegation-presence";
import { injectThreadAgentId } from "../../model/thread/thread-agent-id";
import { injectThreadDelegation } from "../../model/thread/thread-delegation";
import { injectThreadExtras } from "../../model/thread/thread-extras";
import { injectThreadRoster, resolveRosterAgent } from "../../model/thread/thread-roster";

const props = defineProps<{
  tasks: IncomingDelegation[];
}>();

const roster = injectThreadRoster();
const delegation = injectThreadDelegation();
const selfId = injectThreadAgentId();
const extras = injectThreadExtras();
const selfName = computed(() => extras.value.remark.trim() || extras.value.name.trim());
const now = ref(Date.now());
const timer = setInterval(() => {
  now.value = Date.now();
}, 30_000);
onBeforeUnmount(() => clearInterval(timer));

const lines = computed(() =>
  delegationBannerLines({
    tasks: props.tasks,
    now: now.value,
    resolveName(agentId) {
      const found = roster.value.agents.find((agent) => agent.agentId === agentId);
      if (!found) return "";
      return found.remark || found.name;
    },
  }),
);

function fromLabel(name: string): string {
  return name ? tf("delegationBannerFrom", { name }) : t("delegationBannerFromGeneric");
}

function openLabel(name: string): string {
  return name ? tf("delegationBannerOpen", { name }) : t("delegationBannerOpenGeneric");
}

function parentAvatar(agentId: string): string | undefined {
  return resolveRosterAgent(roster.value, agentId).avatarUrl;
}

function detailsAria(): string {
  return selfName.value
    ? tf("assistSeeProcessAria", { name: selfName.value })
    : t("assistSeeProcessTitle");
}

function openDetails(line: DelegationBannerLine): void {
  delegation.value.openProcess({
    taskId: line.id,
    toAgentId: selfId,
    toAgentName: selfName.value || t("assistLabel"),
    brief: line.brief,
    toAgentAvatarUrl: extras.value.avatarUrl,
  });
}

function openParent(fromAgentId: string): void {
  const result = roster.value.openAgent(fromAgentId);
  if (result === "dismissed") showToast(t("assistDismissed"), "error");
}
</script>

<template>
  <!-- 专家直聊：别人派来的活。不进历史，任务结束前不收起。 -->
  <div
    v-if="lines.length > 0"
    class="shrink-0 border-b border-rule bg-paper px-3 py-1.5"
    role="region"
    :aria-label="t('delegationBannerAria')"
  >
    <ul class="flex flex-col gap-1.5">
      <li v-for="line in lines" :key="line.id" class="flex min-w-0 items-center gap-3">
        <div class="min-w-0 flex-1">
          <p class="mb-0 flex min-w-0 items-center gap-1.5 text-xs leading-5">
            <CircleDotIcon class="size-3.5 shrink-0 text-accent" aria-hidden="true" />
            <span class="truncate font-medium text-foreground">{{ fromLabel(line.fromName) }}</span>
            <span class="shrink-0 text-muted-foreground" aria-hidden="true">·</span>
            <span class="shrink-0 text-muted-foreground">{{ line.elapsed }}</span>
          </p>
          <p
            class="mb-0 truncate pl-5 text-xs leading-5 text-muted-foreground"
            :title="line.brief || undefined"
          >
            {{ line.brief || t("fleetNoBrief") }}
          </p>
        </div>
        <div class="flex shrink-0 items-center gap-1">
          <button
            type="button"
            class="inline-flex min-h-8 cursor-pointer items-center gap-1 rounded-lg px-2 text-xs font-medium text-foreground transition duration-200 hover:bg-paper-deep focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/30"
            :aria-label="detailsAria()"
            :title="t('assistSeeProcessTitle')"
            @click="openDetails(line)"
          >
            {{ t("assistSeeProcess") }}
            <ListTreeIcon class="size-3.5 shrink-0" aria-hidden="true" />
          </button>
          <button
            type="button"
            class="inline-flex min-h-8 cursor-pointer items-center gap-1.5 rounded-lg px-2 text-xs font-medium text-accent transition duration-200 hover:bg-accent/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/30"
            :aria-label="openLabel(line.fromName)"
            @click="openParent(line.fromAgentId)"
          >
            <span aria-hidden="true" class="inline-flex">
              <AgentAvatar
                :name="line.fromName || t('delegationBannerOpenGeneric')"
                :avatar-url="parentAvatar(line.fromAgentId)"
                size="xs"
                round
              />
            </span>
            {{ openLabel(line.fromName) }}
          </button>
        </div>
      </li>
    </ul>
  </div>
</template>
