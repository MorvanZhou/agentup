<script setup lang="ts">
import { useAppearanceSettings } from "../../../composables/useAppearanceSettings";
import { t } from "../../../../../shared/model/ui/ui-locale";

const { options, themeMode, uiLocale, guest, busy, select, selectLocale } = useAppearanceSettings();
</script>

<template>
  <main class="min-h-0 min-w-0 overflow-auto bg-background">
    <div class="mx-auto w-full max-w-5xl px-4 py-4 sm:px-5 sm:py-5">
      <!-- 页头 -->
      <header class="mb-4 border-b border-rule pb-4">
        <p class="m-0 text-xs font-medium tracking-wider text-accent">{{ t("appearanceKicker") }}</p>
        <div class="mt-2 min-w-0">
          <h1 class="m-0 text-lg font-semibold tracking-tight text-foreground">{{ t("appearanceTitle") }}</h1>
          <p class="mb-0 mt-1.5 max-w-2xl text-sm leading-snug text-muted-foreground">
            {{ guest ? t("appearanceGuestLead") : t("appearanceAccountLead") }}
          </p>
        </div>
      </header>

      <!-- 语言 -->
      <section class="mb-4 grid gap-2" :aria-label="t('appearanceLanguage')">
        <h2 class="m-0 text-sm font-semibold text-foreground">{{ t("appearanceLanguage") }}</h2>
        <div class="grid gap-2 sm:grid-cols-2">
          <button
            type="button"
            :disabled="busy"
            class="rounded-xl border px-3 py-3 text-left text-sm font-semibold transition duration-200 disabled:opacity-50"
            :class="
              uiLocale === 'zh'
                ? 'border-accent bg-accent/10 text-foreground shadow-sm'
                : 'border-rule bg-paper text-foreground hover:border-accent/40'
            "
            @click="selectLocale('zh')"
          >
            {{ t("appearanceLanguageZh") }}
          </button>
          <button
            type="button"
            :disabled="busy"
            class="rounded-xl border px-3 py-3 text-left text-sm font-semibold transition duration-200 disabled:opacity-50"
            :class="
              uiLocale === 'en'
                ? 'border-accent bg-accent/10 text-foreground shadow-sm'
                : 'border-rule bg-paper text-foreground hover:border-accent/40'
            "
            @click="selectLocale('en')"
          >
            {{ t("appearanceLanguageEn") }}
          </button>
        </div>
      </section>

      <!-- 主题 -->
      <section class="grid gap-2" :aria-label="t('appearanceTheme')">
        <h2 class="m-0 text-sm font-semibold text-foreground">{{ t("appearanceTheme") }}</h2>
        <div class="grid gap-2 sm:grid-cols-3">
          <button
            v-for="option in options"
            :key="option.id"
            type="button"
            :disabled="busy"
            class="rounded-xl border px-3 py-3 text-left transition duration-200 disabled:opacity-50"
            :class="
              themeMode === option.id
                ? 'border-accent bg-accent/10 shadow-sm'
                : 'border-rule bg-paper hover:border-accent/40'
            "
            @click="select(option.id)"
          >
            <span class="block text-sm font-semibold text-foreground">{{ option.label }}</span>
            <span class="mt-1 block text-xs leading-snug text-muted-foreground">{{ option.hint }}</span>
          </button>
        </div>
      </section>
    </div>
  </main>
</template>
