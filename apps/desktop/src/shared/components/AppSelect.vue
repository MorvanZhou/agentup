<script setup lang="ts">
import { CheckIcon, ChevronDownIcon } from "@lucide/vue";
import { computed, onBeforeUnmount, ref, useId, watch } from "vue";

import ProviderLogo from "./ProviderLogo.vue";

export type AppSelectOption = {
  value: string;
  label: string;
  /** 已配置并生效等状态；菜单与触发器显示绿点 */
  active?: boolean;
  /** 分组名：同名的连续项归为一组，菜单里渲染分组标题（如「API Key 接入」） */
  group?: string;
  /** 选项右侧的次要说明（如体积、状态） */
  hint?: string;
  /** 供应商 logo：传 vendorId，由 ProviderLogo 解析 */
  icon?: string;
};

const props = defineProps<{
  modelValue: string;
  label: string;
  options: AppSelectOption[];
  disabled?: boolean;
  /** 绿点无障碍说明（如「已配置并生效」） */
  activeHint?: string;
}>();

const emit = defineEmits<{ "update:modelValue": [value: string] }>();

const open = ref(false);
const rootRef = ref<HTMLElement | null>(null);
const labelId = useId();

const selected = computed(
  () => props.options.find((item) => item.value === props.modelValue) ?? null,
);

/** 按 group 切段；没写 group 的项归到同一段，保持原有平铺行为 */
const sections = computed(() => {
  const out: Array<{ group: string | null; items: AppSelectOption[] }> = [];
  for (const option of props.options) {
    const last = out[out.length - 1];
    if (last && last.group === (option.group ?? null)) last.items.push(option);
    else out.push({ group: option.group ?? null, items: [option] });
  }
  return out;
});

function toggle(): void {
  if (props.disabled) return;
  open.value = !open.value;
}

function select(value: string): void {
  emit("update:modelValue", value);
  open.value = false;
}

function onDocPointer(event: PointerEvent): void {
  if (!open.value || !rootRef.value) return;
  if (rootRef.value.contains(event.target as Node)) return;
  open.value = false;
}

watch(open, (value) => {
  if (value) document.addEventListener("pointerdown", onDocPointer, true);
  else document.removeEventListener("pointerdown", onDocPointer, true);
});
onBeforeUnmount(() => document.removeEventListener("pointerdown", onDocPointer, true));
</script>

<template>
  <!-- 勿用包裹型 label：点选项会二次激活触发钮，菜单关了又开 -->
  <div class="grid gap-1.5 text-sm font-medium text-foreground">
    <span :id="labelId">{{ label }}</span>
    <div ref="rootRef" class="relative">
      <button
        type="button"
        :disabled="disabled"
        :aria-expanded="open"
        :aria-haspopup="true"
        :aria-labelledby="labelId"
        class="flex min-h-9 w-full min-w-0 items-center gap-2.5 rounded-lg border border-rule bg-paper px-2.5 py-1.5 text-left text-sm font-normal text-foreground outline-none transition duration-200 hover:bg-background focus:border-accent focus:bg-background focus:ring-2 focus:ring-accent/15 disabled:opacity-60"
        @click="toggle"
      >
        <span
          v-if="selected?.active"
          class="size-1.5 shrink-0 rounded-full bg-emerald-500"
          :aria-label="activeHint"
          :title="activeHint"
        />
        <ProviderLogo
          v-if="selected?.icon"
          size="sm"
          :vendor-id="selected.icon"
          :label="selected.label"
        />
        <span class="min-w-0 flex-1 truncate">{{ selected?.label ?? "" }}</span>
        <ChevronDownIcon
          class="size-3.5 shrink-0 text-muted-foreground transition duration-200"
          :class="open && 'rotate-180'"
          aria-hidden="true"
        />
      </button>

      <ul
        v-if="open"
        class="absolute left-0 right-0 z-20 mt-1 max-h-64 list-none overflow-auto rounded-xl border border-rule bg-background p-1.5 shadow-sm"
        role="listbox"
      >
        <template v-for="(section, index) in sections" :key="index">
          <!-- 分组标题：只做视觉分组，不可选 -->
          <li
            v-if="section.group"
            class="m-0 px-2 pb-0.5 pt-1.5 text-xs font-medium tracking-wider text-muted-foreground"
            role="presentation"
          >
            {{ section.group }}
          </li>
          <li v-for="option in section.items" :key="option.value" class="m-0 p-0">
            <button
              type="button"
              role="option"
              :aria-selected="option.value === modelValue"
              :aria-label="
                option.active && activeHint ? `${option.label}, ${activeHint}` : undefined
              "
              :title="option.active ? activeHint : undefined"
              class="flex w-full items-center gap-2.5 rounded-lg border-0 px-2.5 py-2.5 text-left text-sm transition duration-150"
              :class="
                option.value === modelValue
                  ? 'bg-muted text-foreground'
                  : 'bg-transparent text-foreground hover:bg-muted/70'
              "
              @click.stop="select(option.value)"
            >
              <span
                class="size-1.5 shrink-0 rounded-full"
                :class="option.active ? 'bg-emerald-500' : 'bg-transparent'"
                aria-hidden="true"
              />
              <ProviderLogo
                v-if="option.icon"
                size="md"
                :vendor-id="option.icon"
                :label="option.label"
              />
              <span class="min-w-0 flex-1 truncate font-medium">{{ option.label }}</span>
              <span v-if="option.hint" class="shrink-0 text-xs text-muted-foreground">
                {{ option.hint }}
              </span>
              <span class="grid size-4 shrink-0 place-items-center">
                <CheckIcon
                  v-if="option.value === modelValue"
                  class="size-4 text-success-foreground"
                  aria-hidden="true"
                />
              </span>
            </button>
          </li>
        </template>
      </ul>
    </div>
  </div>
</template>
