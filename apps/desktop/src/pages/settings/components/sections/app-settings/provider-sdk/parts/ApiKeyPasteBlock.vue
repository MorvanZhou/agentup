<script setup lang="ts">
defineProps<{
  modelValue: string;
  /** 提交中仍允许点取消；主钮在空 Key 时禁用 */
  busy: boolean;
  /** 文案由模板 apiKeyPaste 能力决定，禁止页壳 if (driverId) */
  label: string;
  hint: string;
  placeholder: string;
  /** 主钮 / 取消：按 opencode / github-pat 分档，勿与浏览器 OAuth「取消登录」混用 */
  submitLabel: string;
  cancelLabel: string;
}>();

const emit = defineEmits<{
  "update:modelValue": [value: string];
  submit: [];
  cancel: [];
}>();
</script>

<template>
  <!-- OpenCode Zen / GitHub PAT 等：官网复制后粘贴写入隔离目录 -->
  <div class="grid gap-1.5" data-testid="sdk-api-key-paste">
    <p class="m-0 text-xs leading-snug text-muted-foreground">{{ hint }}</p>
    <label class="m-0 text-xs font-medium text-foreground" for="sdk-api-key-paste-input">
      {{ label }}
    </label>
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
</template>
