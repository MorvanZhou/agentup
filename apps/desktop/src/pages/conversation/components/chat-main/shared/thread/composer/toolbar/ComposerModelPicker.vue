<script setup lang="ts">
import { CheckIcon, ChevronDownIcon, SettingsIcon } from "@lucide/vue";
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { RouterLink } from "vue-router";

import ProviderLogo from "../../../../../../../../shared/components/ProviderLogo.vue";
import { formatTokenWindow } from "../../../../../../../../shared/lib/format-tokens";
import { modelSourceLabel } from "../../../../../../../../shared/model/provider/model-source-label";
import type {
  ProviderModelRef,
  SessionModelOption,
} from "../../../../../../../../shared/model/runtime/runtime";
import { t } from "../../../../../../../../shared/model/ui/ui-locale";

const props = defineProps<{
  models: SessionModelOption[];
  currentLabel: string;
  /** 当前会话模型 ref，触发器 logo / 勾选态用它对齐 */
  current?: ProviderModelRef | null;
  disabled?: boolean;
  busy?: boolean;
}>();

const emit = defineEmits<{
  select: [model: SessionModelOption];
}>();

const open = ref(false);
const rootRef = ref<HTMLElement | null>(null);
/** 整块菜单壳：二级面板相对它绝对定位，贴着 hover 行 */
const menuShellRef = ref<HTMLElement | null>(null);
/** 主列表 hover 行；接入 / ctx 等收进左侧二级面板 */
const hoveredKey = ref<string | null>(null);
/** 当前 hover 行 DOM，滚动时重算侧栏 top */
const hoveredAnchor = ref<HTMLElement | null>(null);
/** 二级面板相对菜单壳顶边的偏移，对齐到 hover 行 */
const detailTop = ref(0);
/** 移向侧栏时会短暂离开壳的布局盒，延迟清 hover 避免闪关 */
let leaveTimer: ReturnType<typeof setTimeout> | null = null;

const hasModels = computed(() => props.models.length > 0);

/** 触发器上展示当前项的供应商 logo */
const currentModel = computed(() => {
  const selected = props.current;
  if (!selected) return null;
  return (
    props.models.find(
      (model) => model.templateId === selected.templateId && model.modelId === selected.modelId,
    ) ?? null
  );
});

const hoveredModel = computed(() => {
  const key = hoveredKey.value;
  if (!key) return null;
  return props.models.find((model) => modelKey(model) === key) ?? null;
});

function modelKey(model: SessionModelOption): string {
  return `${model.templateId}::${model.modelId}`;
}

function isSelected(model: SessionModelOption): boolean {
  const selected = props.current;
  if (!selected) return false;
  return model.templateId === selected.templateId && model.modelId === selected.modelId;
}

/** 参考下拉：右侧倍率统一两位小数 + x */
function creditsLabel(credits: number): string {
  return `${credits.toFixed(2)}x`;
}

function toggle(): void {
  if (props.disabled || props.busy || !hasModels.value) return;
  open.value = !open.value;
}

function cancelLeaveTimer(): void {
  if (!leaveTimer) return;
  clearTimeout(leaveTimer);
  leaveTimer = null;
}

function clearHover(): void {
  cancelLeaveTimer();
  hoveredKey.value = null;
  hoveredAnchor.value = null;
  detailTop.value = 0;
}

function close(): void {
  open.value = false;
  clearHover();
}

function onSelect(model: SessionModelOption): void {
  emit("select", model);
  close();
}

/** 侧栏 top 跟 hover 行对齐；列表滚动后也要重算 */
function syncDetailTop(anchor: HTMLElement | null = hoveredAnchor.value): void {
  const shell = menuShellRef.value;
  if (!shell || !anchor) return;
  const shellBox = shell.getBoundingClientRect();
  const anchorBox = anchor.getBoundingClientRect();
  detailTop.value = Math.max(0, anchorBox.top - shellBox.top);
}

function onOptionEnter(model: SessionModelOption, event: Event): void {
  const el = event.currentTarget;
  if (!(el instanceof HTMLElement)) return;
  hoveredKey.value = modelKey(model);
  hoveredAnchor.value = el;
  syncDetailTop(el);
}

function onListScroll(): void {
  syncDetailTop();
}

function onMenuEnter(): void {
  cancelLeaveTimer();
}

function onMenuLeave(): void {
  cancelLeaveTimer();
  // 侧栏在壳外绝对定位，指针穿过间距时先 leave 再 enter 侧栏
  leaveTimer = setTimeout(() => {
    leaveTimer = null;
    clearHover();
  }, 120);
}

function onDocPointer(event: PointerEvent): void {
  if (!open.value || !rootRef.value) return;
  if (rootRef.value.contains(event.target as Node)) return;
  close();
}

watch(open, (value) => {
  if (value) document.addEventListener("pointerdown", onDocPointer, true);
  else {
    document.removeEventListener("pointerdown", onDocPointer, true);
    clearHover();
  }
});
onBeforeUnmount(() => {
  cancelLeaveTimer();
  document.removeEventListener("pointerdown", onDocPointer, true);
});
</script>

