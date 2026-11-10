<script setup lang="ts">
import { computed, ref, watch } from "vue";
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  ExternalLinkIcon,
  RefreshCwIcon,
  XIcon,
} from "@lucide/vue";

import { showToast } from "../../../../../../shared/model/ui/toast";
import { t } from "../../../../../../shared/model/ui/ui-locale";
import type { AgentUpPreviewRecipe } from "../../../../model/message/message-preview";
import {
  canEmbedPreviewInIframe,
  createPreviewNavHistory,
  normalizePreviewAddress,
  previewNavBack,
  previewNavCanGoBack,
  previewNavCanGoForward,
  previewNavCurrent,
  previewNavForward,
  previewNavPush,
  type PreviewNavHistory,
} from "../../../../model/message/preview-nav-history";

const props = defineProps<{
  recipe: AgentUpPreviewRecipe | null;
  open: boolean;
  busy?: boolean;
}>();

const emit = defineEmits<{
  close: [];
}>();

const frameEl = ref<HTMLIFrameElement | null>(null);
/** 自管导航栈：决定后退/前进是否可点，并驱动 iframe src。 */
const nav = ref<PreviewNavHistory>(createPreviewNavHistory("about:blank"));
const addressDraft = ref("");
/** 本面板主动改 src（后退/前进/地址栏/刷新）时，load 只同步草稿，不压栈。 */
let ownedNavigation = false;

const frameKey = computed(() => props.recipe?.id ?? "");
const frameSrc = computed(() => previewNavCurrent(nav.value));
const canGoBack = computed(() => previewNavCanGoBack(nav.value));
const canGoForward = computed(() => previewNavCanGoForward(nav.value));

function resetNav(url: string): void {
  // 配方若误给外站，内嵌仍落 about:blank，避免一打开就被拒嵌。
  const embedUrl = canEmbedPreviewInIframe(url) ? url : "about:blank";
  nav.value = createPreviewNavHistory(embedUrl);
  addressDraft.value = canEmbedPreviewInIframe(url) ? previewNavCurrent(nav.value) : url;
  ownedNavigation = true;
}

watch(
  () =>
    props.open && props.recipe
      ? { id: props.recipe.id, url: props.recipe.preview_url }
      : null,
  (next) => {
    if (!next) return;
    resetNav(next.url);
  },
  { immediate: true },
);

function applyFrameSrc(url: string): void {
  ownedNavigation = true;
  addressDraft.value = url;
  if (frameEl.value) frameEl.value.src = url;
}

function restoreAddressToFrame(): void {
  addressDraft.value = previewNavCurrent(nav.value);
}

async function openInSystemBrowser(url: string): Promise<boolean> {
  const open = window.agentUp?.openExternal;
  if (!open) {
    showToast(t("msgPreviewOpenExternalFailed"), "error");
    return false;
  }
  try {
    await open(url);
    showToast(t("msgPreviewOpenedExternal"), "success");
    return true;
  } catch {
    showToast(t("msgPreviewOpenExternalFailed"), "error");
    return false;
  }
}

function onClose(): void {
  emit("close");
}

function onReload(): void {
  if (!frameEl.value || !props.recipe) return;
  applyFrameSrc(previewNavCurrent(nav.value));
}

function onBack(): void {
  if (!canGoBack.value) return;
  nav.value = previewNavBack(nav.value);
  applyFrameSrc(previewNavCurrent(nav.value));
}

function onForward(): void {
  if (!canGoForward.value) return;
  nav.value = previewNavForward(nav.value);
  applyFrameSrc(previewNavCurrent(nav.value));
}

/** 地址栏旁：把当前草稿（或帧内页）交系统浏览器。 */
async function onOpenExternal(): Promise<void> {
  const raw = normalizePreviewAddress(addressDraft.value) || previewNavCurrent(nav.value);
  if (!raw || raw.startsWith("about:")) return;
  await openInSystemBrowser(raw);
}

/**
 * 地址栏回车：本机压栈进 iframe；外站降级 openExternal，不污染导航栈。
 */
async function onAddressSubmit(): Promise<void> {
  const next = normalizePreviewAddress(addressDraft.value);
  if (!next) {
    restoreAddressToFrame();
    return;
  }
  if (!canEmbedPreviewInIframe(next)) {
    // 先收回地址栏，避免等待系统浏览器时草稿仍停在外站
    restoreAddressToFrame();
    await openInSystemBrowser(next);
    return;
  }
  nav.value = previewNavPush(nav.value, next);
  applyFrameSrc(previewNavCurrent(nav.value));
}

