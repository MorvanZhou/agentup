<script setup lang="ts">
import { onMounted } from "vue";

import { t } from "../../../../../shared/model/ui/ui-locale";
import { MCP_PLACEHOLDER, useUserMcp } from "../../../composables/useUserMcp";
import SettingsSectionShell from "../../SettingsSectionShell.vue";

const { text, loading, saving, load, commitField } = useUserMcp();

onMounted(() => void load());
</script>

<template>
  <SettingsSectionShell wide :title="t('mcpTitle')" :lead="t('mcpLead')">
    <!-- 工具配置 -->
    <section :aria-label="t('mcpAria')">
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
  </SettingsSectionShell>
</template>
