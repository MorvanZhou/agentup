<script setup lang="ts">
import { computed } from "vue";

import { t } from "../../shared/model/ui/ui-locale";
import { useDesktop } from "../desktop";
import { authPromptOpen } from "./auth-gate";

const { browserLoginActive, reopenBrowserLogin, cancelBrowserLogin } = useDesktop();

/** 能力闸门自带取消；菜单 / 账号设置直接开浏览器后，用这层等回跳。 */
const open = computed(() => browserLoginActive.value && !authPromptOpen.value);

function onCancel(): void {
  void cancelBrowserLogin();
}

function onReopen(): void {
  void reopenBrowserLogin();
}
</script>

<template>
  <Teleport to="body">
    <!-- 已打开 Web 登录：留在当前页，可重新打开或取消等待 -->
    <div
      v-if="open"
      class="fixed inset-0 z-[100] grid place-items-center bg-ink/55 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="browser-login-title"
      aria-describedby="browser-login-body"
    >
      <div class="w-full max-w-sm rounded-xl border border-rule bg-paper p-4 shadow-md">
        <h2 id="browser-login-title" class="m-0 text-sm font-semibold tracking-tight text-foreground">
          {{ t("loginCardTitle") }}
        </h2>
        <p id="browser-login-body" class="mb-0 mt-2 text-sm leading-snug text-muted-foreground">
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
            @click="onReopen"
          >
            {{ t("loginReopen") }}
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>
