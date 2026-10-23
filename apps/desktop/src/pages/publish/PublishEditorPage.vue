<script setup lang="ts">
import { ArrowLeftIcon, CircleAlertIcon } from "@lucide/vue";
import { computed, ref, watch } from "vue";
import { RouterLink, useRoute, useRouter } from "vue-router";

import { useDesktop } from "../../app/desktop";
import AgentEditorForm from "../../shared/components/agent-editor/AgentEditorForm.vue";
import AppDialog from "../../shared/components/AppDialog.vue";
import UiFormSkeleton from "../../shared/components/UiFormSkeleton.vue";
import type { AgentEditorInput } from "../../shared/model/agent-editor";
import { t, tf } from "../../shared/model/ui-locale";
import { useAgentPublish } from "./composables/useAgentPublish";

const route = useRoute();
const router = useRouter();
const { session, refresh } = useDesktop();

const agentId = computed(() => {
  const raw = route.params.agentId;
  return typeof raw === "string" && raw.length > 0 ? raw : "";
});
const isUpdate = computed(() => Boolean(agentId.value));

const publisher = useAgentPublish(session, refresh, agentId);
const ownedAgents = { name: "agents-owned" as const };
const errorDialogOpen = ref(false);
const hasErrorDetails = computed(() => publisher.errorDetails.value.length > 0);

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

function onCancel(): void {
  void router.push(ownedAgents);
}
</script>

<template>
  <main class="h-full min-h-0 overflow-auto bg-background">
    <!-- 发布 / 更新编辑页（与本机 Agent 表单同构） -->
    <div class="mx-auto w-full max-w-2xl px-4 py-4 sm:px-5 sm:py-6">
      <header class="mb-5 border-b border-rule pb-5">
        <RouterLink
          class="inline-flex min-h-7 cursor-pointer items-center gap-1.5 text-sm font-medium text-muted-foreground no-underline transition duration-200 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
          :to="ownedAgents"
        >
          <ArrowLeftIcon class="size-3.5 shrink-0" aria-hidden="true" />
          {{ t("publishBack") }}
        </RouterLink>
        <h1 class="mb-0 mt-1 text-lg font-semibold tracking-tight text-foreground">
          {{ isUpdate ? t("publishUpdateTitle") : t("publishNewTitle") }}
        </h1>
        <p class="mb-0 mt-1.5 max-w-2xl text-sm leading-snug text-muted-foreground">
          {{ isUpdate ? t("publishUpdateLead") : t("publishLead") }}
        </p>
      </header>

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
          :busy="publisher.publishing.value"
          :variant="isUpdate ? 'publish-edit' : 'publish-create'"
          :initial="publisher.initial.value"
          :published-agent-id="agentId"
          @submit="onSubmit"
          @cancel="onCancel"
        />
      </template>
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
