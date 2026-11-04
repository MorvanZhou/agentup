<script setup lang="ts">
import { CheckIcon, ChevronDownIcon, SearchIcon } from "@lucide/vue";
import { computed, nextTick, onBeforeUnmount, ref, useId, watch } from "vue";

import {
  resolveMenuPlacement,
  type MenuPlacement,
} from "../model/ui/menu-placement";
import ProviderLogo from "./ProviderLogo.vue";

export type AppSelectOption = {
  value: string;
  label: string;
  /** 已配置并生效等状态；菜单与触发器显示绿点 */
  active?: boolean;
  /** 分组名：同名的连续项归为一组；cascade 时左侧按组切换 */
  group?: string;
  /** 选项右侧的次要说明（如体积、状态） */
  hint?: string;
  /** 供应商 logo：传 vendorId，由 ProviderLogo 解析 */
  icon?: string;
};

const props = withDefaults(
  defineProps<{
    modelValue: string;
    label: string;
    options: AppSelectOption[];
    disabled?: boolean;
    /** 绿点无障碍说明（如「已配置并生效」） */
    activeHint?: string;
    /**
     * 级联：左选 group（接入方式），右选该组选项（接入商）。
     * 仍用 modelValue 表示右侧选中的 value。
     */
    cascade?: boolean;
    /** 级联时左侧标签（如「接入方式」） */
    groupLabel?: string;
    /** 级联时空值 / 未匹配时优先落到的分组名 */
    defaultGroup?: string;
    /**
     * 可选：打开菜单后显示搜索框（默认关）。
     * 级联时只作用在右侧接入商列表，左侧接入方式不搜。
     */
    searchable?: boolean;
    /** 搜索框占位；searchable 时由调用方传入 i18n */
    searchPlaceholder?: string;
    /** 无匹配时的提示文案 */
    searchEmpty?: string;
  }>(),
  {
    searchable: false,
  },
);

const emit = defineEmits<{ "update:modelValue": [value: string] }>();

const open = ref(false);
/** 级联时左右各自开合，互斥，避免两个菜单叠开 */
const openSide = ref<"group" | "item" | null>(null);
const rootRef = ref<HTMLElement | null>(null);
const singleTriggerRef = ref<HTMLButtonElement | null>(null);
const groupTriggerRef = ref<HTMLButtonElement | null>(null);
const itemTriggerRef = ref<HTMLButtonElement | null>(null);
const searchInputRef = ref<HTMLInputElement | null>(null);
const labelId = useId();
const groupLabelId = useId();
const searchInputId = useId();

/** 打开菜单后的过滤关键字；关闭时清空 */
const query = ref("");

/** 打开时按视口算翻转与限高；默认往下、256px */
const menuLayout = ref<MenuPlacement>({ placement: "below", maxHeightPx: 256 });

const menuShellClass = computed(() => [
  "absolute left-0 z-20 flex min-w-full w-max max-w-[min(20rem,calc(100vw-2rem))] flex-col overflow-hidden rounded-xl border border-rule bg-background shadow-sm",
  menuLayout.value.placement === "below" ? "top-full mt-1" : "bottom-full mb-1",
]);

const menuPanelStyle = computed(() => ({
  maxHeight: `${Math.max(0, menuLayout.value.maxHeightPx)}px`,
}));

const selected = computed(
  () => props.options.find((item) => item.value === props.modelValue) ?? null,
);

const normalizedQuery = computed(() => query.value.trim().toLowerCase());

function optionMatches(option: AppSelectOption): boolean {
  const needle = normalizedQuery.value;
  if (!needle) return true;
  const haystack = [option.label, option.value, option.hint ?? "", option.group ?? ""]
    .join("\0")
    .toLowerCase();
  return haystack.includes(needle);
}

/** 按出现顺序去重的分组名（只收有 group 的项） */
const groupNames = computed(() => {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const option of props.options) {
    const group = option.group?.trim();
    if (!group || seen.has(group)) continue;
    seen.add(group);
    out.push(group);
  }
  return out;
});

/**
 * 当前接入方式。优先跟已选 value 的 group；否则 defaultGroup；再否则第一组。
 * 用 ref + watch 同步，避免切组时立刻被 modelValue 旧值拽回去。
 */
