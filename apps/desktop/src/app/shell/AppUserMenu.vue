<script setup lang="ts">
import { computed, ref } from "vue";
import { useRouter } from "vue-router";
import {
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuPortal,
  DropdownMenuRoot,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "reka-ui";

import UserAvatar from "../../shared/components/avatar/UserAvatar.vue";
import { isGuestSession, sessionDisplayNickname } from "../../shared/model/session/session";
import { t } from "../../shared/model/ui/ui-locale";
import { useDesktop } from "../desktop";

const router = useRouter();
const { session } = useDesktop();
const open = ref(false);
const displayName = computed(() => sessionDisplayNickname(session.value));

function goSettings(): void {
  open.value = false;
  void router.push({ name: "settings", query: { section: "account" } });
}

function goLogin(): void {
  open.value = false;
  const redirect = router.currentRoute.value.fullPath;
  void router.push({
    name: "login",
    query: redirect.startsWith("/") && router.currentRoute.value.name !== "login" ? { redirect } : undefined,
  });
}
</script>

<template>
  <DropdownMenuRoot v-if="session" v-model:open="open">
    <!-- 账号菜单 -->
    <DropdownMenuTrigger
      class="app-no-drag rounded-lg outline-none transition duration-200 hover:opacity-90 focus-visible:ring-2 focus-visible:ring-accent/40"
      :aria-label="`${t('menuAccount')}：${displayName}`"
      >
      <UserAvatar :name="displayName" :avatar-url="session.avatarUrl" size="lg" />
    </DropdownMenuTrigger>
    <DropdownMenuPortal>
      <DropdownMenuContent
        align="start"
        side="right"
        :side-offset="8"
        class="app-no-drag z-50 min-w-40 rounded-lg border border-rule bg-paper p-1 text-foreground shadow-lg"
      >
        <DropdownMenuLabel class="truncate px-2 py-1.5 text-xs text-muted-foreground">
          {{ displayName }}
        </DropdownMenuLabel>
        <DropdownMenuSeparator class="my-1 h-px bg-rule" />
        <DropdownMenuItem
          class="flex min-h-8 cursor-pointer items-center rounded-md px-2 text-sm outline-none data-[highlighted]:bg-paper-deep"
          @select="goSettings"
        >
          {{ t("menuSettings") }}
        </DropdownMenuItem>
        <DropdownMenuItem
          v-if="isGuestSession(session)"
          class="flex min-h-8 cursor-pointer items-center rounded-md px-2 text-sm outline-none data-[highlighted]:bg-paper-deep"
          @select="goLogin"
        >
          {{ t("menuLogin") }}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenuPortal>
  </DropdownMenuRoot>
</template>