<template>
  <div ref="rootRef" class="relative">
    <button
      v-if="hasModels"
      type="button"
      class="flex min-h-8 max-w-[14rem] items-center gap-1.5 rounded-lg border border-rule bg-paper px-2 py-1 text-xs font-medium text-foreground transition duration-200 hover:bg-muted disabled:opacity-40"
      :disabled="disabled || busy"
      :aria-expanded="open"
      :aria-label="t('composerModelPickerAria')"
      @click="toggle"
    >
      <ProviderLogo
        v-if="currentModel"
        size="sm"
        :vendor-id="currentModel.vendorId"
        :label="currentModel.vendorLabel"
      />
      <span class="truncate">{{ currentLabel || t("composerModelPick") }}</span>
      <ChevronDownIcon class="size-3.5 shrink-0 text-muted-foreground" />
    </button>
    <RouterLink
      v-else
      :to="{ name: 'settings', query: { section: 'provider' } }"
      class="inline-flex min-h-8 items-center rounded-lg border border-rule bg-paper px-2.5 text-xs font-medium text-muted-foreground no-underline transition duration-200 hover:text-foreground"
    >
      {{ t("composerModelSetup") }}
    </RouterLink>

    <!-- 模型菜单：右锚主列表；二级详情绝对定位对齐 hover 行 -->
    <div
      v-if="open && hasModels"
      ref="menuShellRef"
      class="absolute bottom-full right-0 z-20 mb-1"
      @mouseenter="onMenuEnter"
      @mouseleave="onMenuLeave"
    >
      <!-- 二级详情：贴在当前行左侧，top 随行变；自身 enter 取消关面板 -->
      <div
        v-if="hoveredModel"
        class="absolute right-full top-0 mr-1.5 w-52 rounded-xl border border-rule bg-paper p-3 shadow-sm"
        :style="{ top: `${detailTop}px` }"
        data-model-detail
        @mouseenter="onMenuEnter"
      >
        <p class="m-0 truncate text-sm font-medium text-foreground">{{ hoveredModel.name }}</p>
        <dl class="m-0 mt-2.5 space-y-2">
          <div class="flex items-baseline justify-between gap-3">
            <dt class="shrink-0 text-xs text-muted-foreground">
              {{ t("composerModelDetailSource") }}
            </dt>
            <dd class="m-0 min-w-0 truncate text-right text-xs text-foreground">
              {{ modelSourceLabel(hoveredModel) }}
            </dd>
          </div>
          <div
            v-if="hoveredModel.contextWindow !== undefined"
            class="flex items-baseline justify-between gap-3"
          >
            <dt class="shrink-0 text-xs text-muted-foreground">
              {{ t("composerModelDetailContext") }}
            </dt>
            <dd
              class="m-0 tabular-nums text-right text-xs text-foreground"
              :title="t('providerModelContextHint')"
            >
              {{ formatTokenWindow(hoveredModel.contextWindow) }}
            </dd>
          </div>
          <div
            v-if="hoveredModel.credits !== undefined"
            class="flex items-baseline justify-between gap-3"
          >
            <dt class="shrink-0 text-xs text-muted-foreground">
              {{ t("composerModelDetailCredits") }}
            </dt>
            <dd
              class="m-0 tabular-nums text-right text-xs text-foreground"
              :title="t('providerModelCreditsHint')"
            >
              {{ creditsLabel(hoveredModel.credits) }}
            </dd>
          </div>
        </dl>
      </div>

      <!-- 主列表：单行 icon · 名 · 倍率 · 勾 -->
      <div
        class="flex max-h-72 min-w-[15rem] flex-col overflow-hidden rounded-xl border border-rule bg-paper shadow-sm"
      >
        <ul
          class="m-0 list-none overflow-auto p-1.5"
          role="listbox"
          @scroll="onListScroll"
        >
          <li v-for="model in models" :key="modelKey(model)" class="m-0 p-0">
            <button
              type="button"
              class="flex w-full items-center gap-2.5 rounded-lg border-0 px-2.5 py-2 text-left transition duration-150"
              :class="
                isSelected(model)
                  ? 'bg-muted text-foreground'
                  : 'bg-transparent text-foreground hover:bg-muted/70'
              "
              role="option"
              :aria-selected="isSelected(model)"
              @click="onSelect(model)"
              @mouseenter="onOptionEnter(model, $event)"
              @focus="onOptionEnter(model, $event)"
            >
              <ProviderLogo
                size="md"
                :vendor-id="model.vendorId"
                :label="model.vendorLabel"
              />
              <span class="min-w-0 flex-1 truncate text-sm font-medium">{{ model.name }}</span>
              <!-- credit 倍率：本地 App 才有；0 也要显示 -->
              <span
                v-if="model.credits !== undefined"
                class="shrink-0 tabular-nums text-xs text-muted-foreground"
                :title="t('providerModelCreditsHint')"
              >
                {{ creditsLabel(model.credits) }}
              </span>
              <span class="grid size-4 shrink-0 place-items-center">
                <CheckIcon
                  v-if="isSelected(model)"
                  class="size-4 text-success-foreground"
                  aria-hidden="true"
                />
              </span>
            </button>
          </li>
        </ul>
        <!-- 次要入口：疑惑模型从哪来 / 怎么启用时跳到 Provider 设置 -->
        <div class="shrink-0 border-t border-rule px-1.5 py-1">
          <RouterLink
            :to="{ name: 'settings', query: { section: 'provider' } }"
            class="flex min-h-8 w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs text-muted-foreground no-underline transition duration-150 hover:bg-muted/70 hover:text-foreground"
            @click="close"
          >
            <SettingsIcon class="size-3.5 shrink-0" aria-hidden="true" />
            <span class="truncate">{{ t("composerModelManageSettings") }}</span>
          </RouterLink>
        </div>
      </div>
    </div>
  </div>
</template>
