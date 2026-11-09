<script setup lang="ts">
import {
  TooltipContent,
  TooltipPortal,
  TooltipProvider,
  TooltipRoot,
  TooltipTrigger,
} from "reka-ui";
import { computed, onBeforeUnmount, ref } from "vue";

import ProviderLogo from "../../../../../../../shared/components/ProviderLogo.vue";
import { tf } from "../../../../../../../shared/model/ui/ui-locale";
import {
  replyModelDisplayName,
  type AgentUpReplyModel,
} from "../../../../../model/message/message-reply-model";

const props = withDefaults(
  defineProps<{
    model: AgentUpReplyModel;
    /**
     * expand：hover/点按在 icon 旁展开模型名（宽行）。
     * tip：logo 固定宽度；模型名 Teleport 到浮层，不挤原行。
     */
    reveal?: "expand" | "tip";
  }>(),
  { reveal: "expand" },
);

/** hover 或点按后展开模型名；点按再切一次收起（触控友好）。 */
const pinned = ref(false);
const hovering = ref(false);

/** 只展示模型名，不展示 modelId。 */
const label = computed(() => replyModelDisplayName(props.model));
const tipOnly = computed(() => props.reveal === "tip");
const expanded = computed(() => !tipOnly.value && (pinned.value || hovering.value));
const aria = computed(() =>
  tf("msgReplyModel", { model: label.value || props.model.modelId }),
);

function onEnter() {
  if (tipOnly.value) return;
  hovering.value = true;
}
function onLeave() {
  hovering.value = false;
}
function onClick() {
  if (tipOnly.value) return;
  pinned.value = !pinned.value;
}
function onBlur() {
  // 失焦收起点按态，避免别处点完仍挂着模型名
  pinned.value = false;
}

onBeforeUnmount(() => {
  pinned.value = false;
  hovering.value = false;
});
</script>

<template>
  <!-- tip：浮层说模型名，行内只留 logo，宽度恒定 -->
  <TooltipProvider v-if="tipOnly" :delay-duration="200" :disable-closing-trigger="true">
    <TooltipRoot>
      <TooltipTrigger as-child>
        <button
          type="button"
          class="group/reply-model inline-flex size-4 shrink-0 cursor-default items-center justify-center rounded-md border-0 bg-transparent p-0 text-muted-foreground outline-none transition-colors hover:text-foreground/70 focus-visible:ring-2 focus-visible:ring-accent/30"
          :aria-label="aria"
        >
          <ProviderLogo
            class="!text-muted-foreground opacity-55 transition-opacity group-hover/reply-model:opacity-85 group-hover/reply-model:!text-foreground/70"
            size="sm"
            :vendor-id="model.vendorId"
            :label="label || model.modelId"
          />
        </button>
      </TooltipTrigger>
      <TooltipPortal>
        <TooltipContent
          side="top"
          :side-offset="6"
          :collision-padding="8"
          class="app-no-drag z-[80] max-w-[16rem] rounded-md border border-rule bg-paper px-2 py-1 text-[11px] leading-snug text-foreground shadow-md"
        >
          {{ label || model.modelId }}
        </TooltipContent>
      </TooltipPortal>
    </TooltipRoot>
  </TooltipProvider>

  <!-- expand：默认只看 icon；hover/点按后在 icon 左侧展开模型名 -->
  <button
    v-else
    type="button"
    class="group/reply-model inline-flex shrink-0 cursor-pointer items-center justify-end gap-1 rounded-md border-0 bg-transparent p-0 text-muted-foreground outline-none transition-colors hover:text-foreground/70 focus-visible:ring-2 focus-visible:ring-accent/30"
    :aria-label="aria"
    :aria-expanded="expanded"
    @mouseenter="onEnter"
    @mouseleave="onLeave"
    @focus="onEnter"
    @blur="onBlur"
    @click.stop="onClick"
  >
    <span
      v-if="label"
      class="grid transition-[grid-template-columns] duration-200 ease-out"
      :class="expanded ? 'grid-cols-[1fr]' : 'grid-cols-[0fr]'"
      aria-hidden="true"
    >
      <span class="min-w-0 overflow-hidden">
        <span
          class="block whitespace-nowrap text-[11px] font-normal leading-none text-muted-foreground"
          :class="expanded ? 'opacity-100' : 'opacity-0'"
        >{{ label }}</span>
      </span>
    </span>
    <ProviderLogo
      class="!text-muted-foreground opacity-55 transition-opacity group-hover/reply-model:opacity-85 group-hover/reply-model:!text-foreground/70"
      size="sm"
      :vendor-id="model.vendorId"
      :label="label || model.modelId"
    />
  </button>
</template>