const selectedGroup = ref<string>("");

function resolveGroup(modelValue: string, groups: string[]): string {
  const fromValue = props.options.find((item) => item.value === modelValue)?.group?.trim();
  if (fromValue && groups.includes(fromValue)) return fromValue;
  const preferred = props.defaultGroup?.trim();
  if (preferred && groups.includes(preferred)) return preferred;
  return groups[0] ?? "";
}

watch(
  () => [props.modelValue, groupNames.value, props.defaultGroup, props.cascade] as const,
  ([modelValue, groups]) => {
    if (!props.cascade) return;
    selectedGroup.value = resolveGroup(modelValue, groups);
  },
  { immediate: true },
);

/** 级联右侧：当前接入方式下的接入商 */
const cascadeItemOptions = computed(() => {
  if (!props.cascade || !selectedGroup.value) return props.options;
  return props.options.filter((item) => (item.group ?? "") === selectedGroup.value);
});

/** 按 group 切段；搜索时先过滤再切段，空组不展示 */
const sections = computed(() => {
  const source = (props.cascade ? cascadeItemOptions.value : props.options).filter(optionMatches);
  const out: Array<{ group: string | null; items: AppSelectOption[] }> = [];
  for (const option of source) {
    // 级联时分组已在左侧，右侧不再重复画标题
    const groupKey = props.cascade ? null : (option.group ?? null);
    const last = out[out.length - 1];
    if (last && last.group === groupKey) last.items.push(option);
    else out.push({ group: groupKey, items: [option] });
  }
  return out;
});

const hasFilteredOptions = computed(() => sections.value.some((section) => section.items.length > 0));

const menuOpen = computed(() => (props.cascade ? openSide.value !== null : open.value));

watch(menuOpen, async (isOpen) => {
  if (!isOpen) {
    query.value = "";
    return;
  }
  // 级联左侧不搜；只在单列或右侧接入商打开时聚焦
  if (!props.searchable) return;
  if (props.cascade && openSide.value === "group") return;
  await nextTick();
  searchInputRef.value?.focus();
});

/** 级联切到右侧时清空关键字并聚焦搜索；左侧不带搜索 */
watch(openSide, async (side, prev) => {
  if (!props.cascade || !props.searchable) return;
  if (!side || side === prev) return;
  query.value = "";
  if (side !== "item") return;
  await nextTick();
  searchInputRef.value?.focus();
});

/** 空值或切组后当前 value 不在右侧时，落到该组第一项 */
watch(
  cascadeItemOptions,
  (items) => {
    if (!props.cascade || props.disabled) return;
    if (!items.length) return;
    if (items.some((item) => item.value === props.modelValue)) return;
    emit("update:modelValue", items[0]!.value);
  },
  { immediate: true },
);

function refreshMenuLayout(trigger: HTMLElement | null): void {
  if (!trigger) {
    menuLayout.value = { placement: "below", maxHeightPx: 256 };
    return;
  }
  const rect = trigger.getBoundingClientRect();
  menuLayout.value = resolveMenuPlacement({
    triggerTop: rect.top,
    triggerBottom: rect.bottom,
    viewportHeight: window.innerHeight,
  });
}

function activeTrigger(): HTMLElement | null {
  if (props.cascade) {
    if (openSide.value === "group") return groupTriggerRef.value;
    if (openSide.value === "item") return itemTriggerRef.value;
    return null;
  }
  return open.value ? singleTriggerRef.value : null;
}

function onViewportChange(): void {
  refreshMenuLayout(activeTrigger());
}

function toggle(): void {
  if (props.disabled) return;
  const next = !open.value;
  if (next) refreshMenuLayout(singleTriggerRef.value);
  open.value = next;
}

function toggleCascade(side: "group" | "item"): void {
  if (props.disabled) return;
  const next = openSide.value === side ? null : side;
  if (next === "group") refreshMenuLayout(groupTriggerRef.value);
  else if (next === "item") refreshMenuLayout(itemTriggerRef.value);
  openSide.value = next;
}

function select(value: string): void {
  emit("update:modelValue", value);
  open.value = false;
  openSide.value = null;
}

