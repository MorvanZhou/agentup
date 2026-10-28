<script setup lang="ts">
import { ArrowRightIcon, ChevronDownIcon, LoaderCircleIcon, SquareIcon, TerminalIcon } from "@lucide/vue";

import AgentAvatar from "../../../../../shared/components/avatar/AgentAvatar.vue";
import { t, tf } from "../../../../../shared/model/ui/ui-locale";

export type ProcessChip = {
  key: string;
  kind: "delegation" | "background";
  name: string;
  avatarUrl?: string;
};

export type ProcessRow = ProcessChip & {
  elapsed: string;
  kindLabel: string;
  subtitle: string;
  cancelling: boolean;
  canOpen: boolean;
  canCancel: boolean;
};

defineProps<{
  headline: string;
  chips: ProcessChip[];
  overflow: number;
  rows: ProcessRow[];
  expanded: boolean;
  wake: boolean;
  ariaLabel: string;
  showStop?: boolean;
}>();

const emit = defineEmits<{
  toggle: [];
  stop: [];
  open: [key: string];
  cancel: [key: string];
}>();
</script>

<template>
  <div
    class="shrink-0 border-b border-rule bg-paper-deep/60 px-3 py-1.5"
    role="region"
    :aria-label="ariaLabel"
    :aria-busy="true"
  >
    <div class="flex min-w-0 items-center gap-2">
      <LoaderCircleIcon
        class="size-3.5 shrink-0 animate-spin text-accent motion-reduce:animate-none"
        aria-hidden="true"
      />
      <p class="mb-0 min-w-0 flex-1 truncate text-xs text-muted-foreground">
        {{ headline }}
      </p>
      <div class="flex items-center">
        <span
          v-for="(chip, index) in chips"
          :key="chip.key"
          class="relative inline-flex rounded-full ring-2 ring-paper-deep"
          :class="index > 0 ? '-ml-1.5' : ''"
          :style="{ zIndex: index + 1 }"
          :title="chip.name"
        >
          <span
            v-if="chip.kind === 'background'"
            class="inline-flex size-5 items-center justify-center rounded-full bg-paper text-muted-foreground"
          >
            <TerminalIcon class="size-3" aria-hidden="true" />
          </span>
          <AgentAvatar
            v-else
            :name="chip.name"
            :avatar-url="chip.avatarUrl"
            size="xs"
            round
          />
        </span>
        <span
          v-if="overflow > 0"
          class="bg-muted text-muted-foreground relative -ml-1.5 inline-flex size-5 items-center justify-center rounded-full text-[10px] font-medium ring-2 ring-paper-deep"
          :style="{ zIndex: chips.length + 1 }"
        >
          +{{ overflow }}
        </span>
      </div>
      <button
        v-if="showStop"
        type="button"
        class="inline-flex min-h-7 cursor-pointer items-center gap-1 rounded-lg px-2 text-xs font-medium text-destructive transition duration-200 hover:bg-danger-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/30"
        :aria-label="t('orchStopAria')"
        :title="t('orchStop')"
        @click="emit('stop')"
      >
        <SquareIcon class="size-3.5 shrink-0 fill-current" aria-hidden="true" />
        {{ t("orchStop") }}
      </button>
      <button
        v-if="rows.length > 0"
        type="button"
        class="inline-flex size-7 cursor-pointer items-center justify-center rounded-lg text-muted-foreground transition duration-200 hover:bg-paper hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/30"
        :aria-expanded="expanded"
        :aria-label="expanded ? t('fleetCollapse') : t('fleetExpand')"
        @click="emit('toggle')"
      >
        <ChevronDownIcon
          class="size-3.5 transition-transform duration-200 motion-reduce:transition-none"
          :class="expanded ? 'rotate-180' : ''"
          aria-hidden="true"
        />
      </button>
    </div>

    <ul v-if="expanded && rows.length > 0" class="mt-1.5 flex flex-col gap-1" role="list">
      <li
        v-for="row in rows"
        :key="row.key"
        class="flex min-w-0 items-center gap-2 rounded-lg border border-rule bg-background px-2 py-1.5"
      >
        <span
          v-if="row.kind === 'background'"
          class="inline-flex size-5 shrink-0 items-center justify-center rounded-full bg-paper-deep text-muted-foreground"
        >
          <TerminalIcon class="size-3" aria-hidden="true" />
        </span>
        <AgentAvatar
          v-else
          :name="row.name"
          :avatar-url="row.avatarUrl"
          size="xs"
          round
        />
        <div class="min-w-0 flex-1">
          <div class="flex min-w-0 items-center gap-1.5">
            <p class="mb-0 truncate text-xs font-medium text-foreground">{{ row.name }}</p>
            <template v-if="row.elapsed">
              <span class="shrink-0 text-[10px] text-muted-foreground" aria-hidden="true">·</span>
              <span class="shrink-0 text-[10px] text-muted-foreground">{{ row.elapsed }}</span>
            </template>
            <span class="shrink-0 rounded-md bg-paper-deep px-1 py-0.5 text-[10px] text-muted-foreground">
              {{ row.kindLabel }}
            </span>
          </div>
          <p v-if="row.subtitle" class="mb-0 truncate text-[11px] text-muted-foreground">
            {{ row.subtitle }}
          </p>
        </div>
        <button
          v-if="row.canOpen"
          type="button"
          class="inline-flex min-h-7 cursor-pointer items-center gap-1 rounded-lg px-2 text-xs font-medium text-foreground transition duration-200 hover:bg-paper-deep focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/30"
          :aria-label="tf('assistSeeProcessAria', { name: row.name })"
          @click="emit('open', row.key)"
        >
          {{ t("assistSeeProcess") }}
          <ArrowRightIcon class="size-3.5 shrink-0" aria-hidden="true" />
        </button>
        <button
          v-if="row.canCancel"
          type="button"
          class="inline-flex min-h-7 cursor-pointer items-center gap-1 rounded-lg px-2 text-xs font-medium text-destructive transition duration-200 hover:bg-danger-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/30 disabled:opacity-50"
          :disabled="row.cancelling"
          :aria-label="tf('fleetCancelAria', { name: row.name })"
          :title="t('fleetCancel')"
          @click="emit('cancel', row.key)"
        >
          <SquareIcon class="size-3.5 shrink-0 fill-current" aria-hidden="true" />
          {{ row.cancelling ? t("fleetCancelling") : t("fleetCancel") }}
        </button>
      </li>
    </ul>
  </div>
</template>
