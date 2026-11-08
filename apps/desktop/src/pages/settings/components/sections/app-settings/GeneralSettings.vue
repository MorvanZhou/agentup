<script setup lang="ts">
import AppSwitch from "../../../../../shared/components/AppSwitch.vue";
import { t } from "../../../../../shared/model/ui/ui-locale";
import { useGeneralSettings } from "../../../composables/useGeneralSettings";
import SettingsBlock from "../../SettingsBlock.vue";
import SettingsChoice from "../../SettingsChoice.vue";
import SettingsSectionShell from "../../SettingsSectionShell.vue";

const {
  options,
  fontOptions,
  themeMode,
  chatFontSize,
  uiLocale,
  guest,
  busy,
  menuBarAvailable,
  menuBarVisible,
  select,
  selectLocale,
  selectFont,
  toggleMenuBar,
} = useGeneralSettings();
</script>

<template>
  <SettingsSectionShell :title="t('appearanceTitle')">
    <template #lead>
      {{ guest ? t("appearanceGuestLead") : t("appearanceAccountLead") }}
    </template>

    <!-- 语言 -->
    <SettingsBlock :title="t('appearanceLanguage')" :aria-label="t('appearanceLanguage')">
      <div class="grid gap-2 sm:grid-cols-2">
        <SettingsChoice :selected="uiLocale === 'zh'" :disabled="busy" @click="selectLocale('zh')">
          {{ t("appearanceLanguageZh") }}
        </SettingsChoice>
        <SettingsChoice :selected="uiLocale === 'en'" :disabled="busy" @click="selectLocale('en')">
          {{ t("appearanceLanguageEn") }}
        </SettingsChoice>
      </div>
    </SettingsBlock>

    <!-- 主题 -->
    <SettingsBlock :title="t('appearanceTheme')" :aria-label="t('appearanceTheme')">
      <div class="grid gap-2 sm:grid-cols-3">
        <SettingsChoice
          v-for="option in options"
          :key="option.id"
          :selected="themeMode === option.id"
          :disabled="busy"
          @click="select(option.id)"
        >
          {{ option.label }}
        </SettingsChoice>
      </div>
    </SettingsBlock>

    <!-- 聊天字号 -->
    <SettingsBlock :title="t('chatFontTitle')" :aria-label="t('chatFontTitle')">
      <div class="grid gap-2 sm:grid-cols-3">
        <SettingsChoice
          v-for="option in fontOptions"
          :key="option.id"
          :selected="chatFontSize === option.id"
          :disabled="busy"
          @click="selectFont(option.id)"
        >
          {{ option.label }}
        </SettingsChoice>
      </div>
    </SettingsBlock>

    <!-- macOS 菜单栏图标：仅 Electron darwin 展示 -->
    <SettingsBlock v-if="menuBarAvailable" :aria-label="t('appearanceMenuBar')">
      <div class="flex items-center justify-between gap-4">
        <div class="min-w-0">
          <h2 class="m-0 text-sm font-semibold text-foreground">{{ t("appearanceMenuBar") }}</h2>
          <p class="mb-0 mt-1 text-xs leading-snug text-muted-foreground">
            {{ t("appearanceMenuBarHint") }}
          </p>
        </div>
        <AppSwitch
          :model-value="menuBarVisible"
          :disabled="busy"
          :ariaLabel="t('appearanceMenuBar')"
          @update:model-value="toggleMenuBar"
        />
      </div>
    </SettingsBlock>
  </SettingsSectionShell>
</template>
