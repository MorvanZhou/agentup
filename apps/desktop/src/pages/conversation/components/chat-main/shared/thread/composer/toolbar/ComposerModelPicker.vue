<script setup lang="ts">
import { CheckIcon, ChevronDownIcon, SettingsIcon } from "@lucide/vue";
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { RouterLink } from "vue-router";

import ProviderLogo from "../../../../../../../../shared/components/ProviderLogo.vue";
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

function close(): void {
  open.value = false;
}

function onSelect(model: SessionModelOption): void {
  emit("select", model);
  close();
}

function onDocPointer(event: PointerEvent): void {
  if (!open.value || !rootRef.value) return;
  if (rootRef.value.contains(event.target as Node)) return;
  close();
}

watch(open, (value) => {
  if (value) document.addEventListener("pointerdown", onDocPointer, true);
  else document.removeEventListener("pointerdown", onDocPointer, true);
});
onBeforeUnmount(() => document.removeEventListener("pointerdown", onDocPointer, true));
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

    <!-- 模型菜单：列表可滚 · 底部恒显设置入口 -->
    <div
      v-if="open && hasModels"
      class="absolute bottom-full right-0 z-20 mb-1 flex max-h-72 min-w-[18rem] flex-col overflow-hidden rounded-xl border border-rule bg-paper shadow-sm"
    >
      <ul class="m-0 list-none overflow-auto p-1.5" role="listbox">
        <li v-for="model in models" :key="`${model.templateId}::${model.modelId}`" class="m-0 p-0">
          <button
            type="button"
            class="flex w-full items-center gap-2.5 rounded-lg border-0 px-2.5 py-2.5 text-left transition duration-150"
            :class="
              isSelected(model)
                ? 'bg-muted text-foreground'
                : 'bg-transparent text-foreground hover:bg-muted/70'
            "
            role="option"
            :aria-selected="isSelected(model)"
            @click="onSelect(model)"
          >
            <ProviderLogo
              size="md"
              :vendor-id="model.vendorId"
              :label="model.vendorLabel"
            />
            <!-- 同显示名（如 Cursor Auto）时靠 modelId 区分 -->
            <span class="min-w-0 flex-1">
              <span class="block truncate text-sm font-medium">{{ model.name }}</span>
              <span
                v-if="model.modelId !== model.name"
                class="mt-0.5 block truncate font-mono text-xs text-muted-foreground"
              >
                {{ model.modelId }}
              </span>
            </span>
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
</template>
