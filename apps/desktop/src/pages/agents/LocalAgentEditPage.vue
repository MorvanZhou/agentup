<script setup lang="ts">
import { ArrowLeftIcon } from "@lucide/vue";
import { computed, onMounted, ref } from "vue";
import { RouterLink, useRoute, useRouter } from "vue-router";

import { useDesktop } from "../../app/desktop";
import AgentEditorForm from "../../shared/components/agent-editor/AgentEditorForm.vue";
import UiFormSkeleton from "../../shared/components/UiFormSkeleton.vue";
import type { AgentEditorInitial, AgentEditorInput } from "../../shared/model/agent-editor";
import type { AgentCard } from "../../shared/model/runtime";
import { t } from "../../shared/model/ui-locale";
import { useLocalAgents } from "./composables/useLocalAgents";

const route = useRoute();
const router = useRouter();
const { session, refresh } = useDesktop();
const local = useLocalAgents(session, refresh);
const localAgents = { name: "agents-local" as const };

const agentId = computed(() => {
  const raw = route.params.agentId;
  return typeof raw === "string" ? raw : "";
});

const loading = ref(true);
const card = ref<AgentCard | null>(null);
const loadError = ref("");

const initial = computed((): AgentEditorInitial | null => {
  if (!card.value) return null;
  return {
    name: card.value.name,
    role: card.value.role,
    background: card.value.background,
    rules: card.value.rules,
    skills: card.value.skills,
    mcpServers: card.value.mcpServers,
    avatarUrl: card.value.avatarUrl,
  };
});

onMounted(async () => {
  if (!agentId.value) {
    loadError.value = t("agentsLocalNotFound");
    loading.value = false;
    return;
  }
  const next = await local.load(agentId.value);
  if (!next) {
    loadError.value = t("agentsLocalNotFound");
  } else {
    card.value = next;
  }
  loading.value = false;
});

async function onSubmit(input: AgentEditorInput): Promise<void> {
  if (!agentId.value) return;
  const updated = await local.update(agentId.value, input);
  if (updated) void router.push(localAgents);
}

function onCancel(): void {
  void router.push(localAgents);
}
</script>

<template>
  <main class="h-full min-h-0 overflow-auto bg-background">
    <!-- 编辑本机 Agent 配置页 -->
    <div class="mx-auto w-full max-w-2xl px-4 py-4 sm:px-5 sm:py-6">
      <header class="mb-5 border-b border-rule pb-5">
        <RouterLink
          class="inline-flex min-h-7 cursor-pointer items-center gap-1.5 text-sm font-medium text-muted-foreground no-underline transition duration-200 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
          :to="localAgents"
        >
          <ArrowLeftIcon class="size-3.5 shrink-0" aria-hidden="true" />
          {{ t("agentsLocalBack") }}
        </RouterLink>
        <h1 class="mb-0 mt-1 text-lg font-semibold tracking-tight text-foreground">
          {{ t("agentsLocalEditTitle") }}
        </h1>
        <p class="mb-0 mt-1.5 max-w-2xl text-sm leading-snug text-muted-foreground">
          {{ t("agentsLocalEditDesc") }}
        </p>
      </header>

      <UiFormSkeleton v-if="loading" />
      <p v-else-if="loadError" class="m-0 text-sm text-destructive">{{ loadError }}</p>
      <AgentEditorForm
        v-else-if="initial"
        variant="local-edit"
        :busy="local.saving.value"
        :initial="initial"
        :local-agent-id="agentId"
        @submit="onSubmit"
        @cancel="onCancel"
      />
    </div>
  </main>
</template>
