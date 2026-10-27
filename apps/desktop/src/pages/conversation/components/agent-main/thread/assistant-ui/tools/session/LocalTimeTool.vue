<script setup lang="ts">
import { computed } from "vue";
import { ClockIcon } from "@lucide/vue";

import { useToolPart } from "../shared/useToolPart";
import ToolCard from "../shared/ToolCard.vue";

const { resultText, hasResult } = useToolPart();

/**
 * runtime `formatLocalTime`：`Local time: ISO (IANA, Weekday)`。
 * 摘要行只留 ISO · 时区；完整结果仍可在展开区查看。
 */
const detail = computed(() => {
  if (!hasResult.value) return "";
  const text = resultText.value.trim();
  const match = text.match(
    /^Local time:\s*(.+?)\s*\(([^,]+),\s*([^)]+)\)\s*$/i,
  );
  if (match) {
    return `${match[1]!.trim()} · ${match[2]!.trim()}`;
  }
  try {
    const parsed = JSON.parse(text) as {
      isoLocal?: unknown;
      timeZone?: unknown;
    };
    if (typeof parsed.isoLocal === "string" && parsed.isoLocal) {
      return typeof parsed.timeZone === "string" && parsed.timeZone
        ? `${parsed.isoLocal} · ${parsed.timeZone}`
        : parsed.isoLocal;
    }
  } catch {
    // 非 JSON
  }
  return text.replace(/^Local time:\s*/i, "").trim() || text;
});
</script>

<template>
  <!-- 本机墙钟：免审批只读工具 -->
  <ToolCard title="LocalTime" :detail="detail" :icon="ClockIcon" />
</template>
