<script setup lang="ts">
import { onMounted } from "vue";

import { t } from "../../../../../shared/model/ui/ui-locale";
import { MCP_PLACEHOLDER, useUserMcp } from "../../../composables/useUserMcp";

const { text, loading, saving, load, commitField } = useUserMcp();

onMounted(() => void load());
</script>

<template>
  <main class="min-h-0 min-w-0 overflow-auto bg-background">
    <div class="mx-auto w-full max-w-5xl px-4 py-4 sm:px-5 sm:py-5">
      <!-- 页头 -->
      <header class="mb-4 border-b border-rule pb-4">
        <p class="m-0 text-xs font-medium tracking-wider text-accent">{{ t("assistantKicker") }}</p>
        <h1 class="mb-0 mt-2 text-lg font-semibold tracking-tight text-foreground">{{ t("mcpTitle") }}</h1>
        <p class="mb-0 mt-1.5 max-w-2xl text-sm leading-snug text-muted-foreground">
          {{ t("mcpLead") }}
        </p>
      </header>

      <!-- 工具配置 -->
      <section
        class="rounded-xl border border-rule bg-background p-3 shadow-sm sm:p-4"
        :aria-label="t('mcpAria')"
      >
        <label class="grid gap-1.5 text-sm font-medium text-foreground">
          {{ t("mcpConfig") }}
          <textarea
            v-model="text"
            :placeholder="MCP_PLACEHOLDER"
            :disabled="loading"
            rows="18"
            class="min-h-56 w-full resize-y rounded-lg border border-rule bg-paper px-3 py-2 font-mono text-xs leading-relaxed outline-none placeholder:text-muted-foreground/70 focus:border-accent focus:ring-2 focus:ring-accent/15 disabled:opacity-60"
            spellcheck="false"
            @blur="commitField"
          />
          <span class="font-normal text-xs text-muted-foreground">
            {{ t("mcpHint") }}
            <span v-if="saving" class="text-foreground">{{ t("saving") }}</span>
          </span>
        </label>
      </section>
    </div>
  </main>
</template>
