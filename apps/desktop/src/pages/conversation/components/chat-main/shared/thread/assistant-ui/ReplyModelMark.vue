<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from "vue";

import ProviderLogo from "../../../../../../../shared/components/ProviderLogo.vue";
import { tf } from "../../../../../../../shared/model/ui/ui-locale";
import {
  replyModelDisplayName,
  type AgentUpReplyModel,
} from "../../../../../model/message/message-reply-model";

const props = defineProps<{
  model: AgentUpReplyModel;
}>();

/** hover 或点按后展开模型名；点按再切一次收起（触控友好）。 */
const pinned = ref(false);
const hovering = ref(false);

/** 只展示模型名，不展示 modelId。 */
const label = computed(() => replyModelDisplayName(props.model));
const expanded = computed(() => pinned.value || hovering.value);
const aria = computed(() =>
  tf("msgReplyModel", { model: label.value || props.model.modelId }),
);

function onEnter() {
  hovering.value = true;
}
function onLeave() {
  hovering.value = false;
}
function onClick() {
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
  <!--
    次要标形：默认只看 icon；hover/点按后在 icon 左侧展开模型名。
    用 grid 0fr→1fr 收放，避免 max-width 动画时缺 nowrap 被压成竖排。
  -->
  <button
    type="button"
    class="group/reply-model inline-flex shrink-0 items-center justify-end gap-1 rounded-md border-0 bg-transparent p-0 text-muted-foreground outline-none transition-colors hover:text-foreground/70 focus-visible:ring-2 focus-visible:ring-accent/30"
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
