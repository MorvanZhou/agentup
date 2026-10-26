<script setup lang="ts">
import { ChevronDownIcon, Trash2Icon } from "@lucide/vue";
import { computed, ref, watch } from "vue";

import AppSelect from "../../../../../shared/components/AppSelect.vue";
import { t, tf } from "../../../../../shared/model/ui/ui-locale";
import { useProviderSettings } from "../../../composables/useProviderSettings";

const MODEL_PREVIEW_COUNT = 5;

const {
  connections,
  filteredModels,
  overridden,
  busy,
  draftVendorId,
  draftTemplateId,
  draftBaseUrl,
  draftApiKey,
  modelFilter,
  vendors,
  vendorOptions,
  selectedTemplate,
  existingConnection,
  needsBaseUrl,
  needsApiKey,
  canRefreshModels,
  canAddCustomModel,
  customModelTargets,
  draftCustomModelId,
  draftAddTemplateId,
  onVendorChange,
  saveConnection,
  removeConnection,
  refreshAllDiscoverableModels,
  addCustomModel,
  removeCustomModel,
  toggleModel,
} = useProviderSettings();

const addTargetOptions = computed(() =>
  customModelTargets.value.map((item) => ({
    value: item.templateId,
    label: item.label,
    active: true,
  })),
);

/** 连接服务商为次要操作，默认折叠。 */
const providerOpen = ref(false);
/** 模型列表默认只展示前几条，避免一屏过长。 */
const modelsExpanded = ref(false);

const modelListOverflow = computed(() => filteredModels.value.length > MODEL_PREVIEW_COUNT);
const visibleModels = computed(() =>
  modelsExpanded.value || !modelListOverflow.value
    ? filteredModels.value
    : filteredModels.value.slice(0, MODEL_PREVIEW_COUNT),
);
const hiddenModelCount = computed(() =>
  Math.max(0, filteredModels.value.length - MODEL_PREVIEW_COUNT),
);

/** 已落盘连接 → 下拉绿点 */
const connectedTemplateIds = computed(
  () => new Set(connections.value.map((item) => item.templateId)),
);
const connectedVendorIds = computed(
  () => new Set(connections.value.map((item) => item.vendorId)),
);
const vendorSelectOptions = computed(() =>
  vendors.value.map((vendor) => ({
    value: vendor.id,
    label: vendor.label,
    active: connectedVendorIds.value.has(vendor.id),
  })),
);
const modeSelectOptions = computed(() =>
  vendorOptions.value.map((option) => ({
    value: option.id,
    label: option.optionLabel,
    active: connectedTemplateIds.value.has(option.id),
  })),
);

function onVendorSelect(vendorId: string): void {
  draftVendorId.value = vendorId;
  onVendorChange();
}

watch(modelFilter, () => {
  modelsExpanded.value = false;
});
</script>

