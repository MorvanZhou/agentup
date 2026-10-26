<script setup lang="ts">
import { ChevronDownIcon } from "@lucide/vue";
import { computed, onBeforeUnmount, ref, useId, watch } from "vue";

export type AppSelectOption = {
  value: string;
  label: string;
  /** 已配置并生效等状态；菜单与触发器显示绿点 */
  active?: boolean;
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
        class="flex min-h-8 w-full min-w-0 items-center gap-2 rounded-lg border border-rule bg-paper px-3 py-1.5 text-left text-sm font-normal text-foreground outline-none transition duration-200 hover:bg-background focus:border-accent focus:bg-background focus:ring-2 focus:ring-accent/15 disabled:opacity-60"
        @click="toggle"
      >
        <span
          v-if="selected?.active"
          class="size-1.5 shrink-0 rounded-full bg-emerald-500"
          :aria-label="activeHint"
          :title="activeHint"
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
        class="absolute left-0 right-0 z-20 mt-1 max-h-56 list-none overflow-auto rounded-lg border border-rule bg-background p-1 shadow-sm"
        role="listbox"
      >
        <li v-for="option in options" :key="option.value" class="m-0 p-0">
          <button
            type="button"
            role="option"
            :aria-selected="option.value === modelValue"
            :aria-label="
              option.active && activeHint ? `${option.label}, ${activeHint}` : undefined
            "
            :title="option.active ? activeHint : undefined"
            class="flex w-full items-center gap-2 rounded-md border-0 bg-transparent px-2 py-1.5 text-left text-sm transition duration-200 hover:bg-paper"
            :class="option.value === modelValue ? 'bg-paper text-foreground' : 'text-foreground'"
            @click.stop="select(option.value)"
          >
            <span
              class="size-1.5 shrink-0 rounded-full"
              :class="option.active ? 'bg-emerald-500' : 'bg-transparent'"
              aria-hidden="true"
            />
            <span class="min-w-0 flex-1 truncate">{{ option.label }}</span>
          </button>
        </li>
      </ul>
    </div>
  </div>
</template>
