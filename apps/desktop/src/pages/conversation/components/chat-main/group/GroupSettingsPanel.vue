<script setup lang="ts">
import { PenLineIcon } from "@lucide/vue";
import { ref, watch } from "vue";

import { showToast } from "../../../../../shared/model/ui/toast";
import { t } from "../../../../../shared/model/ui/ui-locale";
import SettingsDrawerFrame from "../shared/settings/SettingsDrawerFrame.vue";

const props = defineProps<{
  title: string;
  renameTitle: (title: string) => Promise<void>;
}>();

const emit = defineEmits<{
  close: [];
}>();

const draft = ref("");
const saving = ref(false);

watch(
  () => props.title,
  (value) => {
    if (!saving.value) draft.value = value;
  },
  { immediate: true },
);

async function saveTitle(): Promise<void> {
  if (saving.value) return;
  const next = draft.value.trim();
  const current = props.title.trim();
  if (next === current) return;
  saving.value = true;
  try {
    await props.renameTitle(draft.value);
  } catch (error) {
    showToast(
      error instanceof Error && error.message ? error.message : t("groupTitleFailed"),
      "error",
    );
  } finally {
    saving.value = false;
    // 空标题会回落成成员名，保存后草稿跟权威值对齐
    draft.value = props.title;
  }
}
</script>

<template>
  <!-- 群对话配置：群名；壳与单聊配置对齐 -->
  <SettingsDrawerFrame :lead="t('groupSettingsLead')" @close="emit('close')">
    <section
      class="rounded-xl border border-rule bg-paper p-3.5 animate-rise motion-reduce:animate-none"
    >
      <header class="mb-3 flex items-start gap-2.5">
        <span
          class="grid size-8 shrink-0 place-items-center rounded-lg bg-accent/10 text-accent"
          aria-hidden="true"
        >
          <PenLineIcon class="size-3.5" />
        </span>
        <div class="min-w-0 pt-0.5">
          <h3 class="m-0 text-xs font-semibold tracking-wide text-foreground">
            {{ t("groupTitleField") }}
          </h3>
          <p class="mb-0 mt-0.5 text-xs leading-snug text-muted-foreground">
            {{ t("groupTitleBody") }}
          </p>
        </div>
      </header>

      <label class="grid gap-2" for="group-settings-title">
        <span class="sr-only">{{ t("groupTitleField") }}</span>
        <input
          id="group-settings-title"
          v-model="draft"
          type="text"
          maxlength="40"
          class="min-h-8 w-full rounded-lg border border-rule bg-background px-3 text-sm outline-none transition duration-200 placeholder:text-muted-foreground focus:border-accent focus:ring-2 focus:ring-accent/15"
          :placeholder="t('groupTitlePlaceholder')"
          :disabled="saving"
          @change="saveTitle"
          @keydown.enter.prevent="saveTitle"
        />
      </label>
    </section>
  </SettingsDrawerFrame>
</template>
