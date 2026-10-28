<script setup lang="ts">
import {
  CheckIcon,
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  MessageCircleQuestionIcon,
  XIcon,
} from "@lucide/vue";
import {
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuPortal,
  DropdownMenuRoot,
  DropdownMenuTrigger,
} from "reka-ui";
import { computed, ref, watch } from "vue";

import type {
  AgentUpAskUserData,
  AgentUpAskUserQuestion,
  AskUserAnswer,
  AskUserItemAnswer,
} from "../../../../../../../shared/model/chat/chat";
import { t, tf } from "../../../../../../../shared/model/ui/ui-locale";
import HitlAgentFace from "./HitlAgentFace.vue";

const props = defineProps<{
  askUser?: AgentUpAskUserData;
}>();

const emit = defineEmits<{
  answer: [answer: AskUserAnswer];
}>();

const currentIndex = ref(0);
/** 与 questions 对齐；undefined 表示尚未作答。 */
const drafts = ref<Array<AskUserItemAnswer | undefined>>([]);
const jumpOpen = ref(false);

watch(
  () => props.askUser?.id,
  () => {
    currentIndex.value = 0;
    drafts.value = props.askUser ? props.askUser.questions.map(() => undefined) : [];
    jumpOpen.value = false;
  },
  { immediate: true },
);

const questions = computed(() => props.askUser?.questions ?? []);
const total = computed(() => questions.value.length);
const current = computed<AgentUpAskUserQuestion | undefined>(
  () => questions.value[currentIndex.value],
);
const filledCount = computed(() => drafts.value.filter((item) => isFilled(item)).length);
const progressPercent = computed(() =>
  total.value === 0 ? 0 : Math.round((filledCount.value / total.value) * 100),
);

const selected = computed(() => {
  const draft = drafts.value[currentIndex.value];
  return draft?.kind === "selection" ? draft.selections : [];
});
const freeform = computed({
  get() {
    const draft = drafts.value[currentIndex.value];
    return draft?.kind === "freeform" ? draft.text : "";
  },
  set(value: string) {
    setDraft(currentIndex.value, value.length > 0 ? { kind: "freeform", text: value } : undefined);
  },
});
const freeformActive = computed(() => freeform.value.trim().length > 0);

const isMultiple = computed(() => current.value?.allowMultiple === true);
const modeLabel = computed(() => (isMultiple.value ? t("askMultiple") : t("askSingle")));
const canSubmitAll = computed(() => filledCount.value === total.value && total.value > 0);
const isLast = computed(() => currentIndex.value >= total.value - 1);
const showSteps = computed(() => total.value > 1);
const currentFilled = computed(() => isFilled(drafts.value[currentIndex.value]));
const canGoPrev = computed(() => currentIndex.value > 0);
const canGoNext = computed(() => currentIndex.value < total.value - 1);
const canPrimaryNext = computed(() => currentFilled.value && !canSubmitAll.value && total.value > 1);

/** 单题始终「提交」；多题未答完为「下一题」。 */
const primaryLabel = computed(() =>
  canSubmitAll.value || total.value <= 1 ? t("askSubmit") : t("askNext"),
);
const primaryDisabled = computed(() => {
  if (canSubmitAll.value) return false;
  if (total.value <= 1) return !currentFilled.value;
  return !canPrimaryNext.value;
});

const progressLabel = computed(() =>
  tf("askProgress", {
    current: currentIndex.value + 1,
    total: total.value,
    mode: modeLabel.value,
  }),
);

function isAnswered(item: AskUserItemAnswer | undefined): boolean {
  if (!item || item.kind === "skipped") return false;
  if (item.kind === "freeform") return item.text.trim().length > 0;
  return item.selections.length > 0;
}

function isFilled(item: AskUserItemAnswer | undefined): boolean {
  if (!item) return false;
  if (item.kind === "skipped") return true;
  return isAnswered(item);
}

function setDraft(index: number, value: AskUserItemAnswer | undefined): void {
  const next = [...drafts.value];
  next[index] = value;
  drafts.value = next;
}

