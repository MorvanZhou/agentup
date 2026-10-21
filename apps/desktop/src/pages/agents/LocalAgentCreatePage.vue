<script setup lang="ts">
import { ArrowLeftIcon } from "@lucide/vue";
import { RouterLink, useRouter } from "vue-router";

import { useDesktop } from "../../app/desktop";
import AgentEditorForm from "../../shared/components/agent-editor/AgentEditorForm.vue";
import type { AgentEditorInput } from "../../shared/model/agent-editor";
import { t } from "../../shared/model/ui-locale";
import { useLocalAgents } from "./composables/useLocalAgents";

const router = useRouter();
const { session, refresh } = useDesktop();
const local = useLocalAgents(session, refresh);
const localAgents = { name: "agents-local" as const };

async function onSubmit(input: AgentEditorInput): Promise<void> {
  const card = await local.create(input);
  if (card) local.openChat(card);
}

function onCancel(): void {
  void router.push(localAgents);
}
</script>

<template>
  <main class="h-full min-h-0 overflow-auto bg-background">
    <!-- 新建本机 Agent 配置页 -->
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
          {{ t("agentsLocalCreateTitle") }}
        </h1>
        <p class="mb-0 mt-1.5 max-w-2xl text-sm leading-snug text-muted-foreground">
          {{ t("agentsLocalCreateDesc") }}
        </p>
      </header>

      <AgentEditorForm
        variant="local-create"
        :busy="local.creating.value"
        @submit="onSubmit"
        @cancel="onCancel"
      />
    </div>
  </main>
</template>
