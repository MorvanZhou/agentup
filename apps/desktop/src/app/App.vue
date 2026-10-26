<script setup lang="ts">
import { RouterView } from "vue-router";

import AppToast from "../shared/components/AppToast.vue";
import { setToastOpen, toastState } from "../shared/model/ui/toast";
import AuthPromptOverlay from "./AuthPromptOverlay.vue";
import { provideDesktop } from "./desktop";

provideDesktop();
</script>

<template>
  <!-- 路由出口 -->
  <RouterView />
  <!-- 需账号能力闸门叠层 -->
  <AuthPromptOverlay />
  <!-- 全局提示 -->
  <AppToast
    :open="toastState.open"
    :message="toastState.message"
    :tone="toastState.tone"
    :duration="toastState.duration"
    @update:open="setToastOpen"
  />
</template>
