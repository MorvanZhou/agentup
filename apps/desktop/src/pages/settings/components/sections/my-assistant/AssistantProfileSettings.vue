<script setup lang="ts">
import { onMounted, ref } from "vue";

import AgentAvatarField from "../../../../../shared/components/avatar/AgentAvatarField.vue";
import { PERSONAL_ASSISTANT_DEFAULT_AVATAR } from "../../../../../shared/model/avatar/personal-assistant-default";
import { t } from "../../../../../shared/model/ui/ui-locale";
import { usePersonalAssistantSettings } from "../../../composables/usePersonalAssistantSettings";

const { name, role, background, avatarUrl, loading, saving, load, applyAvatarDataUrl, commitField } =
  usePersonalAssistantSettings();
const officialAvatarId = ref("");
const defaultAvatar = PERSONAL_ASSISTANT_DEFAULT_AVATAR;

onMounted(() => void load());

function onAvatarPick(dataUrl: string, officialId: string): void {
  officialAvatarId.value = officialId;
  void applyAvatarDataUrl(dataUrl);
}
</script>

<template>
  <main class="min-h-0 min-w-0 overflow-auto bg-background">
    <div class="mx-auto w-full max-w-3xl px-4 py-4 sm:px-5 sm:py-6">
      <!-- 页头 -->
      <header class="mb-6">
        <p class="m-0 text-xs font-medium tracking-wider text-accent">{{ t("assistantKicker") }}</p>
        <h1 class="mb-0 mt-2 text-lg font-semibold tracking-tight text-foreground">{{ t("assistantTitle") }}</h1>
        <p class="mb-0 mt-1.5 max-w-xl text-sm leading-snug text-muted-foreground">
          {{ t("assistantLead") }}
        </p>
      </header>

      <div class="grid gap-8" :aria-label="t('assistantTitle')">
        <!-- 身份 -->
        <AgentAvatarField
          :name="name || t('assistantNamePlaceholder')"
          :preview="avatarUrl || ''"
          :fallback="defaultAvatar"
          :busy="loading || saving"
          :selected-id="officialAvatarId"
          :hint="t('assistantAvatarHint')"
          @pick="onAvatarPick"
        />
        <label class="grid gap-1.5 text-sm font-medium text-foreground">
          {{ t("assistantName") }}
          <input
            v-model="name"
            type="text"
            maxlength="40"
            :disabled="loading"
            class="min-h-8 rounded-lg border border-rule bg-paper px-3 text-sm outline-none transition duration-200 focus:border-accent focus:bg-background focus:ring-2 focus:ring-accent/15 disabled:opacity-60"
            :placeholder="t('assistantNamePlaceholder')"
            @blur="commitField"
          />
          <span class="font-normal text-xs text-muted-foreground">{{ t("assistantNameHint") }}</span>
        </label>
        <label class="grid gap-1.5 text-sm font-medium text-foreground">
          {{ t("agentsLocalRole") }}
          <input
            v-model="role"
            type="text"
            maxlength="40"
            :disabled="loading"
            class="min-h-8 rounded-lg border border-rule bg-paper px-3 text-sm outline-none transition duration-200 focus:border-accent focus:bg-background focus:ring-2 focus:ring-accent/15 disabled:opacity-60"
            :placeholder="t('agentsLocalRolePlaceholder')"
            @blur="commitField"
          />
        </label>

        <!-- 人物背景 -->
        <section class="grid gap-1.5 border-t border-rule pt-6">
          <label class="grid gap-1.5 text-sm font-medium text-foreground">
            {{ t("agentsLocalBackground") }}
            <textarea
              v-model="background"
              rows="6"
              maxlength="300"
              :disabled="loading"
              class="min-h-32 w-full resize-y rounded-lg border border-rule bg-paper px-3 py-2.5 text-sm leading-relaxed outline-none transition duration-200 focus:border-accent focus:bg-background focus:ring-2 focus:ring-accent/15 disabled:opacity-60"
              :placeholder="t('agentsLocalBackgroundPlaceholder')"
              @blur="commitField"
            />
          </label>
          <p class="m-0 text-xs leading-snug text-muted-foreground">
            {{ t("assistantBackgroundHint") }}
            <span v-if="saving" class="text-foreground">{{ t("saving") }}</span>
          </p>
        </section>
      </div>
    </div>
  </main>
</template>
