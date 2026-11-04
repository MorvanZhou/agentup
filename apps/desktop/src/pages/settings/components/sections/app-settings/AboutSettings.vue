<script setup lang="ts">
import { CheckIcon, CopyIcon, DownloadIcon, ExternalLinkIcon, RefreshCwIcon } from "@lucide/vue";
import { computed } from "vue";

import { publicUrl } from "../../../../../shared/model/ui/public-url";
import { t } from "../../../../../shared/model/ui/ui-locale";
import { useAboutSettings } from "../../../composables/useAboutSettings";

const {
  productName,
  version,
  websiteUrl,
  downloadPageUrl,
  updateStatus,
  isMac,
  canCheckUpdates,
  checking,
  available,
  cmdCopied,
  openWebsite,
  openDownloadPage,
  checkForUpdates,
  downloadUpdate,
  copyMacCmd,
} = useAboutSettings();

const logoSrc = publicUrl("icon.png");
const macCmd = computed(() => t("appUpdateMacCmd"));
</script>

<template>
  <main class="min-h-0 min-w-0 overflow-auto bg-background">
    <div class="mx-auto w-full max-w-3xl px-4 py-4 sm:px-5 sm:py-6">
      <!-- 页头 -->
      <header class="mb-8">
        <p class="m-0 text-xs font-medium tracking-wider text-accent">{{ t("aboutKicker") }}</p>
        <h1 class="mb-0 mt-2 text-lg font-semibold tracking-tight text-foreground">
          {{ t("aboutTitle") }}
        </h1>
        <p class="mb-0 mt-1.5 max-w-xl text-sm leading-snug text-muted-foreground">
          {{ t("aboutLead") }}
        </p>
      </header>

      <!-- 产品身份：字重与间距分层，不加外框 -->
      <section class="mb-8 flex items-center gap-4" :aria-label="t('aboutProductAria')">
        <img
          :src="logoSrc"
          alt=""
          class="size-14 shrink-0 rounded-xl"
          width="56"
          height="56"
        >
        <div class="min-w-0">
          <p class="m-0 text-base font-semibold tracking-tight text-foreground">
            {{ productName }}
          </p>
          <p v-if="version" class="mb-0 mt-1 font-mono text-xs tabular-nums text-muted-foreground">
            {{ t("aboutVersion", { version }) }}
          </p>
        </div>
      </section>

      <!-- 外链：标签 / URL 纵向排，靠字色与 hover 区分 -->
      <section
        v-if="websiteUrl || downloadPageUrl"
        class="mb-8 grid max-w-xl gap-4"
        :aria-label="t('aboutLinksAria')"
      >
        <button
          v-if="websiteUrl"
          type="button"
          class="group grid gap-1 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/15 rounded-lg"
          @click="openWebsite"
        >
          <span class="inline-flex items-center gap-1.5 text-sm font-medium text-foreground transition duration-200 group-hover:text-accent">
            {{ t("aboutWebsite") }}
            <ExternalLinkIcon class="size-3.5 text-muted-foreground transition duration-200 group-hover:text-accent" aria-hidden="true" />
          </span>
          <span class="truncate font-mono text-xs leading-snug text-muted-foreground">{{ websiteUrl }}</span>
        </button>
        <button
          v-if="downloadPageUrl"
          type="button"
          class="group grid gap-1 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/15 rounded-lg"
          @click="openDownloadPage"
        >
          <span class="inline-flex items-center gap-1.5 text-sm font-medium text-foreground transition duration-200 group-hover:text-accent">
            {{ t("aboutDownloadPage") }}
            <ExternalLinkIcon class="size-3.5 text-muted-foreground transition duration-200 group-hover:text-accent" aria-hidden="true" />
          </span>
          <span class="truncate font-mono text-xs leading-snug text-muted-foreground">{{ downloadPageUrl }}</span>
        </button>
      </section>

      <!-- 检查更新 -->
      <section class="max-w-xl" role="region" :aria-label="t('aboutUpdatesAria')">
        <p v-if="!canCheckUpdates" class="m-0 text-sm text-muted-foreground">
          {{ t("aboutUpdatesUnsupported") }}
        </p>
        <template v-else>
          <div class="flex flex-wrap items-center gap-x-3 gap-y-2">
            <button
              type="button"
              class="inline-flex min-h-8 items-center gap-1.5 rounded-lg bg-accent px-3 text-sm font-medium text-white transition duration-200 hover:bg-accent-deep focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/15 disabled:opacity-50"
              :disabled="checking"
              @click="checkForUpdates"
            >
              <RefreshCwIcon
                class="size-3.5"
                :class="checking ? 'animate-spin motion-reduce:animate-none' : undefined"
                aria-hidden="true"
              />
              {{ checking ? t("aboutChecking") : t("aboutCheckUpdates") }}
            </button>
            <span
              v-if="updateStatus.kind === 'up-to-date'"
              class="text-sm text-muted-foreground"
              role="status"
            >
              {{ t("appUpdateUpToDate") }}
            </span>
            <span
              v-else-if="updateStatus.kind === 'error'"
              class="text-sm text-muted-foreground"
              role="status"
            >
              {{ t("appUpdateCheckFailed") }}
            </span>
            <span
              v-else-if="available"
              class="text-sm font-medium text-foreground"
              role="status"
            >
              {{ t("appUpdateAvailableTitle", { version: available.latestVersion }) }}
            </span>
          </div>

          <!-- 有新版本：同样用间距，不套卡片 -->
          <div v-if="available" class="mt-4 grid gap-3">
            <p class="m-0 text-sm leading-relaxed text-muted-foreground">
              {{ t("appUpdateAvailableBody") }}
            </p>
            <template v-if="isMac">
              <p class="m-0 text-xs leading-relaxed text-muted-foreground">
                {{ t("appUpdateMacNote") }}
              </p>
              <div class="relative max-w-full">
                <pre
                  class="overflow-x-auto rounded-lg bg-muted/50 py-2.5 pr-11 pl-3 font-mono text-[11px] leading-relaxed text-foreground"
                >{{ macCmd }}</pre>
                <button
                  type="button"
                  class="absolute top-1/2 right-1.5 inline-flex size-7 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground transition duration-200 hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/15"
                  :aria-label="cmdCopied ? t('appUpdateMacCmdCopied') : t('appUpdateMacCmdCopy')"
                  @click="copyMacCmd"
                >
                  <CheckIcon v-if="cmdCopied" class="size-3.5 text-accent" aria-hidden="true" />
                  <CopyIcon v-else class="size-3.5" aria-hidden="true" />
                </button>
              </div>
            </template>
            <div>
              <button
                type="button"
                class="inline-flex min-h-8 items-center gap-1.5 rounded-lg border border-rule bg-paper px-3 text-sm font-medium text-foreground transition duration-200 hover:border-accent/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/15"
                @click="downloadUpdate"
              >
                <DownloadIcon class="size-3.5" aria-hidden="true" />
                {{ t("appUpdateDownload") }}
              </button>
            </div>
          </div>
        </template>
      </section>
    </div>
  </main>
</template>