<template>
  <main class="min-h-0 min-w-0 overflow-auto bg-background">
    <div class="mx-auto w-full max-w-3xl px-4 py-4 sm:px-5 sm:py-5">
      <!-- 页头 -->
      <header class="mb-4 border-b border-rule pb-4">
        <p class="m-0 text-xs font-medium tracking-wider text-accent">{{ t("providerKicker") }}</p>
        <h1 class="mb-0 mt-2 text-lg font-semibold tracking-tight text-foreground">{{ t("providerTitle") }}</h1>
        <p class="mb-0 mt-1.5 max-w-2xl text-sm leading-snug text-muted-foreground">
          {{ t("providerLead") }}
        </p>
      </header>

      <div class="grid gap-3">
        <!-- 主区：候选模型 -->
        <article class="rounded-xl border border-rule bg-background p-3 shadow-sm sm:p-4">
          <div class="flex flex-wrap items-start justify-between gap-2">
            <div class="min-w-0 flex-1">
              <p class="m-0 text-xs font-medium tracking-wider text-accent">{{ t("providerModelsKicker") }}</p>
              <h2 class="mb-0 mt-1 text-sm font-semibold tracking-tight text-foreground">{{ t("providerEnableModels") }}</h2>
              <p class="mb-0 mt-1 text-xs leading-snug text-muted-foreground">
                {{ t("providerEnableLead") }}
              </p>
            </div>
            <button
              v-if="canRefreshModels"
              type="button"
              :disabled="busy"
              class="min-h-8 shrink-0 rounded-lg border border-rule bg-paper px-3 text-sm font-medium text-foreground transition duration-200 hover:bg-background disabled:opacity-50"
              @click="refreshAllDiscoverableModels"
            >
              {{ t("providerRefreshModels") }}
            </button>
          </div>

          <label class="mt-3 grid gap-1.5 text-sm font-medium text-foreground">
            <span class="sr-only">{{ t("providerSearchModels") }}</span>
            <input
              v-model="modelFilter"
              type="search"
              :disabled="busy"
              :placeholder="t('providerSearchModels')"
              class="min-h-8 rounded-lg border border-rule bg-paper px-3 py-1.5 text-sm text-foreground outline-none transition duration-200 focus:border-accent focus:bg-background focus:ring-2 focus:ring-accent/15 disabled:opacity-60"
            />
          </label>

          <!-- 手动添加：默认折叠；箭头 + 实线边框示意可展开 -->
          <details
            v-if="canAddCustomModel"
            class="group/add relative z-10 mt-3 rounded-lg border border-rule bg-paper"
          >
            <summary
              class="flex min-h-8 cursor-pointer list-none items-center justify-between gap-2 px-3 py-2 text-sm text-muted-foreground outline-none transition duration-200 hover:bg-background hover:text-foreground focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/15 [&::-webkit-details-marker]:hidden"
            >
              <span class="min-w-0 flex-1 text-left leading-snug">{{ t("providerAddModelToggle") }}</span>
              <ChevronDownIcon
                class="size-3.5 shrink-0 text-muted-foreground transition-transform duration-200 group-open/add:rotate-180 motion-reduce:transition-none"
                aria-hidden="true"
              />
            </summary>
            <form class="border-t border-rule bg-paper-deep/40 px-3 py-3" @submit.prevent="addCustomModel">
              <p class="mb-0 text-xs leading-snug text-muted-foreground">
                {{ t("providerAddModelLead") }}
              </p>
              <div class="mt-2 grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
                <div class="grid min-w-0 gap-2">
                  <AppSelect
                    v-if="customModelTargets.length > 1"
                    v-model="draftAddTemplateId"
                    :label="t('providerAddModelTarget')"
                    :options="addTargetOptions"
                    :disabled="busy"
                    :active-hint="t('providerConfiguredActive')"
                  />
                  <label class="grid gap-1.5 text-sm font-medium text-foreground">
                    {{ t("providerAddModelId") }}
                    <input
                      v-model="draftCustomModelId"
                      type="text"
                      :disabled="busy"
                      autocomplete="off"
                      spellcheck="false"
                      :placeholder="t('providerAddModelPlaceholder')"
                      class="min-h-8 rounded-lg border border-rule bg-paper px-3 py-1.5 font-mono text-sm text-foreground outline-none transition duration-200 focus:border-accent focus:bg-background focus:ring-2 focus:ring-accent/15 disabled:opacity-60"
                    />
                  </label>
                </div>
                <button
                  type="submit"
                  :disabled="busy"
                  class="min-h-8 shrink-0 rounded-lg border border-rule bg-paper px-3 text-sm font-medium text-foreground transition duration-200 hover:bg-background disabled:opacity-50"
                >
                  {{ t("providerAddModel") }}
                </button>
              </div>
            </form>
          </details>

          <ul v-if="filteredModels.length" class="m-0 mt-3 grid list-none gap-1 p-0">
            <li
              v-for="model in visibleModels"
              :key="`${model.templateId}::${model.modelId}`"
              class="flex items-center justify-between gap-3 rounded-lg px-2 py-2 transition duration-200 hover:bg-paper"
            >
              <div class="min-w-0 flex-1">
                <p class="m-0 truncate text-sm font-medium text-foreground">{{ model.name }}</p>
                <p class="mb-0 mt-0.5 truncate text-xs text-muted-foreground">
                  {{ model.vendorLabel }}
                  <template v-if="model.optionLabel !== model.vendorLabel">
                    · {{ model.optionLabel }}
                  </template>
                </p>
              </div>
              <div class="flex shrink-0 items-center gap-1.5">
                <button
                  v-if="model.custom"
                  type="button"
                  :disabled="busy"
                  class="inline-flex size-8 items-center justify-center rounded-lg border-0 text-muted-foreground transition duration-200 hover:bg-danger-soft hover:text-destructive disabled:opacity-50"
                  :aria-label="tf('providerRemoveModel', { name: model.name })"
                  @click="removeCustomModel(model)"
                >
                  <Trash2Icon class="size-3.5" aria-hidden="true" />
                </button>
                <button
                  type="button"
                  role="switch"
                  :aria-checked="model.enabled"
                  :disabled="busy"
                  class="relative h-6 w-11 shrink-0 rounded-full border-0 transition duration-200 disabled:opacity-50"
                  :class="model.enabled ? 'bg-emerald-500' : 'bg-muted'"
                  :aria-label="model.enabled ? tf('providerDisableAria', { name: model.name }) : tf('providerEnableAria', { name: model.name })"
                  @click="toggleModel(model, !model.enabled)"
                >
                  <span
                    class="absolute top-0.5 size-5 rounded-full bg-paper shadow transition duration-200"
                    :class="model.enabled ? 'left-5' : 'left-0.5'"
                  />
                </button>
              </div>
            </li>
          </ul>
          <button
            v-if="modelListOverflow"
            type="button"
            class="mt-2 min-h-8 w-full rounded-lg px-2 text-sm font-medium text-muted-foreground transition duration-200 hover:bg-paper hover:text-foreground"
            @click="modelsExpanded = !modelsExpanded"
          >
            {{
              modelsExpanded
                ? t("providerModelsCollapse")
                : tf("providerModelsExpand", { count: hiddenModelCount })
            }}
          </button>
          <p v-else-if="!filteredModels.length" class="mb-0 mt-4 text-sm text-muted-foreground">
            {{ connections.length ? t("providerNoMatch") : t("providerNeedConnection") }}
          </p>

          <!-- 平台 AI 占位 -->
          <div class="mt-4 rounded-lg border border-dashed border-rule bg-paper-deep/70 p-3 text-muted-foreground">
            <div class="flex flex-wrap items-center justify-between gap-2">
              <p class="m-0 text-sm font-semibold text-foreground">{{ t("providerPlatformTitle") }}</p>
              <span class="rounded-md border border-rule bg-background px-2 py-0.5 text-xs font-medium">{{ t("providerPlatformSoon") }}</span>
            </div>
            <p class="mb-0 mt-1.5 text-xs leading-snug">{{ t("providerPlatformBody") }}</p>
          </div>
        </article>

        <!-- 次区：连接 / 修改服务商 -->
        <details
          class="rounded-xl border border-rule bg-background shadow-sm open:shadow-sm"
          :open="providerOpen || !connections.length"
          @toggle="providerOpen = ($event.target as HTMLDetailsElement).open"
        >
          <summary
            class="cursor-pointer list-none px-3 py-3 text-sm font-semibold text-foreground outline-none transition duration-200 hover:bg-paper sm:px-4 [&::-webkit-details-marker]:hidden"
          >
            <div class="flex items-center justify-between gap-2">
              <div>
                <p class="m-0 text-xs font-medium tracking-wider text-muted-foreground">{{ t("providerConnectKicker") }}</p>
                <p class="mb-0 mt-1">{{ t("providerConnect") }}</p>
              </div>
              <span class="text-xs font-normal text-muted-foreground">
                {{ connections.length ? tf("providerConnectedCount", { count: connections.length }) : t("providerConnectHint") }}
              </span>
            </div>
          </summary>

          <form class="border-t border-rule px-3 pb-3 pt-3 sm:px-4 sm:pb-4" @submit.prevent="saveConnection">
            <div class="grid gap-3">
              <AppSelect
                :model-value="draftVendorId"
                :label="t('providerVendor')"
                :options="vendorSelectOptions"
                :disabled="busy"
                :active-hint="t('providerConfiguredActive')"
                @update:model-value="onVendorSelect"
              />

              <AppSelect
                v-if="vendorOptions.length > 1"
                v-model="draftTemplateId"
                :label="t('providerMode')"
                :options="modeSelectOptions"
                :disabled="busy"
                :active-hint="t('providerConfiguredActive')"
              />

              <p v-if="selectedTemplate?.hint" class="m-0 text-xs leading-snug text-muted-foreground">
                {{ selectedTemplate.hint }}
              </p>

              <label v-if="needsBaseUrl" class="grid gap-1.5 text-sm font-medium text-foreground">
                {{ t("providerBaseUrl") }}
                <input
                  v-model="draftBaseUrl"
                  type="url"
                  required
                  :disabled="busy"
                  autocomplete="off"
                  class="min-h-8 rounded-lg border border-rule bg-paper px-3 py-1.5 font-mono text-sm text-foreground outline-none transition duration-200 focus:border-accent focus:bg-background focus:ring-2 focus:ring-accent/15 disabled:opacity-60"
                  placeholder="http://localhost:11434/v1"
                />
              </label>

              <label v-if="needsApiKey" class="grid gap-1.5 text-sm font-medium text-foreground">
                API Key
                <input
                  v-model="draftApiKey"
                  type="password"
                  :disabled="busy"
                  autocomplete="off"
                  class="min-h-8 rounded-lg border border-rule bg-paper px-3 py-1.5 font-mono text-sm text-foreground outline-none transition duration-200 focus:border-accent focus:bg-background focus:ring-2 focus:ring-accent/15 disabled:opacity-60"
                  :placeholder="existingConnection?.hasApiKey ? t('providerApiKeyKeep') : t('providerApiKeyPaste')"
                />
              </label>

            </div>

            <p
              v-if="overridden"
              class="mt-3 rounded-lg border border-amber-300/40 bg-warning-soft px-3 py-2 text-sm text-warning-foreground"
            >
              {{ t("providerEnvOverride") }}
            </p>

            <div class="mt-4 grid gap-3 border-t border-rule pt-3">
              <p class="m-0 text-xs leading-snug text-muted-foreground">
                <span v-if="existingConnection">{{ tf("providerConnected", { label: existingConnection.label }) }}</span>
                {{ t("providerGuestHint") }}
              </p>
              <div class="flex flex-wrap items-center justify-end gap-2">
                <button
                  v-if="existingConnection"
                  type="button"
                  :disabled="busy"
                  class="min-h-8 shrink-0 rounded-lg border border-rule px-3 text-sm font-medium text-destructive transition duration-200 hover:bg-danger-soft disabled:opacity-50"
                  @click="removeConnection(existingConnection.templateId)"
                >
                  {{ t("providerRemove") }}
                </button>
                <button
                  type="submit"
                  :disabled="busy"
                  class="min-h-8 shrink-0 rounded-lg bg-accent px-3 text-sm font-semibold text-white transition duration-200 hover:bg-accent-deep disabled:opacity-50"
                >
                  {{ busy ? t("saving") : existingConnection ? t("providerUpdate") : t("providerSave") }}
                </button>
              </div>
            </div>
          </form>
        </details>
      </div>
    </div>
  </main>
</template>
