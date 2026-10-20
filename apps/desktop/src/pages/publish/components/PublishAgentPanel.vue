<script setup lang="ts">
import {
  CheckCircle2Icon,
  CircleAlertIcon,
  FolderUpIcon,
  LoaderCircleIcon,
} from "@lucide/vue";
import { computed, ref, watch } from "vue";

import AgentAvatar from "../../../shared/components/AgentAvatar.vue";
import AppDialog from "../../../shared/components/AppDialog.vue";
import type { AgentSourcePreview, PackageIssue } from "../../../shared/model/runtime";
import { t, tf } from "../../../shared/model/ui-locale";

const props = defineProps<{
  name: string;
  role: string;
  summary: string;
  updateAgentId: string;
  selectedDirectory: string;
  preview: AgentSourcePreview | null;
  publishing: boolean;
  errorDetails: PackageIssue[];
}>();

defineEmits<{
  choose: [];
  publish: [];
  "update:name": [value: string];
  "update:role": [value: string];
  "update:summary": [value: string];
}>();

const NAME_MAX = 80;
const ROLE_MAX = 40;
const SUMMARY_MAX = 280;

const errorDialogOpen = ref(false);
const chooseButton = ref<HTMLButtonElement | null>(null);

const nameReady = computed(() => Boolean(props.name.trim()));
const roleReady = computed(() => Boolean(props.role.trim()));
const summaryReady = computed(() => Boolean(props.summary.trim()));
const packageReady = computed(() => Boolean(props.preview));
const canPublish = computed(() =>
  Boolean(packageReady.value && nameReady.value && roleReady.value && summaryReady.value && !props.publishing),
);

const blockingHint = computed(() => {
  const missing: string[] = [];
  if (!nameReady.value) missing.push(t("publishFieldName"));
  if (!roleReady.value) missing.push(t("publishFieldRole"));
  if (!summaryReady.value) missing.push(t("publishFieldSummary"));
  if (!packageReady.value) missing.push(t("publishFieldPackage"));
  if (!missing.length) return "";
  return tf("publishNeedHint", { items: missing.join(t("listJoin")) });
});

watch(
  () => props.errorDetails,
  (details) => {
    if (details.length) errorDialogOpen.value = true;
  },
);

function onErrorDialogOpen(open: boolean): void {
  errorDialogOpen.value = open;
  if (!open) {
    queueMicrotask(() => chooseButton.value?.focus());
  }
}
</script>

