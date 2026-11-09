<script setup lang="ts">
import {
  ChevronDownIcon,
  FilePenLineIcon,
  FolderInputIcon,
  PuzzleIcon,
  TerminalIcon,
} from "@lucide/vue";
import {
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuPortal,
  DropdownMenuRoot,
  DropdownMenuTrigger,
} from "reka-ui";
import { computed, onMounted, onUnmounted, ref, watch } from "vue";

import type { AgentUpApprovalData, ApprovalScope } from "../../../../../../../shared/model/chat/chat";
import { t, tf } from "../../../../../../../shared/model/ui/ui-locale";
import { summarizeApproval, type ApprovalKind } from "../../../../../model/message/approval-summary";
import HitlAgentFace from "./HitlAgentFace.vue";

const props = defineProps<{
  approval?: AgentUpApprovalData;
}>();

const emit = defineEmits<{
  decide: [allow: boolean, scope?: ApprovalScope];
}>();

const summary = computed(() => (props.approval ? summarizeApproval(props.approval) : null));
const detailsOpen = ref(false);
const scopeMenuOpen = ref(false);

watch(
  () => props.approval?.id,
  () => {
    detailsOpen.value = false;
    scopeMenuOpen.value = false;
  },
);

const kindIcon = computed(() => {
  const kind: ApprovalKind | undefined = summary.value?.kind;
  if (kind === "command") return TerminalIcon;
  if (kind === "write") return FilePenLineIcon;
  if (kind === "project") return FolderInputIcon;
  return PuzzleIcon;
});

const kindLabel = computed(() => {
  const kind: ApprovalKind | undefined = summary.value?.kind;
  if (kind === "command") return t("approvalCommand");
  if (kind === "write") return t("approvalWrite");
  if (kind === "project") return t("approvalProject");
  return t("approvalTool");
});

/** 首行标签：子代理时叠名，否则只显示类型。 */
const headerLabel = computed(() => {
  const name = props.approval?.askedByName?.trim();
  return name ? `${name} · ${kindLabel.value}` : kindLabel.value;
});

/** 下拉只放「允许一次」以外的更长范围；主按钮固定 once。 */
const extraScopes = computed(() =>
  (summary.value?.scopes ?? []).filter((option) => option.scope !== "once"),
);

function decide(allow: boolean, scope: ApprovalScope = "once"): void {
  emit("decide", allow, allow ? scope : undefined);
}

/**
 * 捕获阶段抢 Enter/Esc：↵ = 允许一次，Esc = 拒绝。
 * 不避开按钮——否则焦点落在下拉箭头上时 Enter 会打开菜单而不是允许。
 * 范围菜单已打开时交给菜单自己处理。
 */
function onKeydown(event: KeyboardEvent): void {
  if (!props.approval || !summary.value) return;
  if (scopeMenuOpen.value) return;
  if (event.isComposing || event.keyCode === 229) return;

  const target = event.target as HTMLElement | null;
  // 别的模态/列表在前时不抢
  if (target?.closest("[role='dialog'], [role='listbox'], [role='menu'], [role='menuitem']")) {
    return;
  }

  if (event.key === "Escape") {
    event.preventDefault();
    event.stopPropagation();
    // 先收起技术详情，再 Esc 才是拒绝
    if (detailsOpen.value) {
      detailsOpen.value = false;
      return;
    }
    decide(false);
    return;
  }

  if (event.key === "Enter" && !event.shiftKey && !event.metaKey && !event.ctrlKey && !event.altKey) {
    event.preventDefault();
    event.stopPropagation();
    decide(true, "once");
  }
}

onMounted(() => window.addEventListener("keydown", onKeydown, true));
onUnmounted(() => window.removeEventListener("keydown", onKeydown, true));
</script>

