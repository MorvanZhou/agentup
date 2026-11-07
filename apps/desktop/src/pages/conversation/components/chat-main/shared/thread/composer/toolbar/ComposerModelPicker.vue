<script setup lang="ts">
import { CheckIcon, ChevronDownIcon, ChevronLeftIcon, SettingsIcon, UserIcon } from "@lucide/vue";
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { RouterLink } from "vue-router";

import ProviderLogo from "../../../../../../../../shared/components/ProviderLogo.vue";
import { formatTokenWindow } from "../../../../../../../../shared/lib/format-tokens";
import { modelSourceLabel } from "../../../../../../../../shared/model/provider/model-source-label";
import type {
  ModelAssignmentMode,
  ProviderModelRef,
  SessionModelOption,
} from "../../../../../../../../shared/model/runtime/runtime";
import { t } from "../../../../../../../../shared/model/ui/ui-locale";

const props = withDefaults(defineProps<{
  models: SessionModelOption[];
  currentLabel: string;
  /** 群统一写在供应商标前面，例如「共用」；一对一留空，标仍在名字左侧 */
  labelPrefix?: string;
  /** 当前会话模型 ref，触发器 logo / 勾选态用它对齐 */
  current?: ProviderModelRef | null;
  disabled?: boolean;
  busy?: boolean;
  /** 统一：菜单直接选模型。群的单配先选人再选他的一对一模型。 */
  mode?: ModelAssignmentMode;
  /** 群的底部是「全员 / 各用各的」；一对一是派出跟不跟。 */
  scope?: "direct" | "group";
  /** 群单配不挂某一个供应商的 logo，触发器改叠成员的供应商标。 */
  showLogo?: boolean;
  members?: ReadonlyArray<{ id: string; name: string; avatarUrl?: string }>;
  /** 当前接话的人，成员列表上做标记。 */
  speakerId?: string;
  memberModels?: Record<string, { templateId: string; modelId: string; name: string }>;
}>(), {
  // 布尔缺省会被当成 false；没传时仍显示供应商标，群单配由调用方显式关掉
  showLogo: true,
});

const emit = defineEmits<{
  select: [model: SessionModelOption];
  "select-member": [agentId: string, model: SessionModelOption];
  "set-mode": [mode: ModelAssignmentMode];
}>();

const open = ref(false);
/** 群单配：点进某个成员后再出模型列表。 */
const editingMemberId = ref<string | null>(null);
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
const assignmentMode = computed<ModelAssignmentMode>(() => props.mode ?? "unified");
/** 分段开关用短词；下面一句把当前这一侧说完整。 */
const modeCaption = computed(() => {
  const group = props.scope === "group";
  if (assignmentMode.value === "perAgent") {
    return group ? t("composerModelPrivateShared") : t("composerModelFollowOwn");
  }
  return group ? t("composerModelRoomCaption") : t("composerModelFollowSpeaker");
});
const memberRows = computed(() => props.members ?? []);
/** 一对一单配只有当前这位是真人；群单配列出全部成员。 */
const rosterRows = computed(() => {
  if (props.scope !== "direct") return memberRows.value;
  const member = memberRows.value[0];
  return [
    {
      id: member?.id || "self",
      name: member?.name || t("composerModelThisAgent"),
      avatarUrl: member?.avatarUrl,
    },
  ];
});
/** 群的单配先列成员。一对一单配用同一套名单，但只放当前这位。 */
const showingMembers = computed(
  () =>
    assignmentMode.value === "perAgent" &&
    !editingMemberId.value &&
    (props.scope === "direct" || memberRows.value.length > 0),
);
const editingMember = computed(
  () => rosterRows.value.find((member) => member.id === editingMemberId.value) ?? null,
);

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

function memberModel(agentId: string): { templateId: string; modelId: string; name: string } | null {
  const stored = props.memberModels?.[agentId] ?? null;
  if (stored) return stored;
  // 一对一没有群花名册，当前这位的模型就是本会话选中的那份。
  if (props.scope === "direct" && props.current?.templateId && props.current.modelId) {
    return {
      templateId: props.current.templateId,
      modelId: props.current.modelId,
      name: props.currentLabel,
    };
  }
  return null;
}

