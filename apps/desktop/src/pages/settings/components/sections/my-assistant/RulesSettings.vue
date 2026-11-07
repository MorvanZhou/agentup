<script setup lang="ts">
import { onMounted } from "vue";

import { clampUtf8, RULES_MAX_BYTES, RULES_MAX_CHARS } from "../../../../../shared/model/input-limits";
import { t } from "../../../../../shared/model/ui/ui-locale";
import { useUserAgentsMd } from "../../../composables/useUserAgentsMd";

const { text, loading, saving, load, commitField } = useUserAgentsMd();

// 规则按 UTF-8 字节封顶；maxlength 只数字符，中文会先顶满字节。
function onRulesInput(event: Event): void {
  text.value = clampUtf8((event.target as HTMLTextAreaElement).value, RULES_MAX_BYTES);
}

onMounted(() => void load());
</script>

<template>
  <main class="min-h-0 min-w-0 overflow-auto bg-background">
    <div class="mx-auto w-full max-w-5xl px-4 py-4 sm:px-5 sm:py-5">
      <!-- 页头 -->
      <header class="mb-4 border-b border-rule pb-4">
        <p class="m-0 text-xs font-medium tracking-wider text-accent">{{ t("assistantKicker") }}</p>
        <h1 class="mb-0 mt-2 text-lg font-semibold tracking-tight text-foreground">{{ t("rulesTitle") }}</h1>
        <p class="mb-0 mt-1.5 max-w-2xl text-sm leading-snug text-muted-foreground">
          {{ t("rulesLead") }}
        </p>
      </header>

      <!-- 规则编辑 -->
      <section
        class="rounded-xl border border-rule bg-background p-3 shadow-sm sm:p-4"
        :aria-label="t('rulesTitle')"
      >
        <label class="grid gap-1.5 text-sm font-medium text-foreground">
          {{ t("rulesContent") }}
          <textarea
            :value="text"
            :placeholder="t('rulesPlaceholder')"
            :disabled="loading"
            :maxlength="RULES_MAX_CHARS"
            rows="18"
            class="min-h-56 w-full resize-y rounded-lg border border-rule bg-paper px-3 py-2 font-mono text-xs leading-relaxed outline-none placeholder:text-muted-foreground/70 focus:border-accent focus:ring-2 focus:ring-accent/15 disabled:opacity-60"
            spellcheck="false"
            @input="onRulesInput"
            @blur="commitField"
          />
          <span class="font-normal text-xs text-muted-foreground">
            {{ t("rulesHint") }}
            <span v-if="saving" class="text-foreground">{{ t("saving") }}</span>
          </span>
        </label>
      </section>
    </div>
  </main>
</template>