function toggleOption(title: string): void {
  const question = current.value;
  if (!question) return;
  if (question.allowMultiple) {
    const prev = selected.value;
    const next = prev.includes(title)
      ? prev.filter((item) => item !== title)
      : [...prev, title];
    setDraft(
      currentIndex.value,
      next.length > 0 ? { kind: "selection", selections: next } : undefined,
    );
    return;
  }
  setDraft(currentIndex.value, { kind: "selection", selections: [title] });
  if (!isLast.value) currentIndex.value += 1;
}

function goTo(index: number): void {
  if (index < 0 || index >= total.value) return;
  currentIndex.value = index;
  jumpOpen.value = false;
}

function goPrev(): void {
  if (!canGoPrev.value) return;
  currentIndex.value -= 1;
}

function goNext(): void {
  if (!canGoNext.value) return;
  currentIndex.value += 1;
}

/** 主按钮「下一题」：优先下一题，末题则跳到第一道未答。 */
function primaryNext(): void {
  if (!canPrimaryNext.value) return;
  if (!isLast.value) {
    currentIndex.value += 1;
    return;
  }
  const firstOpen = drafts.value.findIndex((item) => !isFilled(item));
  if (firstOpen >= 0) currentIndex.value = firstOpen;
}

function skipCurrent(): void {
  setDraft(currentIndex.value, { kind: "skipped" });
  if (!isLast.value) currentIndex.value += 1;
}

function cancel(): void {
  emit("answer", { kind: "cancelled" });
}

function submit(): void {
  if (!props.askUser || !canSubmitAll.value) return;
  const items: AskUserItemAnswer[] = drafts.value.map((item) => {
    if (!item || !isFilled(item)) return { kind: "skipped" };
    if (item.kind === "freeform") return { kind: "freeform", text: item.text.trim() };
    return item;
  });
  emit("answer", { kind: "answers", items });
}

function onPrimary(): void {
  if (canSubmitAll.value || (total.value <= 1 && currentFilled.value)) {
    submit();
    return;
  }
  primaryNext();
}

function stepState(index: number): "current" | "done" | "pending" {
  if (index === currentIndex.value) return "current";
  return isFilled(drafts.value[index]) ? "done" : "pending";
}

function stepHint(index: number): string {
  const state = stepState(index);
  if (state === "current") return t("askCurrent");
  if (state === "done") return t("askDone");
  return t("askPending");
}
</script>

