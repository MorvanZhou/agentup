<script setup lang="ts">
import { computed } from "vue";

import { providerMarkSvg } from "../model/provider/provider-marks";

const props = withDefaults(
  defineProps<{
    /** runtime 模板的稳定厂商 id；按模型品牌解析标形 */
    vendorId?: string | null;
    /** 缺图时用于取首字母（优先展示名） */
    label?: string | null;
    /** 与列表行对齐：sm 触发器 / md 下拉行 / lg 卡片头 */
    size?: "sm" | "md" | "lg";
  }>(),
  { size: "md" },
);

/**
 * 参考模型下拉：裸标、单色 currentColor，不要色底磁贴。
 * 尺寸只控标形本身，背景透明，靠行选中态提亮。
 */
const SIZE = {
  sm: "size-4 text-[10px]",
  md: "size-5 text-xs",
  lg: "size-6 text-sm",
} as const;

const svg = computed(() => providerMarkSvg(props.vendorId));
const known = computed(() => Boolean(svg.value));

const initial = computed(() => {
  const source = (props.label ?? props.vendorId ?? "?").trim();
  return ([...source][0] ?? "?").toUpperCase();
});
</script>

<template>
  <!-- 模型单色标：统一前景色，列表/下拉里一眼认形 -->
  <span
    class="provider-logo inline-grid shrink-0 place-items-center text-foreground"
    :class="SIZE[size]"
    aria-hidden="true"
  >
    <span
      v-if="known && svg"
      class="provider-logo__mark grid size-full place-items-center"
      v-html="svg"
    />
    <span
      v-else
      class="grid size-full place-items-center rounded-full bg-muted font-semibold leading-none text-muted-foreground"
    >
      {{ initial }}
    </span>
  </span>
</template>

<style scoped>
.provider-logo__mark :deep(svg) {
  display: block;
  width: 100%;
  height: 100%;
}
</style>
