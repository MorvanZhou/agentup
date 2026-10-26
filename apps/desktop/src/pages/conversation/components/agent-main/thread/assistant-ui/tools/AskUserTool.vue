<script setup lang="ts">
import { computed } from "vue";
import { MessageCircleQuestionIcon } from "@lucide/vue";

import { t, tf } from "../../../../../../../shared/model/ui/ui-locale";
import { summarizeAskUserTool } from "../../../../../model/message/ask-user-summary";
import ShimmerTitle from "../parts/ShimmerTitle.vue";
import { useToolPart } from "./useToolPart";

const {
  args,
  resultText,
  hasResult,
  isActive,
  isError,
  isCancelled,
  isInterrupted,
  awaitingAskUser,
  duration,
} = useToolPart();

const summary = computed(() =>
  summarizeAskUserTool(args.value, hasResult.value ? resultText.value : undefined),
);

const terminated = computed(
  () =>
    isInterrupted.value ||
    isCancelled.value ||
    (summary.value.cancelled &&
      /中断|终止|interrupted|stopped|cancelled/i.test(summary.value.rows[0]?.answerLabel ?? "")),
);

const detail = computed(() => {
  const rows = summary.value.rows;
  if (awaitingAskUser.value) return t("askWaiting");
  if (terminated.value) return t("toolTerminated");
  if (summary.value.cancelled) {
    return summary.value.rows[0]?.answerLabel === t("askInterrupted") ||
      summary.value.rows[0]?.answerLabel === "已中断"
      ? t("toolTerminated")
      : t("askAbandoned");
  }
  if (rows.length === 0) return isActive.value ? t("askGenerating") : "";
  if (isActive.value && !hasResult.value) {
    return rows.length === 1 ? rows[0]!.question : tf("askQuestionCount", { n: rows.length });
  }
  if (isError.value) return t("delegateFailed");
  if (rows.length === 1) return rows[0]!.answerLabel;
  const answered = rows.filter((row) => row.status === "answered").length;
  return tf("askAnsweredCount", { answered, total: rows.length });
});

/**
 * 底栏提问时消息内不再重复列题，只保留「AskUser · 等待回答…」一行；
 * 答完 / 中断后再展开摘要。
 */
const showList = computed(
  () => summary.value.rows.length > 0 && !awaitingAskUser.value,
);

function rowAnswerLabel(label: string): string {
  if (terminated.value) return t("toolTerminated");
  if (label === t("askInterrupted") || label === "已中断") return t("toolTerminated");
  return label;
}
</script>

<template>
  <!-- ask_user 工具卡：答完后仅作次要摘要，轻量一行一题 -->
  <div
    class="border-border/60 bg-background/60 w-full max-w-full overflow-hidden rounded-lg border"
  >
    <div class="text-foreground flex w-full min-w-0 items-center gap-2 px-2.5 py-1.5 text-sm">
      <MessageCircleQuestionIcon
        class="text-muted-foreground size-3.5 shrink-0"
        aria-hidden="true"
      />
      <ShimmerTitle :active="isActive && !terminated" title="AskUser" :detail="detail" />
      <span
        v-if="duration !== undefined && !isActive"
        class="text-muted-foreground shrink-0 text-xs tabular-nums"
      >
        {{ duration }}
      </span>
    </div>

    <ul
      v-if="showList"
      class="border-border/60 m-0 list-none space-y-0.5 border-t px-2.5 py-1.5"
    >
      <li
        v-for="row in summary.rows"
        :key="row.index"
        class="min-w-0 truncate text-xs leading-snug text-muted-foreground"
        :title="`${row.question} → ${rowAnswerLabel(row.answerLabel)}`"
      >
        <span class="text-foreground/65">{{ row.question }}</span>
        <span class="mx-1 opacity-50">·</span>
        <span>{{ rowAnswerLabel(row.answerLabel) }}</span>
      </li>
    </ul>
  </div>
</template>
