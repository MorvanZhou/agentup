<script setup lang="ts">
import { ref } from "vue";

import { compressAvatarFile } from "../../model/avatar/compress-avatar";
import { officialAvatarFile, type OfficialAvatarId } from "../../model/avatar/official-avatars";
import { showToast } from "../../model/ui/toast";
import { t } from "../../model/ui/ui-locale";
import AgentAvatar from "./AgentAvatar.vue";
import OfficialAvatarPicker from "./OfficialAvatarPicker.vue";

const props = withDefaults(
  defineProps<{
    name: string;
    /** 已选头像。空则显示 fallback，按钮仍是「选择头像」。 */
    preview?: string;
    /** 未选时的占位图，例如私人助理默认挥手。 */
    fallback?: string;
    busy?: boolean;
    selectedId?: string;
    hint?: string;
  }>(),
  { preview: "", fallback: "", busy: false, selectedId: "", hint: "" },
);

const emit = defineEmits<{
  pick: [dataUrl: string, officialId: string];
}>();

const input = ref<HTMLInputElement>();
const working = ref(false);
const locked = () => props.busy || working.value;

async function useFile(file: File, officialId: string): Promise<void> {
  working.value = true;
  try {
    emit("pick", await compressAvatarFile(file), officialId);
  } catch {
    showToast(t("agentsLocalAvatarFailed"), "error");
  } finally {
    working.value = false;
  }
}

async function onFile(event: Event): Promise<void> {
  const target = event.target as HTMLInputElement;
  const file = target.files?.[0];
  target.value = "";
  if (!file || locked()) return;
  await useFile(file, "");
}

async function onOfficial(id: OfficialAvatarId): Promise<void> {
  if (locked()) return;
  working.value = true;
  try {
    await useFile(await officialAvatarFile(id), id);
  } catch {
    showToast(t("agentsLocalAvatarFailed"), "error");
  } finally {
    working.value = false;
  }
}
</script>

<template>
  <!-- 头像：官方图直接选，上传仍保留 -->
  <div class="grid gap-2">
    <span class="text-sm font-medium text-foreground">{{ t("agentsLocalAvatar") }}</span>
    <div class="flex items-center gap-3">
      <button
        type="button"
        class="shrink-0 rounded-full border border-rule bg-paper p-0.5 transition hover:border-accent disabled:opacity-50"
        :disabled="locked()"
        @click="input?.click()"
      >
        <AgentAvatar :name="name || 'A'" :avatar-url="preview || fallback || undefined" size="xl" round />
      </button>
      <div class="min-w-0 flex-1">
        <input
          ref="input"
          type="file"
          accept="image/png,image/jpeg,image/webp"
          class="hidden"
          @change="onFile"
        />
        <button
          type="button"
          class="inline-flex min-h-8 items-center rounded-lg border border-rule bg-paper px-2.5 text-xs font-medium text-foreground transition hover:bg-accent/10 disabled:opacity-50"
          :disabled="locked()"
          @click="input?.click()"
        >
          {{ preview ? t("accountAvatarChange") : t("accountAvatarPick") }}
        </button>
        <p class="mb-0 mt-1 text-xs text-muted-foreground">{{ hint || t("agentsLocalAvatarHint") }}</p>
      </div>
    </div>
    <OfficialAvatarPicker :selected-id="selectedId" :disabled="locked()" @select="onOfficial" />
  </div>
</template>
