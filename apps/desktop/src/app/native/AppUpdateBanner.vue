<script setup lang="ts">
import { CheckIcon, CopyIcon, DownloadIcon, XIcon } from "@lucide/vue";
import { computed, ref } from "vue";
import { useI18n } from "vue-i18n";

import { dismissUpdateBanner, openUpdateDownload, updateBanner } from "./app-update";

const { t } = useI18n();

/** 未公证：仅 mac 提示 xattr；与官网下载页同命令 */
const isMac = computed(() => window.agentUp?.platform === "darwin");
const macCmd = computed(() => t("appUpdateMacCmd"));
const cmdCopied = ref(false);
let copiedTimer: ReturnType<typeof setTimeout> | undefined;

async function onDownload(): Promise<void> {
  await openUpdateDownload();
}

async function copyMacCmd(): Promise<void> {
  const text = macCmd.value;
  try {
    await navigator.clipboard.writeText(text);
    cmdCopied.value = true;
    if (copiedTimer) clearTimeout(copiedTimer);
    copiedTimer = setTimeout(() => {
      cmdCopied.value = false;
    }, 2000);
  } catch {
    /* 无剪贴板权限时用户仍可手动选中命令 */
  }
}
</script>

<template>
  <!-- 有新版本时左下角提示：下载安装包 / 忽略本版本 -->
  <div
    v-if="updateBanner"
    class="pointer-events-none fixed bottom-4 left-4 z-50 max-w-md app-no-drag"
    role="status"
  >
    <div
      class="pointer-events-auto flex items-start gap-3 rounded-xl border border-rule bg-paper p-3.5 shadow-sm"
    >
      <div class="min-w-0 flex-1">
        <p class="text-sm font-medium text-foreground">
          {{ t("appUpdateAvailableTitle", { version: updateBanner.latestVersion }) }}
        </p>
        <p class="mt-0.5 text-xs text-muted-foreground">
          {{ t("appUpdateAvailableBody") }}
        </p>
        <!-- mac 未公证：安装后需清隔离属性 -->
        <template v-if="isMac">
          <p class="mb-0 mt-2 text-xs leading-relaxed text-muted-foreground">
            {{ t("appUpdateMacNote") }}
          </p>
          <div class="relative mt-1.5">
            <pre
              class="overflow-x-auto rounded-lg border border-rule bg-muted/60 py-2.5 pr-11 pl-3 font-mono text-[11px] leading-relaxed text-foreground"
            >{{ macCmd }}</pre>
            <button
              type="button"
              class="absolute top-1/2 right-1.5 inline-flex size-7 -translate-y-1/2 items-center justify-center rounded-md border border-rule bg-paper text-muted-foreground transition duration-200 hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/15"
              :aria-label="cmdCopied ? t('appUpdateMacCmdCopied') : t('appUpdateMacCmdCopy')"
              @click="copyMacCmd"
            >
              <CheckIcon v-if="cmdCopied" class="size-3.5 text-accent" aria-hidden="true" />
              <CopyIcon v-else class="size-3.5" aria-hidden="true" />
            </button>
          </div>
        </template>
        <div class="mt-2.5 flex flex-wrap items-center gap-2">
          <button
            type="button"
            class="inline-flex min-h-8 items-center gap-1.5 rounded-lg bg-accent px-3 text-sm font-medium text-white transition duration-200 hover:bg-accent-deep focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/15"
            @click="onDownload"
          >
            <DownloadIcon class="size-3.5" aria-hidden="true" />
            {{ t("appUpdateDownload") }}
          </button>
          <button
            type="button"
            class="inline-flex min-h-8 items-center rounded-lg border border-rule bg-paper px-3 text-sm text-muted-foreground transition duration-200 hover:bg-paper-deep hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/15"
            @click="dismissUpdateBanner"
          >
            {{ t("appUpdateDismiss") }}
          </button>
        </div>
      </div>
      <button
        type="button"
        class="grid size-7 shrink-0 place-items-center rounded-lg text-muted-foreground transition duration-200 hover:bg-paper-deep hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/15"
        :aria-label="t('appUpdateDismiss')"
        @click="dismissUpdateBanner"
      >
        <XIcon class="size-3.5" aria-hidden="true" />
      </button>
    </div>
  </div>
</template>
