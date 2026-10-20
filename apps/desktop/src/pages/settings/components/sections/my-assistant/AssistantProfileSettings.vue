<script setup lang="ts">
import { ImagePlusIcon } from "@lucide/vue";
import { onMounted, ref } from "vue";

import AgentAvatar from "../../../../../shared/components/AgentAvatar.vue";
import { PERSONAL_ASSISTANT_DEFAULT_AVATAR } from "../../../../../shared/model/personal-assistant-default";
import { t } from "../../../../../shared/model/ui-locale";
import { usePersonalAssistantSettings } from "../../../composables/usePersonalAssistantSettings";

const { name, instructions, avatarUrl, loading, saving, load, chooseAvatar, commitField } =
  usePersonalAssistantSettings();
const avatarInput = ref<HTMLInputElement>();
const defaultAvatar = PERSONAL_ASSISTANT_DEFAULT_AVATAR;

onMounted(() => void load());

function onAvatar(event: Event): void {
  const input = event.target as HTMLInputElement;
  void chooseAvatar(input.files?.[0]).finally(() => {
    input.value = "";
  });
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
        <section class="flex items-start gap-4">
          <div class="flex shrink-0 flex-col items-center gap-1.5">
            <button
              type="button"
              class="rounded-lg outline-none transition duration-200 focus-visible:ring-2 focus-visible:ring-accent/30 disabled:opacity-50"
              :disabled="loading || saving"
              :aria-label="t('accountAvatarPick')"
              @click="avatarInput?.click()"
            >
              <AgentAvatar
                :name="name || t('assistantNamePlaceholder')"
                :avatar-url="avatarUrl || defaultAvatar"
                size="xl"
              />
            </button>
            <input
              ref="avatarInput"
              type="file"
              class="hidden"
              accept="image/png,image/jpeg,image/webp"
              @change="onAvatar"
            />
            <button
              type="button"
              class="inline-flex min-h-7 items-center gap-1 text-xs font-medium text-muted-foreground transition duration-200 hover:text-foreground disabled:opacity-50"
              :disabled="loading || saving"
              @click="avatarInput?.click()"
            >
              <ImagePlusIcon class="size-3.5" aria-hidden="true" />
              {{ avatarUrl ? t("accountAvatarChange") : t("accountAvatarPick") }}
            </button>
          </div>

          <label class="grid min-w-0 flex-1 gap-1.5 text-sm font-medium text-foreground">
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
        </section>
        <p class="m-0 -mt-4 text-sm text-muted-foreground">
          <span class="font-medium text-foreground">{{ t("publishRole") }}</span>
          <span class="mx-1.5" aria-hidden="true">·</span>
          <span>{{ t("assistantRole") }}</span>
          <span class="mt-1 block text-xs">{{ t("assistantRoleHint") }}</span>
        </p>

        <!-- 基础指令 -->
        <section class="grid gap-1.5 border-t border-rule pt-6">
          <label class="grid gap-1.5 text-sm font-medium text-foreground">
            {{ t("assistantSystem") }}
            <textarea
              v-model="instructions"
              rows="14"
              maxlength="20000"
              :disabled="loading"
              class="min-h-56 w-full resize-y rounded-lg border border-rule bg-paper px-3 py-2.5 text-sm leading-relaxed outline-none transition duration-200 focus:border-accent focus:bg-background focus:ring-2 focus:ring-accent/15 disabled:opacity-60"
              :placeholder="t('assistantSystemPlaceholder')"
              @blur="commitField"
            />
          </label>
          <p class="m-0 text-xs leading-snug text-muted-foreground">
            {{ t("assistantSystemHint") }}
            <span v-if="saving" class="text-foreground">{{ t("saving") }}</span>
          </p>
        </section>
      </div>
    </div>
  </main>
</template>
