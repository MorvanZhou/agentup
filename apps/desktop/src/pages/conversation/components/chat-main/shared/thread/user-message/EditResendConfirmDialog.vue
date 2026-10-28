<script setup lang="ts">
import AppDialog from "../../../../../../../shared/components/AppDialog.vue";
import {
  displayRollbackPath,
  type RollbackFileImpact,
} from "../../../../../model/message/edit-resend-confirm";

const open = defineModel<boolean>("open", { required: true });
const skipConfirm = defineModel<boolean>("skipConfirm", { required: true });

defineProps<{
  files: readonly RollbackFileImpact[];
}>();

const emit = defineEmits<{
  confirm: [];
}>();
</script>

<template>
  <AppDialog
    :open="open"
    title="重新发送并回滚文件？"
    description="将丢弃这条消息之后的对话，并还原期间经 Write / Edit 改过的工作区文件。Bash 等命令产生的改动不会自动还原。"
    @update:open="open = $event"
  >
    <div class="grid gap-3">
      <!-- 将回滚的文件 -->
      <div v-if="files.length" class="grid gap-1.5">
        <p class="m-0 text-xs font-medium text-muted-foreground">
          将回滚 {{ files.length }} 个文件
        </p>
        <ul
          class="m-0 max-h-36 list-none overflow-y-auto rounded-lg border border-rule bg-paper px-2.5 py-1.5"
          aria-label="将回滚的文件"
        >
          <li
            v-for="file in files"
            :key="file.path"
            class="flex min-w-0 items-center gap-2 py-0.5 font-mono text-xs"
            :title="file.path"
          >
            <span class="min-w-0 flex-1 truncate text-foreground">
              {{ displayRollbackPath(file.path) }}
            </span>
            <span
              v-if="file.added > 0 || file.removed > 0"
              class="shrink-0 tabular-nums"
            >
              <span v-if="file.added > 0" class="text-success-foreground">+{{ file.added }}</span>
              <span v-if="file.added > 0 && file.removed > 0" class="text-muted-foreground"> </span>
              <span v-if="file.removed > 0" class="text-destructive">−{{ file.removed }}</span>
            </span>
          </li>
        </ul>
      </div>
      <label class="flex cursor-pointer items-center gap-2 text-sm text-foreground">
        <input
          v-model="skipConfirm"
          type="checkbox"
          class="size-4 rounded border-rule text-accent accent-accent"
        />
        <span>不再提醒</span>
      </label>
    </div>
    <template #footer>
      <button
        type="button"
        class="min-h-8 rounded-lg border border-rule px-3 text-sm font-medium transition duration-200 hover:bg-paper-deep"
        @click="open = false"
      >
        取消
      </button>
      <button
        type="button"
        class="min-h-8 rounded-lg bg-accent px-3 text-sm font-semibold text-white transition duration-200 hover:bg-accent-deep"
        @click="emit('confirm')"
      >
        回滚并重发
      </button>
    </template>
  </AppDialog>
</template>
