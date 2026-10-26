<script setup lang="ts">
import { ImagePlusIcon } from "@lucide/vue";
import { ref } from "vue";
import { RouterLink } from "vue-router";

import { useDesktop } from "../../../../../app/desktop";
import UserAvatar from "../../../../../shared/components/avatar/UserAvatar.vue";
import { isAccountSession, isGuestSession, sessionDisplayNickname } from "../../../../../shared/model/session/session";
import { showToast } from "../../../../../shared/model/ui/toast";
import { t } from "../../../../../shared/model/ui/ui-locale";
import { useAccountSettings } from "../../../composables/useAccountSettings";

const { session, nickname, busy, avatarBusy, commitNickname, chooseAvatar } = useAccountSettings();
const { logout } = useDesktop();
const avatarInput = ref<HTMLInputElement>();
const signingOut = ref(false);

async function signOut(): Promise<void> {
  if (signingOut.value || busy.value || avatarBusy.value) return;
  signingOut.value = true;
  try {
    await logout();
  } catch {
    showToast(t("accountLogoutFailed"), "error");
  } finally {
    signingOut.value = false;
  }
}

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
        <p class="m-0 text-xs font-medium tracking-wider text-accent">{{ t("accountKicker") }}</p>
        <h1 class="mb-0 mt-2 text-lg font-semibold tracking-tight text-foreground">{{ t("accountTitle") }}</h1>
        <p class="mb-0 mt-1.5 max-w-xl text-sm leading-snug text-muted-foreground">
          <template v-if="isGuestSession(session)">
            {{ t("accountGuestLead") }}
          </template>
          <template v-else>{{ t("accountLead") }}</template>
        </p>
      </header>

      <!-- 游客引导 -->
      <section
        v-if="isGuestSession(session)"
        class="grid max-w-md gap-3 rounded-xl border border-rule bg-paper p-4"
        :aria-label="t('accountLoginGuide')"
      >
        <div class="flex items-center gap-3">
          <UserAvatar :name="sessionDisplayNickname(session)" size="lg" />
          <p class="m-0 text-sm text-foreground">{{ t("accountGuestBody") }}</p>
        </div>
        <RouterLink
          :to="{ name: 'login' }"
          class="inline-flex min-h-8 items-center justify-center rounded-lg bg-accent px-3 text-sm font-semibold text-white no-underline transition duration-200 hover:bg-accent-deep"
        >
          {{ t("menuLogin") }}
        </RouterLink>
      </section>

      <!-- 表单 -->
      <section v-else-if="isAccountSession(session)" class="grid max-w-md gap-5" :aria-label="t('accountProfile')">
        <div class="flex items-start gap-4">
          <div class="flex shrink-0 flex-col items-center gap-1.5">
            <button
              type="button"
              class="rounded-lg outline-none transition duration-200 focus-visible:ring-2 focus-visible:ring-accent/30 disabled:opacity-50"
              :disabled="busy || avatarBusy || signingOut"
              :aria-label="t('accountAvatarPick')"
              @click="avatarInput?.click()"
            >
              <UserAvatar :name="session.nickname" :avatar-url="session.avatarUrl" size="lg" />
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
              :disabled="busy || avatarBusy || signingOut"
              @click="avatarInput?.click()"
            >
              <ImagePlusIcon class="size-3.5" aria-hidden="true" />
              {{ session.avatarUrl ? t("accountAvatarChange") : t("accountAvatarPick") }}
            </button>
          </div>
          <p class="m-0 pt-1 text-xs leading-snug text-muted-foreground">
            {{ t("accountAvatarHint") }}
            <span v-if="avatarBusy" class="text-foreground">{{ t("saving") }}</span>
          </p>
        </div>

        <label class="grid gap-1.5 text-sm font-medium text-foreground">
          {{ t("accountEmail") }}
          <input
            type="email"
            :value="session.email"
            readonly
            class="min-h-8 rounded-lg border border-rule bg-muted px-3 text-sm text-muted-foreground outline-none"
          />
          <span class="font-normal text-xs text-muted-foreground">{{ t("accountEmailHint") }}</span>
        </label>

        <label class="grid gap-1.5 text-sm font-medium text-foreground">
          {{ t("accountNickname") }}
          <input
            v-model="nickname"
            type="text"
            maxlength="64"
            autocomplete="nickname"
            :disabled="busy || avatarBusy || signingOut"
            class="min-h-8 rounded-lg border border-rule bg-paper px-3 text-sm outline-none transition duration-200 focus:border-accent focus:bg-background focus:ring-2 focus:ring-accent/15 disabled:opacity-60"
            @blur="commitNickname"
            @keydown.enter.prevent="commitNickname"
          />
          <span class="font-normal text-xs leading-snug text-muted-foreground">
            {{ t("accountNicknameHint") }}
            <span v-if="busy" class="text-foreground">{{ t("saving") }}</span>
          </span>
        </label>

        <div class="grid justify-items-start gap-1.5 border-t border-rule pt-5">
          <button
            type="button"
            class="inline-flex min-h-8 items-center justify-center rounded-lg border border-rule px-3 text-sm font-medium text-destructive transition duration-200 hover:bg-danger-soft disabled:opacity-50"
            :disabled="busy || avatarBusy || signingOut"
            @click="signOut"
          >
            {{ t("accountLogout") }}
          </button>
          <p class="m-0 text-xs leading-snug text-muted-foreground">{{ t("accountLogoutHint") }}</p>
        </div>
      </section>
    </div>
  </main>
</template>
