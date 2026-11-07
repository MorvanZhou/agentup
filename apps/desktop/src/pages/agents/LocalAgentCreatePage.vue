<script setup lang="ts">
import { computed, ref } from "vue";
import { useRouter } from "vue-router";

import { useDesktop } from "../../app/desktop";
import AgentEditorForm from "../../shared/components/agent-editor/AgentEditorForm.vue";
import PageEditorHeader from "../../shared/components/PageEditorHeader.vue";
import type { AgentEditorInput } from "../../shared/model/agent-editor/agent-editor";
import { t } from "../../shared/model/ui/ui-locale";
import { useLocalAgents } from "./composables/useLocalAgents";

const FORM_ID = "local-agent-create-form";

const router = useRouter();
const { session, refresh } = useDesktop();
const local = useLocalAgents(session, refresh);
const localAgents = { name: "agents-local" as const };
const formCanSubmit = ref(false);

const submitLabel = computed(() =>
  local.creating.value ? t("agentsLocalCreating") : t("agentsLocalCreate"),
);

async function onSubmit(input: AgentEditorInput): Promise<void> {
  const card = await local.create(input);
  if (card) local.openChat(card);
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
    <!-- 新建本机 Agent：顶栏与团队编辑统一 -->
    <PageEditorHeader :title="t('agentsLocalCreateTitle')" @back="goBack">
      <template #actions>
        <button
          type="button"
          class="inline-flex min-h-8 items-center rounded-lg border border-rule bg-paper px-3 text-sm font-semibold text-foreground outline-none transition hover:bg-muted focus-visible:ring-2 focus-visible:ring-accent/40"
          :disabled="local.creating.value"
          @click="goBack"
        >
          {{ t("agentsLocalCancel") }}
        </button>
        <button
          type="submit"
          :form="FORM_ID"
          class="inline-flex min-h-8 items-center rounded-lg bg-accent px-3 text-sm font-semibold text-white outline-none transition hover:bg-accent-deep focus-visible:ring-2 focus-visible:ring-accent/40 disabled:opacity-45"
          :disabled="!formCanSubmit || local.creating.value"
        >
          {{ submitLabel }}
        </button>
      </template>
    </PageEditorHeader>

    <div class="min-h-0 flex-1 overflow-auto">
      <div class="mx-auto w-full max-w-2xl px-4 py-5">
        <p class="m-0 mb-4 text-sm leading-snug text-muted-foreground">
          {{ t("agentsLocalCreateDesc") }}
        </p>
        <AgentEditorForm
          :form-id="FORM_ID"
          hide-actions
          variant="local-create"
          :busy="local.creating.value"
          @update:can-submit="formCanSubmit = $event"
          @submit="onSubmit"
          @cancel="goBack"
        />
      </div>
    </div>
  </main>
</template>
