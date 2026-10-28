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
import { computed, ref, watch } from "vue";

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

/** 下拉只放「允许」以外的更长范围；主按钮固定「允许一次」。 */
const extraScopes = computed(() =>
  (summary.value?.scopes ?? []).filter((option) => option.scope !== "once"),
);

function decide(allow: boolean, scope: ApprovalScope = "once"): void {
  emit("decide", allow, allow ? scope : undefined);
}
</script>

<template>
  <!-- 审批底栏：不允许 + 允许；命令的更长范围收进允许旁下拉 -->
  <section
    v-if="approval && summary"
    class="shrink-0 border-t border-border bg-paper animate-rise motion-reduce:animate-none"
    role="region"
    :aria-labelledby="`approval-title-${approval.id}`"
  >
    <div class="mx-auto w-full px-3 py-2">
      <!-- 页头：标题与主操作同一行 -->
      <header class="flex min-w-0 items-center gap-2">
        <HitlAgentFace
          v-if="approval.askedByName"
          :name="approval.askedByName"
          :agent-id="approval.askedByAgentId"
        />
        <span
          v-else
          class="grid size-7 shrink-0 place-items-center rounded-lg bg-accent/10 text-accent"
          aria-hidden="true"
        >
          <component :is="kindIcon" class="size-3.5" />
        </span>
        <div class="min-w-0 flex-1">
          <!-- 子代理：谁 + 类型同一行；任务原文不占审批条 -->
          <p
            v-if="approval.askedByName"
            class="mb-0 truncate text-xs"
            :title="`${approval.askedByName} · ${kindLabel}`"
          >
            <span class="font-medium text-accent">{{ approval.askedByName }}</span>
            <span class="text-muted-foreground"> · {{ kindLabel }}</span>
          </p>
          <p v-else class="mb-0 text-xs font-medium tracking-wider text-accent">
            {{ kindLabel }}
          </p>
          <h2
            :id="`approval-title-${approval.id}`"
            class="truncate text-sm font-semibold tracking-tight text-foreground"
            :title="summary.description"
          >
            {{ summary.title }}
          </h2>
          <p
            v-if="(approval.queueBehind ?? 0) > 0"
            class="mb-0 mt-0.5 text-xs text-muted-foreground"
          >
            {{ tf("hitlQueueBehind", { n: approval.queueBehind ?? 0 }) }}
          </p>
          <p class="sr-only">{{ summary.description }}</p>
        </div>
        <div class="flex shrink-0 items-center gap-1.5">
          <button
            type="button"
            class="inline-flex h-8 min-w-[4.5rem] cursor-pointer items-center justify-center rounded-lg border border-rule px-3 text-sm text-muted-foreground transition duration-200 hover:bg-paper-deep hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/30"
            @click="decide(false)"
          >
            {{ t("approvalDeny") }}
          </button>
          <div class="flex overflow-hidden rounded-lg">
            <button
              type="button"
              class="inline-flex h-8 min-w-[4.5rem] cursor-pointer items-center justify-center bg-accent px-3 text-sm font-semibold text-white transition duration-200 hover:bg-accent-deep focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/30"
              :class="extraScopes.length > 0 ? 'rounded-l-lg' : 'rounded-lg'"
              @click="decide(true, 'once')"
            >
              {{ t("approvalAllow") }}
            </button>
            <DropdownMenuRoot v-if="extraScopes.length > 0" v-model:open="scopeMenuOpen">
              <DropdownMenuTrigger
                class="app-no-drag inline-flex h-8 w-8 cursor-pointer items-center justify-center border-l border-white/20 bg-accent text-white transition duration-200 hover:bg-accent-deep focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/30"
                :aria-label="t('approvalMore')"
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
      </header>

      <!-- 目标；技术详情按需展开 -->
      <div class="mt-1.5 flex min-w-0 items-center gap-2 pl-9">
        <p
          class="mb-0 min-w-0 flex-1 truncate text-xs leading-snug text-foreground"
          :class="summary.command ? 'font-mono' : ''"
          :title="summary.target"
        >
          {{ summary.target }}
        </p>
        <button
          type="button"
          class="shrink-0 cursor-pointer text-xs font-medium text-muted-foreground transition duration-200 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/30"
          :aria-expanded="detailsOpen"
          :aria-controls="`approval-details-${approval.id}`"
          @click="detailsOpen = !detailsOpen"
        >
          {{ detailsOpen ? t("approvalHideDetails") : t("approvalDetails") }}
        </button>
      </div>

      <pre
        v-if="detailsOpen"
        :id="`approval-details-${approval.id}`"
        class="mt-1.5 mb-0 ml-9 max-h-24 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-paper-deep p-2 font-mono text-xs text-muted-foreground"
      >{{ JSON.stringify(approval.args, null, 2) }}</pre>
    </div>
  </section>
</template>
