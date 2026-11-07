<script setup lang="ts">
import { CircleAlertIcon } from "@lucide/vue";
import { computed, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";

import { useDesktop } from "../../app/desktop";
import AgentEditorForm from "../../shared/components/agent-editor/AgentEditorForm.vue";
import AppDialog from "../../shared/components/AppDialog.vue";
import PageEditorHeader from "../../shared/components/PageEditorHeader.vue";
import UiFormSkeleton from "../../shared/components/UiFormSkeleton.vue";
import type { AgentEditorInput } from "../../shared/model/agent-editor/agent-editor";
import { t, tf } from "../../shared/model/ui/ui-locale";
import { useAgentPublish } from "./composables/useAgentPublish";

const FORM_ID = "publish-agent-form";

const route = useRoute();
const router = useRouter();
const { session, refresh } = useDesktop();
const formCanSubmit = ref(false);

const agentId = computed(() => {
  const raw = route.params.agentId;
  return typeof raw === "string" && raw.length > 0 ? raw : "";
});
const isUpdate = computed(() => Boolean(agentId.value));

const publisher = useAgentPublish(session, refresh, agentId);
const ownedAgents = { name: "agents-owned" as const };
const errorDialogOpen = ref(false);
const hasErrorDetails = computed(() => publisher.errorDetails.value.length > 0);

const submitLabel = computed(() => {
  if (publisher.publishing.value) return t("publishPublishing");
  return isUpdate.value ? t("publishUpdateAction") : t("publishNewTitle");
});

watch(
  () => publisher.published.value,
  (published) => {
    if (published) void router.push(ownedAgents);
  },
);

watch(
  () => publisher.errorDetails.value,
  (details) => {
    if (details.length) errorDialogOpen.value = true;
  },
);

function onSubmit(input: AgentEditorInput): void {
  void publisher.submit(input);
}

function goBack(): void {
  if (window.history.length > 1) {
    router.back();
    return;
  }
  void router.replace(ownedAgents);
}
</script>

<template>
  <main class="flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-background">
    <!-- 发布 / 更新 Agent：顶栏与团队编辑统一 -->
    <PageEditorHeader
      :title="isUpdate ? t('publishUpdateTitle') : t('publishNewTitle')"
      @back="goBack"
    >
      <template #actions>
        <button
          type="button"
          class="inline-flex min-h-8 items-center rounded-lg border border-rule bg-paper px-3 text-sm font-semibold text-foreground outline-none transition hover:bg-muted focus-visible:ring-2 focus-visible:ring-accent/40"
          :disabled="publisher.publishing.value"
          @click="goBack"
        >
          {{ t("agentsLocalCancel") }}
        </button>
        <button
          type="submit"
          :form="FORM_ID"
          class="inline-flex min-h-8 items-center rounded-lg bg-accent px-3 text-sm font-semibold text-white outline-none transition hover:bg-accent-deep focus-visible:ring-2 focus-visible:ring-accent/40 disabled:opacity-45"
          :disabled="!formCanSubmit || publisher.publishing.value || publisher.loading.value"
        >
          {{ submitLabel }}
        </button>
      </template>
    </PageEditorHeader>

    <div class="min-h-0 flex-1 overflow-auto">
      <div class="mx-auto w-full max-w-2xl px-4 py-5">
        <p class="m-0 mb-4 text-sm leading-snug text-muted-foreground">
          {{ isUpdate ? t("publishUpdateLead") : t("publishLead") }}
        </p>

        <UiFormSkeleton v-if="publisher.loading.value" />

        <template v-else-if="publisher.initial.value">
          <button
            v-if="hasErrorDetails"
            type="button"
            class="mb-4 flex w-full items-start gap-2 rounded-lg border border-destructive/20 bg-danger-soft px-3 py-2.5 text-left text-sm text-destructive transition duration-200 hover:border-destructive/40"
            @click="errorDialogOpen = true"
          >
            <CircleAlertIcon class="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <span class="min-w-0 font-semibold underline underline-offset-4">
              {{ tf("publishErrorCount", { n: publisher.errorDetails.value.length }) }}
            </span>
          </button>

          <AgentEditorForm
            :form-id="FORM_ID"
            hide-actions
            :busy="publisher.publishing.value"
            :variant="isUpdate ? 'publish-edit' : 'publish-create'"
            :initial="publisher.initial.value"
            :published-agent-id="agentId"
            @update:can-submit="formCanSubmit = $event"
            @submit="onSubmit"
            @cancel="goBack"
          />
        </template>
      </div>
    </div>

    <AppDialog
      :open="errorDialogOpen"
      :title="t('publishValidateFailTitle')"
      :description="t('publishValidateFailBody')"
      @update:open="errorDialogOpen = $event"
    >
      <ol class="m-0 grid list-none gap-2 p-0">
        <li
          v-for="(detail, index) in publisher.errorDetails.value"
          :key="`${detail.path}-${detail.message}-${index}`"
          class="rounded-lg border border-rule bg-paper p-3"
        >
          <code class="break-all text-xs font-semibold text-destructive">{{ detail.path }}</code>
          <p class="mb-0 mt-1.5 text-sm leading-snug text-foreground">{{ detail.message }}</p>
        </li>
      </ol>
    </AppDialog>
  </main>
</template>
