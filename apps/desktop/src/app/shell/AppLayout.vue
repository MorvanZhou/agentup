<script setup lang="ts">
import { computed } from "vue";
import { RouterView } from "vue-router";

import { useDesktop } from "../desktop";
import AppNav from "./AppNav.vue";
import AppUserMenu from "./AppUserMenu.vue";

const electron = navigator.userAgent.includes("Electron");
const { session } = useDesktop();
/** 会话页按用户缓存；切到市场 / Agents / 设置时不销毁，进行中的 stream 可接回。 */
const conversationCacheKey = computed(() => `conversation:${session.value?.userId ?? "anon"}`);
</script>

<template>
  <div
    class="grid h-dvh min-h-0 overflow-hidden bg-paper max-[729px]:grid-rows-[auto_minmax(0,1fr)]"
    :class="[
      { electron },
      electron
        ? 'min-[730px]:grid-cols-[72px_minmax(0,1fr)]'
        : 'min-[730px]:grid-cols-[3.5rem_minmax(0,1fr)]',
    ]"
  >
    <!-- 应用导航轨：头像 + 主导航 + 底部设置（勿把整列设为 app-drag，子级 no-drag 在打包 Electron 里不可靠） -->
    <aside
      class="flex shrink-0 bg-ink text-shell-foreground max-[729px]:h-12 max-[729px]:items-center max-[729px]:gap-4 max-[729px]:px-2 min-[730px]:w-full min-[730px]:flex-col min-[730px]:items-center min-[730px]:gap-4.5 min-[730px]:px-0 min-[730px]:pb-3"
      :class="electron ? 'max-[729px]:pl-20' : 'max-[729px]:pt-0 min-[730px]:pt-3'"
    >
      <!-- Electron：仅红绿灯下方一条可拖，可点控件放在 drag 祖先之外 -->
      <div
        v-if="electron"
        class="app-drag hidden w-full shrink-0 min-[730px]:block"
        :style="{ height: 'var(--app-titlebar-inset)' }"
        aria-hidden="true"
      />
      <div class="app-no-drag shrink-0 max-[729px]:order-first">
        <AppUserMenu />
      </div>
      <AppNav class="app-no-drag min-w-0 min-[730px]:min-h-0" />
    </aside>

    <!-- 主区：各页面自带侧栏与内容 -->
    <div class="min-h-0 min-w-0 overflow-hidden">
      <RouterView v-slot="{ Component, route }">
        <KeepAlive :include="['ConversationPage']">
          <component
            :is="Component"
            :key="route.name === 'conversation' ? conversationCacheKey : route.fullPath"
          />
        </KeepAlive>
      </RouterView>
    </div>
  </div>
</template>
