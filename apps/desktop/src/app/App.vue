<script setup lang="ts">
import { RouterView } from "vue-router";

import AppToast from "../shared/components/AppToast.vue";
import { setToastOpen, toastState } from "../shared/model/ui/toast";
import AuthPromptOverlay from "./auth/AuthPromptOverlay.vue";
import BrowserLoginWait from "./auth/BrowserLoginWait.vue";
import { provideDesktop } from "./desktop";
import AppUpdateBanner from "./native/AppUpdateBanner.vue";
import { bindAppUpdateListener } from "./native/app-update";

provideDesktop();
// 系统菜单「检查更新」与 4 小时静默轮询共用
bindAppUpdateListener();
</script>

<template>
  <!-- 路由出口 -->
  <RouterView />
  <!-- 需账号能力闸门叠层 -->
  <AuthPromptOverlay />
  <!-- 菜单 / 账号设置直接打开 Web 登录后的等待 -->
  <BrowserLoginWait />
  <!-- 有新版本时左下角提示下载安装包 -->
  <AppUpdateBanner />
  <!-- 全局提示 -->
  <AppToast
    :open="toastState.open"
    :message="toastState.message"
    :tone="toastState.tone"
    :duration="toastState.duration"
    @update:open="setToastOpen"
  />
</template>