/** 成员当前模型对应的供应商标；目录里对不上时用模型名做字母占位。 */
const memberProviders = computed(() => {
  const map: Record<string, { key: string; vendorId: string; vendorLabel: string }> = {};
  for (const member of rosterRows.value) {
    const picked = memberModel(member.id);
    if (!picked) continue;
    const option = props.models.find(
      (model) => model.templateId === picked.templateId && model.modelId === picked.modelId,
    );
    const vendorId = option?.vendorId ?? "";
    map[member.id] = {
      key: vendorId || `${picked.templateId}::${picked.modelId}`,
      vendorId,
      vendorLabel: option?.vendorLabel || picked.name,
    };
  }
  return map;
});
/** 发送按钮旁的「各用各的」上叠不同厂商，同一厂商只留一枚。 */
const stackedProviderMarks = computed(() => {
  const seen = new Set<string>();
  const marks: { key: string; vendorId: string; vendorLabel: string }[] = [];
  for (const member of memberRows.value) {
    const mark = memberProviders.value[member.id];
    if (!mark || seen.has(mark.key)) continue;
    seen.add(mark.key);
    marks.push(mark);
    if (marks.length >= 4) break;
  }
  return marks;
});

function isSelected(model: SessionModelOption): boolean {
  const selected = editingMember.value ? memberModel(editingMember.value.id) : props.current;
  if (!selected?.templateId || !selected.modelId) return false;
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
  editingMemberId.value = null;
  clearHover();
}

function onSetMode(mode: ModelAssignmentMode): void {
  if (props.disabled || props.busy || mode === assignmentMode.value) return;
  editingMemberId.value = null;
  emit("set-mode", mode);
}

function onSelect(model: SessionModelOption): void {
  const member = editingMember.value;
  if (member && props.scope !== "direct") {
    emit("select-member", member.id, model);
    // 群单配还要改其他人，选完回到成员列表，不收起菜单。
    editingMemberId.value = null;
    clearHover();
    return;
  }
  if (member) {
    emit("select", model);
    // 一对一只改当前这位，选完回到名单，示意行仍留着。
    editingMemberId.value = null;
    clearHover();
    return;
  }
  emit("select", model);
  close();
}

