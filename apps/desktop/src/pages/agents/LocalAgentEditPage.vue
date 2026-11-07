<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";

import { useDesktop } from "../../app/desktop";
import AgentEditorForm from "../../shared/components/agent-editor/AgentEditorForm.vue";
import PageEditorHeader from "../../shared/components/PageEditorHeader.vue";
import UiFormSkeleton from "../../shared/components/UiFormSkeleton.vue";
import type { AgentEditorInitial, AgentEditorInput } from "../../shared/model/agent-editor/agent-editor";
import type { AgentCard } from "../../shared/model/runtime/runtime";
import { t } from "../../shared/model/ui/ui-locale";
import { useLocalAgents } from "./composables/useLocalAgents";

const FORM_ID = "local-agent-edit-form";

const route = useRoute();
const router = useRouter();
const { session, refresh } = useDesktop();
const local = useLocalAgents(session, refresh);
const localAgents = { name: "agents-local" as const };
const formCanSubmit = ref(false);

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

const submitLabel = computed(() =>
  local.saving.value ? t("agentsLocalSaving") : t("agentsLocalSave"),
);

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

function goBack(): void {
  if (window.history.length > 1) {
    router.back();
    return;
  }
  void router.replace(localAgents);
}
</script>

<template>
  <main class="flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-background">
    <!-- 编辑本机 Agent：顶栏与团队编辑统一 -->
    <PageEditorHeader :title="t('agentsLocalEditTitle')" @back="goBack">
      <template #actions>
        <button
          type="button"
          class="inline-flex min-h-8 items-center rounded-lg border border-rule bg-paper px-3 text-sm font-semibold text-foreground outline-none transition hover:bg-muted focus-visible:ring-2 focus-visible:ring-accent/40"
          :disabled="local.saving.value"
          @click="goBack"
        >
          {{ t("agentsLocalCancel") }}
        </button>
        <button
          type="submit"
          :form="FORM_ID"
          class="inline-flex min-h-8 items-center rounded-lg bg-accent px-3 text-sm font-semibold text-white outline-none transition hover:bg-accent-deep focus-visible:ring-2 focus-visible:ring-accent/40 disabled:opacity-45"
          :disabled="!formCanSubmit || local.saving.value || loading || Boolean(loadError)"
        >
          {{ submitLabel }}
        </button>
      </template>
    </PageEditorHeader>

    <div class="min-h-0 flex-1 overflow-auto">
      <div class="mx-auto w-full max-w-2xl px-4 py-5">
        <p class="m-0 mb-4 text-sm leading-snug text-muted-foreground">
          {{ t("agentsLocalEditDesc") }}
        </p>
        <UiFormSkeleton v-if="loading" />
        <p v-else-if="loadError" class="m-0 text-sm text-destructive">{{ loadError }}</p>
        <AgentEditorForm
          v-else-if="initial"
          :form-id="FORM_ID"
          hide-actions
          variant="local-edit"
          :busy="local.saving.value"
          :initial="initial"
          :local-agent-id="agentId"
          @update:can-submit="formCanSubmit = $event"
          @submit="onSubmit"
          @cancel="goBack"
        />
      </div>
    </div>
  </main>
</template>
