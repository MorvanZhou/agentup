<script setup lang="ts">
import { computed } from "vue";

import { t } from "../shared/model/ui-locale";
import { useDesktop } from "./desktop";
import {
  authPromptBusy,
  authPromptOpen,
  authPromptReason,
  cancelAuthPrompt,
  confirmAuthPrompt,
} from "./auth-gate";

const { reopenBrowserLogin } = useDesktop();
const open = computed(() => authPromptOpen.value);
const reason = computed(() => authPromptReason.value);
const busy = computed(() => authPromptBusy.value);

function onCancel(): void {
  void cancelAuthPrompt();
}

function onLogin(): void {
  if (busy.value) {
    void reopenBrowserLogin();
    return;
  }
  void confirmAuthPrompt();
}
</script>

<template>
  <Teleport to="body">
    <!-- 需账号能力：留在当前页叠层，由用户选择去登录或取消 -->
    <div
      v-if="open"
      class="fixed inset-0 z-[100] grid place-items-center bg-ink/55 p-4"
      role="dialog"
      aria-modal="true"
      :aria-labelledby="'auth-prompt-title'"
      :aria-describedby="'auth-prompt-body'"
    >
      <div class="w-full max-w-sm rounded-xl border border-rule bg-paper p-4 shadow-md">
        <h2 id="auth-prompt-title" class="m-0 text-sm font-semibold tracking-tight text-foreground">
          {{ t("authPromptTitle") }}
        </h2>
        <p id="auth-prompt-body" class="mb-0 mt-2 text-sm leading-snug text-muted-foreground">
          {{ reason }}
        </p>
        <p v-if="busy" class="mb-0 mt-3 text-xs text-muted-foreground" role="status">
          {{ t("loginOpening") }}
        </p>
        <div class="mt-4 flex justify-end gap-2">
          <button
            type="button"
            class="min-h-8 rounded-lg border border-rule px-3 text-sm transition duration-200 hover:bg-paper"
            @click="onCancel"
          >
            {{ t("cancel") }}
          </button>
          <button
            type="button"
            class="min-h-8 rounded-lg bg-accent px-3 text-sm font-semibold text-white transition duration-200 hover:bg-accent-deep"
            @click="onLogin"
          >
            {{ busy ? t("loginReopen") : t("authPromptLogin") }}
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>