function openMember(agentId: string): void {
  editingMemberId.value = agentId;
  clearHover();
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
  <div ref="rootRef" class="flex items-center gap-1.5">
    <div class="relative">
    <button
      v-if="hasModels"
      type="button"
      class="flex min-h-8 max-w-[14rem] items-center gap-1.5 rounded-lg border border-rule bg-paper px-2 py-1 text-xs font-medium text-foreground transition duration-200 hover:bg-muted disabled:opacity-40"
      :disabled="disabled || busy"
      :aria-expanded="open"
      :aria-label="t('composerModelPickerAria')"
      @click="toggle"
    >
      <span v-if="labelPrefix" class="shrink-0" data-model-prefix>{{ labelPrefix }}</span>
      <ProviderLogo
        v-if="showLogo !== false && currentModel"
        size="sm"
        :vendor-id="currentModel.vendorId"
        :label="currentModel.vendorLabel"
      />
      <!-- 群单配：供应商标叠在「各用各的」前面。圆形衬底盖住下层标，描边让重叠处分开 -->
      <span
        v-if="scope !== 'direct' && assignmentMode === 'perAgent' && stackedProviderMarks.length"
        class="inline-flex shrink-0 items-center"
        data-member-providers
        aria-hidden="true"
      >
        <span
          v-for="(mark, index) in stackedProviderMarks"
          :key="mark.key"
          class="relative grid size-5 shrink-0 place-items-center rounded-full bg-muted ring-2 ring-paper"
          :class="index > 0 ? '-ml-1.5' : ''"
          :style="{ zIndex: index + 1 }"
        >
          <ProviderLogo
            class="scale-[0.7]"
            size="sm"
            :vendor-id="mark.vendorId"
            :label="mark.vendorLabel"
          />
        </span>
      </span>
      <span class="truncate" data-model-name>{{ currentLabel || t("composerModelPick") }}</span>
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
        v-if="hoveredModel && !showingMembers"
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

      <!-- 上：分配开关。中：名单或模型，占满剩余高度。下：设置 -->
      <div
        class="flex max-h-140 w-72 flex-col overflow-hidden rounded-xl border border-rule bg-paper shadow-sm"
      >
        <div class="shrink-0 border-b border-rule px-2.5 pb-2 pt-2.5">
          <div
            class="flex rounded-lg border border-rule bg-background p-0.5"
            role="group"
            :aria-label="t('composerModelModeAria')"
          >
            <button
              type="button"
              class="min-h-7 flex-1 rounded-md px-2 text-center text-xs transition duration-150 disabled:opacity-40"
              :class="
                assignmentMode === 'unified'
                  ? 'bg-muted font-medium text-foreground'
                  : 'text-muted-foreground hover:text-foreground'
              "
              data-model-mode="unified"
              :aria-pressed="assignmentMode === 'unified'"
              :disabled="disabled || busy"
              @click="onSetMode('unified')"
            >
              {{ t("composerModelEveryone") }}
            </button>
            <button
              type="button"
              class="min-h-7 flex-1 rounded-md px-2 text-center text-xs transition duration-150 disabled:opacity-40"
              :class="
                assignmentMode === 'perAgent'
                  ? 'bg-muted font-medium text-foreground'
                  : 'text-muted-foreground hover:text-foreground'
              "
              data-model-mode="perAgent"
              :aria-pressed="assignmentMode === 'perAgent'"
              :disabled="disabled || busy"
              @click="onSetMode('perAgent')"
            >
              {{ t("composerModelEach") }}
            </button>
          </div>
          <p
            class="m-0 mt-1.5 line-clamp-2 text-xs leading-4 text-muted-foreground"
            data-model-mode-caption
            :data-model-private="assignmentMode === 'perAgent' ? 'true' : undefined"
          >
            {{ modeCaption }}
          </p>
        </div>
        <!-- 群单配：从成员再进他的一对一模型 -->
        <button
          v-if="editingMember"
          type="button"
          class="flex min-h-8 w-full shrink-0 items-center gap-1.5 border-b border-rule px-2.5 text-left text-xs text-muted-foreground hover:text-foreground"
          data-model-back
          :aria-label="t('composerModelMemberBack')"
          @click="editingMemberId = null"
        >
          <ChevronLeftIcon class="size-3.5 shrink-0" aria-hidden="true" />
          <span class="truncate">{{ editingMember.name }}</span>
        </button>
        <ul
          v-if="showingMembers"
          class="m-0 min-h-0 flex-1 list-none overflow-auto p-1.5"
          role="listbox"
          :aria-label="t('composerModelEach')"
        >
          <li v-for="member in rosterRows" :key="member.id" class="m-0 p-0">
            <button
              type="button"
              class="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left hover:bg-muted/70"
              role="option"
              :data-member-id="member.id"
              :data-speaking="member.id === speakerId ? 'true' : 'false'"
              @click="openMember(member.id)"
            >
              <img
                v-if="member.avatarUrl"
                :src="member.avatarUrl"
                alt=""
                class="size-6 shrink-0 rounded-full object-cover"
              />
              <span
                v-else
                class="grid size-6 shrink-0 place-items-center rounded-full bg-muted text-xs text-muted-foreground"
                aria-hidden="true"
              >{{ member.name.slice(0, 1) }}</span>
              <span class="flex min-w-0 flex-1 items-center gap-1.5">
                <span class="truncate text-sm font-medium">{{ member.name }}</span>
                <span
                  v-if="member.id === speakerId"
                  class="shrink-0 rounded-md bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground"
                >{{ t("composerModelMemberSpeaking") }}</span>
              </span>
              <!-- 模型名左侧是他当前模型的供应商标 -->
              <span
                class="flex w-28 shrink-0 items-center justify-end gap-1 text-xs text-muted-foreground"
                data-member-model
              >
                <ProviderLogo
                  v-if="memberProviders[member.id]"
                  size="sm"
                  :vendor-id="memberProviders[member.id]!.vendorId"
                  :label="memberProviders[member.id]!.vendorLabel"
                />
                <span class="truncate">{{ memberModel(member.id)?.name || t("composerModelPick") }}</span>
              </span>
            </button>
          </li>
          <!-- 一对一不知道会派给谁，用一行不可点的示意代替其他人 -->
          <li v-if="scope === 'direct'" class="m-0 p-0" data-member-placeholder>
            <div
              class="flex w-full cursor-default items-center gap-2.5 rounded-lg px-2.5 py-2 text-left opacity-45"
              aria-hidden="true"
            >
              <span class="grid size-6 shrink-0 place-items-center rounded-full bg-muted text-muted-foreground">
                <UserIcon class="size-3.5" />
              </span>
              <span class="min-w-0 flex-1 truncate text-sm font-medium">{{
                t("composerModelDelegateePlaceholder")
              }}</span>
              <span class="w-28 shrink-0 truncate text-right text-xs text-muted-foreground">{{
                t("composerModelDelegateeOwn")
              }}</span>
            </div>
          </li>
        </ul>
        <ul
          v-else
          class="m-0 min-h-0 flex-1 list-none overflow-auto p-1.5"
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
  </div>
</template>