function selectGroup(group: string): void {
  selectedGroup.value = group;
  openSide.value = null;
  const first = props.options.find((item) => (item.group ?? "") === group);
  if (first && first.value !== props.modelValue) {
    emit("update:modelValue", first.value);
  }
}

function onDocPointer(event: PointerEvent): void {
  const anyOpen = props.cascade ? openSide.value !== null : open.value;
  if (!anyOpen || !rootRef.value) return;
  if (rootRef.value.contains(event.target as Node)) return;
  open.value = false;
  openSide.value = null;
}

watch(
  () => (props.cascade ? openSide.value !== null : open.value),
  (value) => {
    if (value) {
      document.addEventListener("pointerdown", onDocPointer, true);
      window.addEventListener("resize", onViewportChange);
      // 捕获滚动：设置页主区 overflow 滚动时也要重算
      window.addEventListener("scroll", onViewportChange, true);
    } else {
      document.removeEventListener("pointerdown", onDocPointer, true);
      window.removeEventListener("resize", onViewportChange);
      window.removeEventListener("scroll", onViewportChange, true);
    }
  },
);
onBeforeUnmount(() => {
  document.removeEventListener("pointerdown", onDocPointer, true);
  window.removeEventListener("resize", onViewportChange);
  window.removeEventListener("scroll", onViewportChange, true);
});
</script>

