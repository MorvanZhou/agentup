<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";

import AgentAvatar from "../../../../../../../../shared/components/avatar/AgentAvatar.vue";
import type { CaretClientRect } from "../toolbar/ComposerSkillInput.vue";
import { t } from "../../../../../../../../shared/model/ui/ui-locale";

type Mention = { id: string; name: string; role?: string; avatarUrl?: string };

const props = defineProps<{
  members: readonly Mention[];
  highlight: number;
  anchor?: CaretClientRect | null;
}>();

const emit = defineEmits<{
  select: [member: Mention];
  close: [];
}>();

const panelRef = ref<HTMLElement | null>(null);
const panelStyle = ref<Record<string, string>>({
  position: "fixed",
  left: "0px",
  top: "0px",
  visibility: "hidden",
});

function place(): void {
  const el = panelRef.value;
  if (!el) return;
  const pad = 8;
  const gap = 6;
  const width = Math.min(el.offsetWidth || 280, window.innerWidth - pad * 2);
  const height = el.offsetHeight || 100;
  let left = props.anchor?.x ?? pad;
  let top = (props.anchor?.y ?? pad) - height - gap;
  if (top < pad) top = (props.anchor?.bottom ?? pad) + gap;
  panelStyle.value = {
    position: "fixed",
    left: `${Math.round(Math.max(pad, Math.min(left, window.innerWidth - width - pad)))}px`,
    top: `${Math.round(Math.max(pad, Math.min(top, window.innerHeight - height - pad)))}px`,
    width: `${Math.round(width)}px`,
    zIndex: "80",
    visibility: "visible",
  };
}

function closeOnOutside(event: PointerEvent): void {
  if (!panelRef.value?.contains(event.target as Node | null)) emit("close");
}

watch(
  () => [props.anchor?.x, props.anchor?.y, props.anchor?.bottom, props.members.length],
  () => void nextTick(place),
);
onMounted(() => {
  void nextTick(place);
  window.addEventListener("resize", place);
  window.addEventListener("scroll", place, true);
  document.addEventListener("pointerdown", closeOnOutside, true);
});
onBeforeUnmount(() => {
  window.removeEventListener("resize", place);
  window.removeEventListener("scroll", place, true);
  document.removeEventListener("pointerdown", closeOnOutside, true);
});
</script>

<template>
  <Teleport to="body">
    <div
      ref="panelRef"
      class="max-h-56 w-72 max-w-[calc(100vw-1rem)] overflow-y-auto rounded-lg border border-rule bg-paper py-1 shadow-md"
      role="listbox"
      :aria-label="t('groupMentionPicker')"
      :style="panelStyle"
    >
      <p v-if="!members.length" class="m-0 px-3 py-2 text-xs text-muted-foreground" role="status">
        {{ t("groupMentionEmpty") }}
      </p>
      <button
        v-for="(member, index) in members"
        :key="member.id"
        type="button"
        role="option"
        class="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm transition duration-200"
        :class="index === highlight ? 'bg-paper-deep text-foreground' : 'text-foreground hover:bg-paper-deep/70'"
        :aria-selected="index === highlight"
        @mousedown.prevent="emit('select', member)"
      >
        <AgentAvatar
          :name="member.name"
          :avatar-url="member.avatarUrl"
          size="sm"
          round
        />
        <span class="min-w-0 flex-1">
          <span class="block truncate font-medium">@{{ member.name }}</span>
          <span v-if="member.role" class="mt-0.5 block truncate text-xs text-muted-foreground">
            {{ member.role }}
          </span>
        </span>
      </button>
    </div>
  </Teleport>
</template>
