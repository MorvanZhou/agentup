<script setup lang="ts">
import { ExternalLinkIcon } from "@lucide/vue";

import { t } from "../../../../../../../shared/model/ui/ui-locale";

defineProps<{
  modelValue: string;
  /** 提交中仍允许点取消；主钮在空 Key 时禁用 */
  busy: boolean;
  /** 文案由模板 apiKeyPaste 能力决定，禁止页壳 if (driverId) */
  label: string;
  /** 步骤 1 说明：如何在申请页拿到 Key */
  hint: string;
  placeholder: string;
  /** 主钮 / 取消：按 opencode / github-pat 分档，勿与浏览器 OAuth「取消登录」混用 */
  submitLabel: string;
  cancelLabel: string;
  /**
   * 申请页 URL（登录回传 auth_url）。步骤 1 显性展示；
   * 不自动 openExternal——已有 Key 时可跳过步骤 1。
   */
  docUrl?: string | null;
}>();

const emit = defineEmits<{
  "update:modelValue": [value: string];
  submit: [];
  cancel: [];
  /** 用户点步骤 1 链接；由上层 openExternal */
  "open-doc": [];
}>();
</script>

<template>
  <!-- 粘贴 Key：统一两步（开申请页 → 粘贴确认）；禁自动弹浏览器 -->
  <div class="grid gap-3" data-testid="sdk-api-key-paste" role="list">
    <!-- 步骤 1：打开申请页；URL 显性 + 外跳图标 -->
    <div class="grid gap-1.5" data-testid="sdk-api-key-step-1" role="listitem">
      <div class="flex items-center gap-2">
        <span
          class="grid size-5 shrink-0 place-items-center rounded-full bg-accent text-[11px] font-semibold tabular-nums text-white"
          aria-hidden="true"
        >
          1
        </span>
        <p class="m-0 text-xs font-medium text-foreground">
          {{ t("providerSdkApiKeyStep1") }}
        </p>
      </div>
      <div class="grid gap-1.5 pl-7">
        <p class="m-0 text-xs leading-snug text-muted-foreground">{{ hint }}</p>
        <button
          v-if="docUrl"
          type="button"
          class="group flex min-h-8 w-full items-start gap-2 rounded-lg border border-rule bg-paper px-2.5 py-2 text-left transition duration-200 hover:bg-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/15 disabled:opacity-50"
          data-testid="sdk-api-key-open-doc"
          :disabled="busy"
          :title="docUrl"
          @click="emit('open-doc')"
        >
          <span class="min-w-0 flex-1 break-all font-mono text-xs leading-snug text-foreground group-hover:text-accent">
            {{ docUrl }}
          </span>
          <ExternalLinkIcon
            class="mt-0.5 size-3.5 shrink-0 text-muted-foreground transition duration-200 group-hover:text-accent"
            aria-hidden="true"
          />
        </button>
        <p v-else class="m-0 text-xs text-muted-foreground">
          {{ t("providerSdkApiKeyStep1NoUrl") }}
        </p>
      </div>
    </div>

    <!-- 步骤 2：粘贴 Key 并确认；与步骤 1 同一套步骤壳 -->
    <div class="grid gap-1.5" data-testid="sdk-api-key-step-2" role="listitem">
      <div class="flex items-center gap-2">
        <span
          class="grid size-5 shrink-0 place-items-center rounded-full bg-accent text-[11px] font-semibold tabular-nums text-white"
          aria-hidden="true"
        >
          2
        </span>
        <label class="m-0 text-xs font-medium text-foreground" for="sdk-api-key-paste-input">
          {{ t("providerSdkApiKeyStep2") }}
          <span class="font-normal text-muted-foreground"> · {{ label }}</span>
        </label>
      </div>
      <div class="grid gap-1.5 pl-7">
        <p class="m-0 text-xs leading-snug text-muted-foreground">
          {{ t("providerSdkApiKeyStep2Hint") }}
        </p>
        <input
          id="sdk-api-key-paste-input"
          :value="modelValue"
          type="password"
          autocomplete="off"
          class="min-h-8 w-full rounded-lg border border-rule bg-paper px-2.5 text-sm outline-none focus:ring-2 focus:ring-accent/15"
          :placeholder="placeholder"
          @input="emit('update:modelValue', ($event.target as HTMLInputElement).value)"
          @keydown.enter.prevent="emit('submit')"
        />
        <div class="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            class="min-h-8 rounded-lg bg-accent px-2.5 text-xs font-medium text-white transition duration-200 hover:bg-accent-deep disabled:opacity-50"
            :disabled="busy || !modelValue.trim()"
            @click="emit('submit')"
          >
            {{ submitLabel }}
          </button>
          <button
            type="button"
            class="min-h-8 rounded-lg border border-rule bg-background px-2.5 text-xs font-medium transition duration-200 hover:bg-paper"
            @click="emit('cancel')"
          >
            {{ cancelLabel }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
