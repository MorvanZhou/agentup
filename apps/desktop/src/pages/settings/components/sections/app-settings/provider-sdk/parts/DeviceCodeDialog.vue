<script setup lang="ts">
import { ref, watch } from "vue";

import AppDialog from "../../../../../../../shared/components/AppDialog.vue";
import { showToast } from "../../../../../../../shared/model/ui/toast";
import { t } from "../../../../../../../shared/model/ui/ui-locale";

const props = defineProps<{
  code: string | null;
}>();

/** 设备验证码弹窗：码出现时强制弹出一次，关掉后卡片上仍保留同一份码 */
const open = ref(false);

watch(
  () => props.code,
  (next) => {
    if (next) {
      open.value = true;
      return;
    }
    open.value = false;
  },
);

async function copyDeviceCode(): Promise<void> {
  const value = props.code?.trim();
  if (!value) return;
  try {
    await navigator.clipboard.writeText(value);
    showToast(t("providerSdkDeviceCodeCopied"), "success");
  } catch {
    /* Electron 下极少失败；失败时用户仍可手动选中弹窗里的码 */
  }
}
</script>

<template>
  <!-- Codex device-auth：验证码强化弹窗（与登录卡片内联展示并存） -->
  <AppDialog
    :open="open"
    :title="t('providerSdkDeviceCodeDialogTitle')"
    :description="t('providerSdkDeviceCodeDialogBody')"
    align="center"
    @update:open="open = $event"
  >
    <div
      v-if="code"
      class="grid justify-items-center gap-2 rounded-xl border border-rule bg-background px-4 py-5"
    >
      <p
        class="m-0 select-all font-mono text-2xl font-semibold tracking-[0.2em] text-foreground"
        data-testid="sdk-device-code-dialog"
      >
        {{ code }}
      </p>
    </div>
    <template #footer>
      <button
        type="button"
        class="min-h-8 rounded-lg border border-rule bg-paper px-3 text-sm font-medium text-foreground transition duration-200 hover:bg-background focus-visible:ring-2 focus-visible:ring-accent/15 focus-visible:outline-none"
        @click="copyDeviceCode"
      >
        {{ t("providerSdkDeviceCodeCopy") }}
      </button>
      <button
        type="button"
        class="min-h-8 rounded-lg bg-accent px-3 text-sm font-semibold text-white transition duration-200 hover:bg-accent-deep focus-visible:ring-2 focus-visible:ring-accent/15 focus-visible:outline-none"
        @click="open = false"
      >
        {{ t("providerSdkDeviceCodeDialogGotIt") }}
      </button>
    </template>
  </AppDialog>
</template>
