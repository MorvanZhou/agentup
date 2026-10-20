<script setup lang="ts">
import { ArrowLeftIcon } from "@lucide/vue";
import { computed, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";

import { useDesktop } from "../../app/desktop";
import { ensureGuestSession } from "../../app/session-store";
import { isAccountSession, isGuestSession } from "../../shared/model/session";
import { publicUrl } from "../../shared/model/public-url";
import { t, type UiLocale } from "../../shared/model/ui-locale";

const route = useRoute();
const router = useRouter();
const electron = navigator.userAgent.includes("Electron");
const { session, busy, uiLocale, setUiLocale, loginWithBrowser, reopenBrowserLogin, cancelBrowserLogin } =
  useDesktop();
const brandIconUrl = publicUrl("icon.png");

const status = ref("");
/** 用户点了取消：失败回调用空状态，不要写成「未完成登录」。 */
let cancelled = false;

function chooseLocale(next: UiLocale): void {
  void setUiLocale(next);
}

const redirectPath = computed(() => {
  const value = route.query.redirect;
  return typeof value === "string" && value.startsWith("/") ? value : "";
});

/** hook 带入的 redirect，或游客可回主界面；登出后的纯登录页不显示。 */
const showBack = computed(() => Boolean(redirectPath.value) || isGuestSession(session.value));

async function goHomeIfAccount(): Promise<void> {
  if (!isAccountSession(session.value)) return;
  if (redirectPath.value) {
    await router.replace(redirectPath.value);
    return;
  }
  await router.replace({ name: "conversation" });
}

let attempt = 0;

async function continueInBrowser(): Promise<void> {
  if (busy.value) {
    await reopenBrowserLogin();
    return;
  }
  cancelled = false;
  const current = ++attempt;
  status.value = t("loginOpening");
  if (await loginWithBrowser()) {
    if (current !== attempt) return;
    status.value = "";
    await goHomeIfAccount();
    return;
  }
  if (current !== attempt || cancelled) return;
  status.value = t("loginFailed");
}

async function cancelWaiting(): Promise<void> {
  cancelled = true;
  attempt += 1;
  status.value = "";
  await cancelBrowserLogin();
}

async function goBack(): Promise<void> {
  if (redirectPath.value) {
    if (!session.value) await ensureGuestSession();
    await router.replace(redirectPath.value);
    return;
  }
  if (!session.value) await ensureGuestSession();
  await router.replace({ name: "conversation" });
}

onMounted(() => {
  if (isAccountSession(session.value)) {
    void goHomeIfAccount();
    return;
  }
  // 浏览器注册已回跳但上次等待断了：有暂存码则自动换票并回到来时页
  void (async () => {
    const pending = await window.agentUp?.oauthLoopbackPeekPending?.();
    if (!pending?.code || busy.value) return;
    await continueInBrowser();
  })();
});

watch(
  () => session.value,
  (next) => {
    if (isAccountSession(next)) void goHomeIfAccount();
  },
);
</script>

<template>
  <main
    class="relative grid h-dvh place-items-center overflow-auto bg-ink px-4 py-6 text-shell-foreground dark sm:px-6"
    :class="{ 'pt-14': electron }"
  >
    <!-- Electron：顶部拖拽条 -->
    <div v-if="electron" class="app-drag absolute inset-x-0 top-0 z-10 h-12" aria-hidden="true" />
    <!-- 氛围：橙光晕，呼应 logo -->
    <div
      class="pointer-events-none absolute inset-0"
      style="background: radial-gradient(ellipse 70% 45% at 18% 0%, rgb(255 122 26 / 24%), transparent 55%), radial-gradient(ellipse 45% 40% at 92% 100%, rgb(255 122 26 / 10%), transparent 45%)"
    />
    <!-- 语言 -->
    <div
      class="app-no-drag absolute right-3 z-20"
      :class="electron ? 'top-14' : 'top-3'"
    >
      <div class="inline-flex items-center gap-1 text-sm">
        <button
          type="button"
          class="min-h-8 rounded-lg px-2 font-medium transition duration-200"
          :class="uiLocale === 'zh' ? 'text-accent' : 'text-shell-muted hover:text-shell-foreground'"
          :aria-pressed="uiLocale === 'zh'"
          @click="chooseLocale('zh')"
        >
          中文
        </button>
        <span class="text-shell-muted" aria-hidden="true">/</span>
        <button
          type="button"
          class="min-h-8 rounded-lg px-2 font-medium transition duration-200"
          :class="uiLocale === 'en' ? 'text-accent' : 'text-shell-muted hover:text-shell-foreground'"
          :aria-pressed="uiLocale === 'en'"
          @click="chooseLocale('en')"
        >
          EN
        </button>
      </div>
    </div>
    <!-- 返回 -->
    <button
      v-if="showBack"
      type="button"
      class="app-no-drag absolute left-3 z-20 inline-flex min-h-8 items-center gap-1.5 rounded-lg border border-rule bg-paper px-3 text-sm font-semibold text-foreground shadow-sm transition duration-200 hover:bg-paper-deep"
      :class="electron ? 'top-14' : 'top-3'"
      @click="goBack"
    >
      <ArrowLeftIcon class="size-4" aria-hidden="true" />
      {{ t("loginBack") }}
    </button>
    <section class="animate-rise relative w-full max-w-md">
      <!-- 品牌 -->
      <img
        :src="brandIconUrl"
        alt=""
        width="96"
        height="96"
        class="size-24 rounded-[1.5rem] shadow-[0_0_0_1px_rgb(255_255_255/8%)]"
        aria-hidden="true"
      />

      <p class="m-0 mt-5 text-xs font-medium tracking-[0.2em] text-accent">{{ t("loginKicker") }}</p>
      <h1 class="m-0 mt-2 text-3xl font-semibold tracking-tight text-shell-foreground">AgentUp</h1>
      <p class="mb-0 mt-2 text-sm leading-snug text-shell-muted">
        {{ t("loginLead") }}
      </p>
      <!-- 唤起浏览器：奶油卡 -->
      <div class="mt-6 rounded-2xl border border-[#efe6da] bg-[#f7f2ea] p-5 text-[#1a1a1a] shadow-[0_24px_60px_rgb(0_0_0/45%)]">
        <h2 class="m-0 text-sm font-semibold">{{ t("loginCardTitle") }}</h2>
        <p class="mb-0 mt-1 text-sm leading-snug text-[#6b645c]">
          {{ t("loginCardBody") }}
        </p>
        <button
          type="button"
          class="mt-4 min-h-8 w-full rounded-lg bg-accent px-3 text-sm font-semibold text-white transition duration-200 hover:bg-accent-deep"
          @click="continueInBrowser"
        >
          {{ busy ? t("loginReopen") : t("loginCta") }}
        </button>
        <button
          v-if="busy"
          type="button"
          class="mt-2 min-h-8 w-full rounded-lg border border-[#e4dcd0] bg-transparent px-3 text-sm font-semibold text-[#1a1a1a] transition duration-200 hover:bg-[#efe8de]"
          @click="cancelWaiting"
        >
          {{ t("cancel") }}
        </button>
        <p v-if="status" class="mb-0 mt-3 text-xs leading-snug text-[#8a8278]" role="status">
          {{ status }}
        </p>
      </div>
    </section>
  </main>
</template>