<template>
  <section class="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_18rem]">
    <!-- 发布表单 -->
    <form class="min-w-0 rounded-xl border border-rule bg-background p-4 shadow-sm sm:p-5" @submit.prevent>
      <!-- 基本信息 -->
      <div class="flex items-center gap-2">
        <span
          class="grid size-6 shrink-0 place-items-center rounded-md bg-accent/10 text-xs font-semibold text-accent"
          aria-hidden="true"
        >
          1
        </span>
        <h2 class="m-0 text-sm font-semibold tracking-tight text-foreground">{{ t("publishBasics") }}</h2>
      </div>
      <p class="mb-0 mt-1.5 text-xs leading-snug text-muted-foreground">{{ t("publishBasicsLead") }}</p>

      <div class="mt-4 grid gap-4">
        <div class="grid gap-1.5">
          <div class="flex items-baseline justify-between gap-2">
            <label for="publish-name" class="text-sm font-medium text-foreground">
              {{ t("publishName") }} <span class="text-destructive" aria-hidden="true">*</span>
            </label>
            <span class="tabular-nums text-xs text-muted-foreground" aria-live="polite">
              {{ name.length }}/{{ NAME_MAX }}
            </span>
          </div>
          <input
            id="publish-name"
            :value="name"
            :maxlength="NAME_MAX"
            required
            aria-required="true"
            class="min-h-8 min-w-0 cursor-text rounded-lg border border-rule bg-paper px-3 text-sm font-normal text-foreground outline-none transition duration-200 placeholder:text-muted-foreground/70 focus:border-accent focus:bg-background focus:ring-2 focus:ring-accent/15"
            :placeholder="t('publishNamePh')"
            @input="$emit('update:name', ($event.target as HTMLInputElement).value)"
          />
        </div>

        <div class="grid gap-1.5">
          <div class="flex items-baseline justify-between gap-2">
            <label for="publish-role" class="text-sm font-medium text-foreground">
              {{ t("publishRole") }} <span class="text-destructive" aria-hidden="true">*</span>
            </label>
            <span class="tabular-nums text-xs text-muted-foreground" aria-live="polite">
              {{ role.length }}/{{ ROLE_MAX }}
            </span>
          </div>
          <input
            id="publish-role"
            :value="role"
            :maxlength="ROLE_MAX"
            required
            aria-required="true"
            class="min-h-8 min-w-0 cursor-text rounded-lg border border-rule bg-paper px-3 text-sm font-normal text-foreground outline-none transition duration-200 placeholder:text-muted-foreground/70 focus:border-accent focus:bg-background focus:ring-2 focus:ring-accent/15"
            :placeholder="t('publishRolePh')"
            @input="$emit('update:role', ($event.target as HTMLInputElement).value)"
          />
          <p class="m-0 text-xs text-muted-foreground">{{ t("publishRoleHint") }}</p>
        </div>

        <div class="grid gap-1.5">
          <div class="flex items-baseline justify-between gap-2">
            <label for="publish-summary" class="text-sm font-medium text-foreground">
              {{ t("publishSummary") }} <span class="text-destructive" aria-hidden="true">*</span>
            </label>
            <span class="tabular-nums text-xs text-muted-foreground" aria-live="polite">
              {{ summary.length }}/{{ SUMMARY_MAX }}
            </span>
          </div>
          <textarea
            id="publish-summary"
            :value="summary"
            :maxlength="SUMMARY_MAX"
            rows="4"
            required
            aria-required="true"
            class="min-w-0 resize-none rounded-lg border border-rule bg-paper px-3 py-2 text-sm font-normal leading-snug text-foreground outline-none transition duration-200 placeholder:text-muted-foreground/70 focus:border-accent focus:bg-background focus:ring-2 focus:ring-accent/15"
            :placeholder="t('publishSummaryPh')"
            @input="$emit('update:summary', ($event.target as HTMLTextAreaElement).value)"
          />
        </div>
      </div>

      <!-- 运行包 -->
      <div class="mt-5 border-t border-rule pt-5">
        <div class="flex items-center gap-2">
          <span
            class="grid size-6 shrink-0 place-items-center rounded-md bg-accent/10 text-xs font-semibold text-accent"
            aria-hidden="true"
          >
            2
          </span>
          <h2 class="m-0 text-sm font-semibold tracking-tight text-foreground">
            {{ t("publishPackage") }} <span class="text-destructive" aria-hidden="true">*</span>
          </h2>
        </div>
        <p class="mb-0 mt-1.5 text-xs leading-snug text-muted-foreground">
          {{ t("publishPackageLead") }}
        </p>

        <button
          ref="chooseButton"
          type="button"
          :aria-label="selectedDirectory ? t('publishRepickDir') : t('publishPickDir')"
          class="mt-3 flex w-full cursor-pointer flex-col items-center gap-2 rounded-xl border border-dashed border-rule bg-paper px-4 py-6 text-center transition duration-200 hover:border-accent hover:bg-accent/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
          :class="preview ? 'border-accent/40 bg-accent/5' : ''"
          @click="$emit('choose')"
        >
          <span
            class="grid size-10 place-items-center rounded-full bg-background text-accent shadow-sm transition duration-200"
            aria-hidden="true"
          >
            <CheckCircle2Icon v-if="preview" class="size-5" />
            <FolderUpIcon v-else class="size-5" />
          </span>
          <span class="text-sm font-semibold text-foreground">
            {{ selectedDirectory ? t("publishRepickDir") : t("publishPickDir") }}
          </span>
          <span class="max-w-sm text-xs leading-snug text-muted-foreground">
            {{
              preview
                ? tf("publishValidated", { n: preview.fileCount })
                : selectedDirectory
                  ? t("publishFixAndRepick")
                  : t("publishClickDir")
            }}
          </span>
        </button>
        <p
          v-if="selectedDirectory"
          class="mb-0 mt-2 break-all font-mono text-xs leading-snug text-muted-foreground"
          :title="selectedDirectory"
        >
          {{ selectedDirectory }}
        </p>
      </div>
    </form>

    <aside class="grid content-start gap-3 lg:sticky lg:top-4">
      <!-- 提交发布 -->
      <section class="rounded-xl border border-rule bg-background p-3 shadow-sm" :aria-label="t('publishSubmit')">
        <div v-if="preview" class="mb-3 flex items-center gap-2.5">
          <AgentAvatar :name="name || 'A'" :avatar-url="preview.avatarPreview" size="md" />
          <div class="min-w-0 flex-1">
            <strong class="block truncate text-sm font-semibold tracking-tight text-foreground">
              {{ name || t("publishNoName") }}
            </strong>
            <span class="text-xs text-accent">{{ t("publishPackageReady") }}</span>
          </div>
        </div>

        <p class="mb-3 text-xs leading-snug text-muted-foreground" aria-live="polite">
          {{ canPublish ? t("publishReady") : blockingHint || t("publishNeedMore") }}
        </p>

        <button
          type="button"
          :disabled="!canPublish"
          class="inline-flex min-h-8 w-full cursor-pointer items-center justify-center gap-1.5 rounded-lg bg-accent px-3 text-sm font-semibold text-white transition duration-200 hover:bg-accent-deep focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 disabled:cursor-not-allowed disabled:opacity-45"
          @click="$emit('publish')"
        >
          <LoaderCircleIcon
            v-if="publishing"
            class="size-3.5 shrink-0 animate-spin motion-reduce:animate-none"
            aria-hidden="true"
          />
          {{ publishing ? t("publishPublishing") : updateAgentId ? t("publishNewVersion") : t("publishNewTitle") }}
        </button>
      </section>

      <!-- 校验详情入口 -->
      <button
        v-if="errorDetails.length"
        type="button"
        class="flex w-full items-start gap-2 rounded-lg border border-destructive/20 bg-danger-soft px-3 py-2.5 text-left text-sm text-destructive transition duration-200 hover:border-destructive/40"
        @click="errorDialogOpen = true"
      >
        <CircleAlertIcon class="mt-0.5 size-4 shrink-0" aria-hidden="true" />
        <span class="min-w-0 font-semibold underline underline-offset-4">
          {{ tf("publishErrorCount", { n: errorDetails.length }) }}
        </span>
      </button>
    </aside>

    <AppDialog
      :open="errorDialogOpen"
      :title="t('publishValidateFailTitle')"
      :description="t('publishValidateFailBody')"
      @update:open="onErrorDialogOpen"
    >
      <ol class="m-0 grid list-none gap-2 p-0">
        <li
          v-for="(detail, index) in errorDetails"
          :key="`${detail.path}-${detail.message}-${index}`"
          class="rounded-lg border border-rule bg-paper p-3"
        >
          <code class="break-all text-xs font-semibold text-destructive">{{ detail.path }}</code>
          <p class="mb-0 mt-1.5 text-sm leading-snug text-foreground">{{ detail.message }}</p>
        </li>
      </ol>
    </AppDialog>
  </section>
</template>