<template>
  <!-- 勿用包裹型 label：点选项会二次激活触发钮，菜单关了又开；min-w-0 避免 grid/flex 被长文案撑破叠层 -->
  <div ref="rootRef" class="min-w-0 text-sm font-medium text-foreground">
    <!-- 级联：左接入方式 · 右接入商 -->
    <div
      v-if="cascade"
      class="grid min-w-0 gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)] sm:items-end"
    >
      <div class="grid min-w-0 gap-1.5">
        <span :id="groupLabelId">{{ groupLabel ?? label }}</span>
        <div class="relative min-w-0">
          <button
            ref="groupTriggerRef"
            type="button"
            :disabled="disabled"
            :aria-expanded="openSide === 'group'"
            :aria-haspopup="true"
            :aria-labelledby="groupLabelId"
            :title="selectedGroup"
            class="flex min-h-9 w-full min-w-0 items-center gap-2.5 rounded-lg border border-rule bg-paper px-2.5 py-1.5 text-left text-sm font-normal text-foreground outline-none transition duration-200 hover:bg-background focus:border-accent focus:bg-background focus:ring-2 focus:ring-accent/15 disabled:opacity-60"
            @click="toggleCascade('group')"
          >
            <span class="min-w-0 flex-1 truncate">{{ selectedGroup }}</span>
            <ChevronDownIcon
              class="size-3.5 shrink-0 text-muted-foreground transition duration-200"
              :class="openSide === 'group' && 'rotate-180'"
              aria-hidden="true"
            />
          </button>
          <!-- 左侧菜单：接入方式（项少，不做搜索） -->
          <div
            v-if="openSide === 'group'"
            :class="menuShellClass"
            :style="menuPanelStyle"
            :data-placement="menuLayout.placement"
          >
            <ul class="m-0 min-h-0 list-none flex-1 overflow-auto p-1.5" role="listbox">
              <li v-for="group in groupNames" :key="group" class="m-0 p-0">
                <button
                  type="button"
                  role="option"
                  :aria-selected="group === selectedGroup"
                  class="flex w-full items-center gap-2.5 rounded-lg border-0 px-2.5 py-2.5 text-left text-sm transition duration-150"
                  :class="
                    group === selectedGroup
                      ? 'bg-muted text-foreground'
                      : 'bg-transparent text-foreground hover:bg-muted/70'
                  "
                  @click.stop="selectGroup(group)"
                >
                  <span class="min-w-0 flex-1 truncate font-medium">{{ group }}</span>
                  <span class="grid size-4 shrink-0 place-items-center">
                    <CheckIcon
                      v-if="group === selectedGroup"
                      class="size-4 text-success-foreground"
                      aria-hidden="true"
                    />
                  </span>
                </button>
              </li>
            </ul>
          </div>
        </div>
      </div>

      <div class="grid min-w-0 gap-1.5">
        <span :id="labelId">{{ label }}</span>
        <div class="relative min-w-0">
          <button
            ref="itemTriggerRef"
            type="button"
            :disabled="disabled"
            :aria-expanded="openSide === 'item'"
            :aria-haspopup="true"
            :aria-labelledby="labelId"
            :title="selected?.label"
            class="flex min-h-9 w-full min-w-0 items-center gap-2.5 rounded-lg border border-rule bg-paper px-2.5 py-1.5 text-left text-sm font-normal text-foreground outline-none transition duration-200 hover:bg-background focus:border-accent focus:bg-background focus:ring-2 focus:ring-accent/15 disabled:opacity-60"
            @click="toggleCascade('item')"
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
              :class="openSide === 'item' && 'rotate-180'"
              aria-hidden="true"
            />
          </button>
          <!-- 右侧菜单：接入商列表（可搜） -->
          <div
            v-if="openSide === 'item'"
            :class="menuShellClass"
            :style="menuPanelStyle"
            :data-placement="menuLayout.placement"
          >
            <div
              v-if="searchable"
              class="shrink-0 border-b border-rule bg-background p-1.5"
              @pointerdown.stop
            >
              <label class="relative block" :for="`${searchInputId}-item`">
                <span class="sr-only">{{ searchPlaceholder }}</span>
                <SearchIcon
                  class="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
                  aria-hidden="true"
                />
                <input
                  :id="`${searchInputId}-item`"
                  ref="searchInputRef"
                  v-model="query"
                  type="search"
                  :placeholder="searchPlaceholder"
                  class="min-h-8 w-full rounded-lg border border-rule bg-paper py-1.5 pl-8 pr-2.5 text-sm font-normal text-foreground outline-none transition duration-200 focus:border-accent focus:bg-background focus:ring-2 focus:ring-accent/15"
                  @keydown.stop
                />
              </label>
            </div>
            <ul class="m-0 min-h-0 list-none flex-1 overflow-auto p-1.5" role="listbox">
              <template v-for="(section, index) in sections" :key="index">
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
            <p
              v-if="searchable && !hasFilteredOptions"
              class="m-0 shrink-0 px-3 py-2.5 text-sm text-muted-foreground"
              role="status"
            >
              {{ searchEmpty }}
            </p>
          </div>
        </div>
      </div>
    </div>

    <!-- 单列：原行为 -->
    <div v-else class="grid min-w-0 gap-1.5">
      <span :id="labelId">{{ label }}</span>
      <div class="relative min-w-0">
        <button
          ref="singleTriggerRef"
          type="button"
          :disabled="disabled"
          :aria-expanded="open"
          :aria-haspopup="true"
          :aria-labelledby="labelId"
          :title="selected?.label"
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

        <!-- 菜单可宽于触发器；贴底时翻到上方并用视口限高 -->
        <div
          v-if="open"
          :class="menuShellClass"
          :style="menuPanelStyle"
          :data-placement="menuLayout.placement"
        >
          <!-- 搜索条：钉在菜单顶，列表在下方滚动 -->
          <div
            v-if="searchable"
            class="shrink-0 border-b border-rule bg-background p-1.5"
            @pointerdown.stop
          >
            <label class="relative block" :for="searchInputId">
              <span class="sr-only">{{ searchPlaceholder }}</span>
              <SearchIcon
                class="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
                aria-hidden="true"
              />
              <input
                :id="searchInputId"
                ref="searchInputRef"
                v-model="query"
                type="search"
                :placeholder="searchPlaceholder"
                class="min-h-8 w-full rounded-lg border border-rule bg-paper py-1.5 pl-8 pr-2.5 text-sm font-normal text-foreground outline-none transition duration-200 focus:border-accent focus:bg-background focus:ring-2 focus:ring-accent/15"
                @keydown.stop
              />
            </label>
          </div>
          <ul class="m-0 min-h-0 list-none flex-1 overflow-auto p-1.5" role="listbox">
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
          <p
            v-if="searchable && !hasFilteredOptions"
            class="m-0 shrink-0 px-3 py-2.5 text-sm text-muted-foreground"
            role="status"
          >
            {{ searchEmpty }}
          </p>
        </div>
      </div>
    </div>
  </div>
</template>
