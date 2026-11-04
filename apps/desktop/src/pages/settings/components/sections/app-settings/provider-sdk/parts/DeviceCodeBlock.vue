<script setup lang="ts">
import { t, tf } from "../../../../../../../shared/model/ui/ui-locale";

defineProps<{
  code: string;
}>();
</script>

<template>
  <!-- Codex device-auth：码来自 CLI stdout，填到网页 XXXX-XXXXX；卡片内联保留 -->
  <div class="grid gap-1 rounded-lg border border-rule bg-paper px-2.5 py-2">
    <p class="m-0 text-xs text-muted-foreground">
      {{ t("providerSdkDeviceCodeHint") }}
    </p>
    <p
      class="m-0 font-mono text-base font-semibold tracking-wider text-foreground"
      data-testid="sdk-device-code"
    >
      {{ tf("providerSdkDeviceCode", { code }) }}
    </p>
  </div>
</template>