function onAddressKeydown(event: KeyboardEvent): void {
  if (event.key !== "Enter") return;
  event.preventDefault();
  void onAddressSubmit();
}

/**
 * 同域页内跳转可读 location；跨域只能保留自管栈。
 * 主动导航的 load 不压栈，避免后退再被当成新条目。
 * 若同域竟跳到外站，降级系统浏览器并回到上一本机条目。
 */
function onFrameLoad(): void {
  try {
    const href = frameEl.value?.contentWindow?.location.href;
    if (href) {
      if (!canEmbedPreviewInIframe(href)) {
        void openInSystemBrowser(href);
        applyFrameSrc(previewNavCurrent(nav.value));
        return;
      }
      if (!ownedNavigation) {
        nav.value = previewNavPush(nav.value, href);
      }
      addressDraft.value = href;
    } else {
      restoreAddressToFrame();
    }
  } catch {
    restoreAddressToFrame();
  } finally {
    ownedNavigation = false;
  }
}
</script>

<template>
  <!-- 复用右侧工作区栏位：与 WorkspacePanel 同槽，h-full 填满 -->
  <aside
    v-if="open && recipe"
    class="flex h-full min-h-0 w-full flex-col border-l border-rule/70 bg-background"
    :aria-label="t('msgPreviewPanel')"
  >
    <!-- Chrome 布局壳：本机 iframe；外站 / 拒嵌路径走系统浏览器 -->
    <header
      class="flex min-h-10 shrink-0 items-center gap-1.5 border-b border-rule/60 bg-paper px-2 select-none"
    >
      <!-- 浏览器导航钮：无历史栈时禁用 -->
      <div class="flex shrink-0 items-center gap-0.5">
        <button
          type="button"
          class="inline-flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-accent/30 disabled:pointer-events-none disabled:opacity-40"
          :aria-label="t('msgPreviewBack')"
          :disabled="busy || !canGoBack"
          @click="onBack"
        >
          <ArrowLeftIcon class="size-3.5" aria-hidden="true" />
        </button>
        <button
          type="button"
          class="inline-flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-accent/30 disabled:pointer-events-none disabled:opacity-40"
          :aria-label="t('msgPreviewForward')"
          :disabled="busy || !canGoForward"
          @click="onForward"
        >
          <ArrowRightIcon class="size-3.5" aria-hidden="true" />
        </button>
        <button
          type="button"
          class="inline-flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-accent/30 disabled:opacity-40"
          :aria-label="t('msgPreviewReload')"
          :disabled="busy"
          @click="onReload"
        >
          <RefreshCwIcon class="size-3.5" aria-hidden="true" />
        </button>
      </div>
      <!-- 可编辑网址栏：本机回车内嵌；外站回车 openExternal -->
      <div class="flex min-h-7 min-w-0 flex-1 items-center gap-1 rounded-full bg-muted px-3">
        <input
          v-model="addressDraft"
          type="text"
          spellcheck="false"
          autocomplete="off"
          class="app-no-drag min-w-0 flex-1 bg-transparent font-mono text-[11px] leading-none text-foreground outline-none placeholder:text-muted-foreground"
          :aria-label="t('msgPreviewAddress')"
          :disabled="busy"
          @keydown="onAddressKeydown"
        />
        <button
          type="button"
          class="inline-flex size-5 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-paper hover:text-foreground focus-visible:ring-2 focus-visible:ring-accent/30 disabled:opacity-40"
          :aria-label="t('msgPreviewOpenExternal')"
          :disabled="busy"
          @click="onOpenExternal"
        >
          <ExternalLinkIcon class="size-3" aria-hidden="true" />
        </button>
      </div>
      <button
        type="button"
        class="inline-flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-accent/30 disabled:opacity-40"
        :aria-label="t('msgPreviewClose')"
        :disabled="busy"
        @click="onClose"
      >
        <XIcon class="size-3.5" aria-hidden="true" />
      </button>
    </header>
    <iframe
      :key="frameKey"
      ref="frameEl"
      class="min-h-0 w-full flex-1 border-0 bg-white"
      :src="frameSrc"
      :title="recipe.title"
      @load="onFrameLoad"
    />
  </aside>
</template>