<template>
  <!-- 提问底栏：与审批条同级，扁平占位，不挡消息流的浮层感 -->
  <section
    v-if="askUser && current"
    class="shrink-0 border-t border-border bg-paper animate-rise motion-reduce:animate-none"
    role="region"
    :aria-label="t('askNeedAnswer')"
  >
    <div class="mx-auto w-full px-3 py-2.5">
      <!-- 页头：图标 + 进度 + 切题 -->
      <header class="mb-2 flex min-w-0 items-start gap-2">
        <HitlAgentFace
          v-if="askUser.askedByName"
          class="mt-0.5"
          :name="askUser.askedByName"
          :agent-id="askUser.askedByAgentId"
        />
        <span
          v-else
          class="mt-0.5 grid size-7 shrink-0 place-items-center rounded-lg bg-accent/10 text-accent"
          aria-hidden="true"
        >
          <MessageCircleQuestionIcon class="size-3.5" />
        </span>
        <div class="min-w-0 flex-1">
          <p class="mb-0 text-xs font-medium tracking-wider text-accent">
            {{ progressLabel }}
          </p>
          <p v-if="askUser.askedByName" class="mb-0 mt-0.5 text-xs text-foreground">
            {{ tf("hitlRelayAsk", { name: askUser.askedByName }) }}
          </p>
          <p v-if="askUser.taskLabel" class="mb-0 mt-0.5 line-clamp-2 text-xs text-muted-foreground">
            {{ tf("hitlRelayTask", { label: askUser.taskLabel }) }}
          </p>
          <p v-if="(askUser.queueBehind ?? 0) > 0" class="mb-0 mt-0.5 text-xs text-muted-foreground">
            {{ tf("hitlQueueBehind", { n: askUser.queueBehind ?? 0 }) }}
          </p>
          <h2
            :id="`ask-user-title-${askUser.id}`"
            class="mt-0.5 text-sm font-semibold tracking-tight text-foreground"
          >
            {{ current.question }}
          </h2>
          <p
            v-if="current.context"
            class="mb-0 mt-0.5 text-xs leading-snug text-muted-foreground"
          >
            {{ current.context }}
          </p>
        </div>
        <div class="flex shrink-0 items-center pt-0.5">
          <template v-if="showSteps">
            <!-- 固定宽度进度 + 跳转菜单，题数再多也不横向撑开 -->
            <DropdownMenuRoot v-model:open="jumpOpen">
              <DropdownMenuTrigger
                class="app-no-drag mr-2 flex min-h-7 cursor-pointer items-center gap-2 rounded-lg border border-rule px-2 py-1 text-left transition duration-200 hover:bg-paper-deep focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/30"
                :aria-label="tf('askJumpList', { filled: filledCount, total })"
              >
                <span class="block h-1 w-12 overflow-hidden rounded-full bg-rule" aria-hidden="true">
                  <span
                    class="block h-full rounded-full bg-accent transition-[width] duration-200"
                    :style="{ width: `${progressPercent}%` }"
                  />
                </span>
                <span class="text-xs tabular-nums text-muted-foreground">
                  {{ filledCount }}/{{ total }}
                </span>
                <ChevronDownIcon
                  class="size-3 text-muted-foreground transition duration-200"
                  :class="jumpOpen ? 'rotate-180' : ''"
                  aria-hidden="true"
                />
              </DropdownMenuTrigger>
              <DropdownMenuPortal>
                <DropdownMenuContent
                  align="end"
                  :side-offset="6"
                  class="app-no-drag z-50 max-h-56 min-w-44 overflow-y-auto rounded-lg border border-rule bg-paper p-1 text-foreground shadow-md"
                >
                  <DropdownMenuItem
                    v-for="(question, index) in questions"
                    :key="index"
                    class="flex min-h-8 cursor-pointer items-center gap-2 rounded-md px-2 text-sm outline-none transition duration-200 data-[highlighted]:bg-paper-deep"
                    :aria-current="stepState(index) === 'current' ? 'step' : undefined"
                    @select="goTo(index)"
                  >
                    <span
                      :class="[
                        'grid size-4 shrink-0 place-items-center rounded-full text-[10px] font-semibold tabular-nums',
                        stepState(index) === 'current'
                          ? 'bg-accent text-white'
                          : stepState(index) === 'done'
                            ? 'bg-accent/15 text-accent'
                            : 'bg-paper-deep text-muted-foreground',
                      ]"
                      aria-hidden="true"
                    >
                      <CheckIcon v-if="stepState(index) === 'done'" class="size-2.5" />
                      <template v-else>{{ index + 1 }}</template>
                    </span>
                    <span class="min-w-0 flex-1 truncate">
                      {{ question.question }}
                    </span>
                    <span class="shrink-0 text-xs text-muted-foreground">{{ stepHint(index) }}</span>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenuPortal>
            </DropdownMenuRoot>

            <div
              class="flex overflow-hidden rounded-lg border border-rule"
              role="group"
              :aria-label="t('askSwitch')"
            >
              <button
                type="button"
                class="grid size-7 place-items-center text-muted-foreground transition duration-200 hover:bg-paper-deep hover:text-foreground disabled:cursor-not-allowed disabled:opacity-35"
                :aria-label="t('askPrev')"
                :disabled="!canGoPrev"
                @click="goPrev"
              >
                <ChevronLeftIcon class="size-3.5" aria-hidden="true" />
              </button>
              <button
                type="button"
                class="grid size-7 place-items-center border-l border-rule text-muted-foreground transition duration-200 hover:bg-paper-deep hover:text-foreground disabled:cursor-not-allowed disabled:opacity-35"
                :aria-label="t('askNextQ')"
                :disabled="!canGoNext"
                @click="goNext"
              >
                <ChevronRightIcon class="size-3.5" aria-hidden="true" />
              </button>
            </div>

            <!-- 与切题控件拉开，避免误点关闭 -->
            <span class="mx-2.5 h-4 w-px shrink-0 bg-rule" aria-hidden="true" />
          </template>
          <button
            type="button"
            class="text-muted-foreground hover:text-foreground hover:bg-paper-deep inline-flex size-7 shrink-0 items-center justify-center rounded-lg transition duration-200"
            :class="showSteps ? '' : 'ml-1'"
            :aria-label="t('askClose')"
            @click="cancel"
          >
            <XIcon class="size-3.5" aria-hidden="true" />
          </button>
        </div>
      </header>

      <!-- 选项：限制高度避免挡住大半对话 -->
      <div
        class="flex max-h-48 flex-col gap-1 overflow-y-auto overscroll-contain pr-0.5"
        role="listbox"
        :aria-label="isMultiple ? t('askOptionsMultiple') : t('askOptionsSingle')"
        :aria-multiselectable="isMultiple || undefined"
      >
        <button
          v-for="option in current.options"
          :key="option.title"
          type="button"
          role="option"
          :aria-selected="selected.includes(option.title)"
          :class="[
            'flex min-h-8 w-full cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-sm transition duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/30',
            selected.includes(option.title)
              ? 'bg-accent/10 text-foreground'
              : 'text-foreground hover:bg-paper-deep',
          ]"
          @click="toggleOption(option.title)"
        >
          <span
            :class="[
              'grid size-4 shrink-0 place-items-center border',
              isMultiple ? 'rounded-[3px]' : 'rounded-full',
              selected.includes(option.title)
                ? 'border-accent bg-accent text-white'
                : 'border-rule',
            ]"
            aria-hidden="true"
          >
            <CheckIcon v-if="selected.includes(option.title)" class="size-2.5" />
          </span>
          <span class="min-w-0 flex-1">
            <span class="font-medium">{{ option.title }}</span>
            <span v-if="option.description" class="text-muted-foreground">
              · {{ option.description }}
            </span>
          </span>
        </button>

        <div
          :class="[
            'flex min-h-8 w-full items-center gap-2.5 rounded-lg border px-2.5 py-1.5 text-sm transition duration-200',
            freeformActive
              ? 'border-accent/40 bg-accent/10'
              : 'border-transparent hover:bg-paper-deep',
          ]"
        >
          <span
            :class="[
              'grid size-4 shrink-0 place-items-center border',
              isMultiple ? 'rounded-[3px]' : 'rounded-full',
              freeformActive ? 'border-accent bg-accent text-white' : 'border-rule',
            ]"
            aria-hidden="true"
          >
            <CheckIcon v-if="freeformActive" class="size-2.5" />
          </span>
          <label class="sr-only" :for="`ask-user-freeform-${askUser.id}`">{{ t("askFreeform") }}</label>
          <input
            :id="`ask-user-freeform-${askUser.id}`"
            v-model="freeform"
            type="text"
            :aria-label="t('askFreeform')"
            class="min-h-6 min-w-0 flex-1 border-0 bg-transparent p-0 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:ring-0"
            :placeholder="t('askFreeformPlaceholder')"
          />
        </div>
      </div>

      <!-- 操作：跳过与提交同尺寸 -->
      <div class="mt-2.5 flex flex-wrap items-center justify-end gap-1.5">
        <button
          type="button"
          class="inline-flex h-8 min-w-[4.5rem] cursor-pointer items-center justify-center rounded-lg border border-rule px-3 text-sm text-muted-foreground transition duration-200 hover:bg-paper-deep hover:text-foreground"
          @click="skipCurrent"
        >
          {{ t("askSkip") }}
        </button>
        <button
          type="button"
          class="inline-flex h-8 min-w-[4.5rem] cursor-pointer items-center justify-center rounded-lg bg-accent px-3 text-sm font-semibold text-white transition duration-200 hover:bg-accent-deep disabled:cursor-not-allowed disabled:opacity-50"
          :disabled="primaryDisabled"
          @click="onPrimary"
        >
          {{ primaryLabel }}
        </button>
      </div>
    </div>
  </section>
</template>
