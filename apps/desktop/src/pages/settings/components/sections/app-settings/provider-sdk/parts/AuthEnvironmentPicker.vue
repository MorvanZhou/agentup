<script setup lang="ts">
import { computed } from "vue";

import type { AgentSdkAuthEnvironment } from "../../../../../../../shared/model/runtime/runtime";
import { t } from "../../../../../../../shared/model/ui/ui-locale";

const props = defineProps<{
  environments: AgentSdkAuthEnvironment[];
  modelValue: AgentSdkAuthEnvironment;
  /** 已登录：分段只读，换站须先登出 */
  locked: boolean;
  disabled?: boolean;
}>();

const emit = defineEmits<{
  "update:modelValue": [value: AgentSdkAuthEnvironment];
}>();

/** 模板声明的站点 → 分段 radio；文案跟 internal/external 约定走 */
const options = computed(() =>
  props.environments.map((value) => ({
    value,
    label:
      value === "internal" ? t("providerSdkAuthEnvInternal") : t("providerSdkAuthEnvExternal"),
  })),
);
</script>

<template>
  <!-- 登录站点：分段 + 单一登录主钮；仅模板声明了 authEnvironments 时由父级挂载 -->
  <div class="grid gap-1.5">
    <div class="flex items-baseline justify-between gap-3">
      <p id="sdk-auth-env-label" class="m-0 shrink-0 text-xs font-medium text-foreground">
        {{ t("providerSdkAuthEnvLabel") }}
      </p>
      <p class="m-0 truncate text-right text-[11px] leading-none text-muted-foreground">
        {{ locked ? t("providerSdkAuthEnvLockedHint") : t("providerSdkAuthEnvHint") }}
      </p>
    </div>
    <div
      class="grid gap-0.5 rounded-lg border border-rule bg-muted/40 p-0.5"
      :style="{
        gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))`,
      }"
      role="radiogroup"
      aria-labelledby="sdk-auth-env-label"
    >
      <button
        v-for="option in options"
        :key="option.value"
        type="button"
        role="radio"
        class="min-h-8 rounded-md px-2 text-xs font-medium leading-tight transition duration-150 outline-none focus-visible:ring-2 focus-visible:ring-accent/40 disabled:opacity-50"
        :class="
          modelValue === option.value
            ? 'bg-paper text-foreground shadow-sm ring-1 ring-accent/35'
            : 'text-muted-foreground hover:bg-paper/70 hover:text-foreground'
        "
        :aria-checked="modelValue === option.value"
        :disabled="disabled || locked"
        @click="emit('update:modelValue', option.value)"
      >
        {{ option.label }}
      </button>
    </div>
  </div>
</template>
