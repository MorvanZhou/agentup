<script setup lang="ts">
import { ArrowLeftIcon } from "@lucide/vue";
import { computed, watch } from "vue";
import { RouterLink, useRoute, useRouter } from "vue-router";

import { useDesktop } from "../../app/desktop";
import { t } from "../../shared/model/ui-locale";
import PublishAgentPanel from "./components/PublishAgentPanel.vue";
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

const ownedAgents = { name: "agents" as const, query: { tab: "owned" } };

watch(
  () => publisher.published.value,
  (published) => {
    if (published) void router.push(ownedAgents);
  },
);
</script>

<template>
  <main class="h-full min-h-0 overflow-auto bg-background">
    <!-- 发布编辑页 -->
    <div class="mx-auto w-full max-w-5xl px-4 py-4 sm:px-5 sm:py-6">
      <!-- 页头 -->
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
          {{ t("publishLead") }}
        </p>
      </header>
      <PublishAgentPanel
        :name="publisher.name.value"
        :role="publisher.role.value"
        :summary="publisher.summary.value"
        :update-agent-id="publisher.updateAgentId.value"
        :selected-directory="publisher.selectedDirectory.value"
        :preview="publisher.preview.value"
        :publishing="publisher.publishing.value"
        :error-details="publisher.errorDetails.value"
        @update:name="publisher.name.value = $event"
        @update:role="publisher.role.value = $event"
        @update:summary="publisher.summary.value = $event"
        @choose="publisher.chooseDirectory"
        @publish="publisher.publish"
      />
    </div>
  </main>
</template>