<template>
  <!-- 审批底栏：首行 icon/label/title 对齐；下接目标块与操作 -->
  <section
    v-if="approval && summary"
    class="shrink-0 border-t border-rule/80 bg-background animate-rise motion-reduce:animate-none"
    role="region"
    :aria-labelledby="`approval-title-${approval.id}`"
  >
    <div class="mx-auto w-full px-3 py-3">
      <!-- 首行：face/类型图标 + 标签 + 标题 -->
      <header class="flex min-w-0 items-center gap-2">
        <HitlAgentFace
          v-if="approval.askedByName"
          :name="approval.askedByName"
          :agent-id="approval.askedByAgentId"
        />
        <component
          :is="kindIcon"
          v-else
          class="size-4 shrink-0 text-muted-foreground"
          aria-hidden="true"
        />
        <p class="mb-0 shrink-0 text-sm text-muted-foreground">{{ headerLabel }}</p>
        <h2
          :id="`approval-title-${approval.id}`"
          class="mb-0 min-w-0 flex-1 truncate text-sm font-medium text-foreground"
          :title="summary.description"
        >
          {{ summary.title }}
        </h2>
        <p
          v-if="(approval.queueBehind ?? 0) > 0"
          class="mb-0 shrink-0 text-xs text-muted-foreground"
        >
          {{ tf("hitlQueueBehind", { n: approval.queueBehind ?? 0 }) }}
        </p>
      </header>
      <p class="sr-only">{{ summary.description }}</p>
      <p
        v-if="approval.taskLabel"
        class="mb-0 mt-1.5 truncate text-xs text-muted-foreground"
      >
        {{ tf("hitlRelayTask", { label: approval.taskLabel }) }}
      </p>

      <!-- 目标块：命令 / 路径 / 摘要，始终可见 -->
      <pre
        class="mt-2.5 mb-0 max-h-36 overflow-auto whitespace-pre-wrap break-all rounded-xl bg-paper-deep px-3 py-2.5 font-mono text-xs leading-relaxed text-muted-foreground"
      >{{ summary.target }}</pre>
      <pre
        v-if="detailsOpen"
        :id="`approval-details-${approval.id}`"
        class="mt-1.5 mb-0 max-h-24 overflow-auto whitespace-pre-wrap break-all rounded-xl bg-paper-deep px-3 py-2 font-mono text-xs text-muted-foreground"
      >{{ JSON.stringify(approval.args, null, 2) }}</pre>

      <!-- 操作：左技术详情，右 Deny / Allow once；旁挂更长范围 -->
      <div class="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          class="mr-auto shrink-0 cursor-pointer text-xs font-medium text-muted-foreground transition duration-200 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/30"
          :aria-expanded="detailsOpen"
          :aria-controls="`approval-details-${approval.id}`"
          @click="detailsOpen = !detailsOpen"
        >
          {{ detailsOpen ? t("approvalHideDetails") : t("approvalDetails") }}
        </button>
        <button
          type="button"
          class="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-full bg-muted px-3 text-sm text-muted-foreground transition duration-200 hover:bg-paper-deep hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/30"
          @click="decide(false)"
        >
          <span>{{ t("approvalDeny") }}</span>
          <kbd
            class="rounded-md bg-background/70 px-1.5 py-0.5 font-sans text-[10px] font-medium uppercase tracking-wide text-muted-foreground"
          >esc</kbd>
        </button>

        <div class="flex overflow-hidden rounded-full bg-accent text-white shadow-sm">
          <button
            type="button"
            class="inline-flex h-8 cursor-pointer items-center gap-1.5 px-3 text-sm font-semibold transition duration-200 hover:bg-accent-deep focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/30"
            :class="extraScopes.length > 0 ? 'pr-2' : ''"
            @click="decide(true, 'once')"
          >
            <span>{{ t("approvalAllowOnce") }}</span>
            <kbd
              class="rounded-md bg-white/15 px-1.5 py-0.5 font-sans text-[10px] font-medium text-white/90"
              aria-hidden="true"
            >↵</kbd>
          </button>
          <DropdownMenuRoot v-if="extraScopes.length > 0" v-model:open="scopeMenuOpen">
            <DropdownMenuTrigger
              class="app-no-drag inline-flex h-8 w-8 cursor-pointer items-center justify-center border-l border-white/20 transition duration-200 hover:bg-accent-deep focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/30"
              :aria-label="t('approvalMore')"
              @keydown.enter.prevent.stop
            >
              <ChevronDownIcon
                class="size-3.5 transition duration-200"
                :class="scopeMenuOpen ? 'rotate-180' : ''"
                aria-hidden="true"
              />
            </DropdownMenuTrigger>
            <DropdownMenuPortal>
              <DropdownMenuContent
                align="end"
                :side-offset="6"
                class="app-no-drag z-50 min-w-36 rounded-lg border border-rule bg-paper p-1 text-foreground shadow-md"
              >
                <DropdownMenuItem
                  v-for="option in extraScopes"
                  :key="option.scope"
                  class="flex min-h-8 cursor-pointer items-center rounded-md px-2 text-sm outline-none transition duration-200 data-[highlighted]:bg-paper-deep"
                  @select="decide(true, option.scope)"
                >
                  {{ option.label }}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenuPortal>
          </DropdownMenuRoot>
        </div>
      </div>
    </div>
  </section>
</template>
